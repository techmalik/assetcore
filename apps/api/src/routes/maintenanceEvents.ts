import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { refreshAssetHealth } from '../healthService.js'
import { uploadRoute, optionalUploadRoute, DOCUMENT_MIME_TYPES } from '../files.js'
import { notifyRoleHolders } from '../notify.js'
import { transitionWorkOrder } from '../services/workOrders.js'
import { isoDate, blankToUndefined } from '../http/zod.js'

export const maintenanceEventsRouter = Router()

const REPORT_UPLOAD = { subdir: 'maintenance-completions', field: 'report', mime: DOCUMENT_MIME_TYPES, maxBytes: 25 * 1024 * 1024 }

// Multipart bodies arrive with every field as a string, so a blank optional
// input comes as '' and blankToUndefined turns it back into "not provided".
// Dates are plain YYYY-MM-DD (isoDate), validated and compared as strings —
// never wrapped in a JS Date for comparison: a date round-tripped through
// `new Date(...)` re-renders in the process's local TZ and can drift a
// calendar day either side of what the user typed (see db.ts's DATE parser).

const completionInput = z.object({
  source: z.preprocess(blankToUndefined, z.enum(['pm_task', 'work_order', 'manual'])).default('manual'),
  pm_task_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  work_order_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  completed_at: isoDate,
  next_maintenance_at: isoDate,
  notes: z.preprocess(blankToUndefined, z.string().optional()),
})

// Local calendar date (respects process.env.TZ, set from config.TZ at
// startup — see index.ts) as YYYY-MM-DD, comparable lexically against the
// same-format columns above.
function todayLocal(): string {
  return new Date().toLocaleDateString('en-CA')
}

// GET /assets/:id/maintenance-completions — feeds the asset detail timeline.
maintenanceEventsRouter.get('/assets/:id/maintenance-completions', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select e.*,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as performer
       from public.maintenance_events e
       left join public.users u on u.id = e.performed_by
       where e.asset_id = $1
       order by e.completed_at desc, e.created_at desc`,
      [req.params.id]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

// The explicit "Complete Maintenance" action. Optionally closes out a linked
// PM task or work order, always resets the asset's health to 100% via
// apply_asset_health (so the same 50%/30% crossing logic re-arms cleanly for
// the next decay cycle) and advances last/next maintenance dates.
maintenanceEventsRouter.post(
  '/assets/:id/maintenance-completions',
  requireCap('maintenance:complete'),
  // The report is optional here. A stored file is deleted again if the
  // request then fails, early validation included.
  ...optionalUploadRoute(REPORT_UPLOAD, async (req, res, file) => {
    const parsed = completionInput.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
    const { source, pm_task_id, work_order_id, completed_at, next_maintenance_at, notes } = parsed.data

    if (completed_at > todayLocal()) {
      return res.status(400).json({ error: 'completed_at_in_future' })
    }
    if (next_maintenance_at <= completed_at) {
      return res.status(400).json({ error: 'next_maintenance_before_completed' })
    }

    const reportUrl = file?.url ?? null

    const result = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows: assetRows } = await c.query('select id, org_id, site_id, name from public.assets where id = $1', [req.params.id])
      const asset = assetRows[0]
      if (!asset) return { error: 'not_found' as const }

      // Closing the job goes through the one close path: it draws the job's
      // reserved parts, resolves its defect, stamps actual_end and tells whoever
      // raised it. First, so a shortfall refuses the completion before anything
      // is recorded (the transaction commits on a returned error).
      if (work_order_id) {
        const { rows: woRows } = await c.query('select status from public.work_orders where id = $1 and deleted_at is null', [work_order_id])
        if (woRows[0] && woRows[0].status !== 'closed') {
          const closed = await transitionWorkOrder(c, work_order_id, 'closed', {
            actorId: req.claims!.sub, comment: 'Closed via maintenance completion.',
          })
          if ('error' in closed) return closed
        }
      }

      const { rows: evRows } = await c.query(
        `insert into public.maintenance_events
           (org_id, site_id, asset_id, source, pm_task_id, work_order_id, completed_at, next_maintenance_at, notes, report_url, performed_by)
         values (current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, current_user_id())
         returning *`,
        [asset.site_id, asset.id, source, pm_task_id ?? null, work_order_id ?? null, completed_at, next_maintenance_at, notes ?? null, reportUrl]
      )
      const event = evRows[0]

      if (pm_task_id) {
        await c.query(
          `update public.pm_tasks set status = 'completed', completed_at = $2 where id = $1 and status <> 'completed'`,
          [pm_task_id, completed_at]
        )
      }
      await c.query(
        'update public.assets set last_maintenance_at = $2, next_maintenance_at = $3 where id = $1',
        [asset.id, completed_at, next_maintenance_at]
      )
      // Was apply_asset_health(asset, 100) — a flat reset. The score is now
      // computed from five signals, so servicing an asset clears its overdue
      // maintenance signal and the rest still counts. The crossings fire from
      // inside the recompute exactly as before.
      await refreshAssetHealth(c, asset.id, req.claims!.sub)

      const activityBody = 'Maintenance completed.' + (notes ? ` ${notes}` : '')
      await c.query(
        `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
         values (current_org_id(), $1, current_user_id(), 'maintenance', $2, $3::jsonb)`,
        [asset.id, activityBody, JSON.stringify(file ? [{ url: file.url, name: file.name }] : [])]
      )

      await writeAuditLog(c, {
        orgId: asset.org_id, actorId: req.claims!.sub, action: 'maintenance.complete',
        entityType: 'asset', entityId: asset.id, after: event,
      })

      await notifyRoleHolders(c, {
        orgId: asset.org_id, siteId: asset.site_id, roles: ['owner', 'admin', 'manager'],
        actorId: req.claims!.sub, kind: 'work_completed',
        title: `Maintenance completed on ${asset.name || 'asset'}`,
        body: reportUrl ? 'Completed. Report attached.' : (notes || 'Completed.'),
        // Points at the asset, not the event: there is no maintenance-event
        // detail view to land on, and the asset panel is where the completion
        // and its report are actually visible.
        entityType: 'asset', entityId: asset.id,
        dedupePrefix: `work_completed:maintenance_event:${event.id}`,
      })

      return { data: event }
    })

    if ('error' in result) {
      if (result.error === 'insufficient_stock') return res.status(409).json({ error: 'insufficient_stock', shortfalls: result.shortfalls })
      if (result.error === 'invalid_transition') return res.status(409).json({ error: 'invalid_transition', from: result.from, to: 'closed' })
      return res.status(404).json({ error: 'not_found' })
    }
    res.status(201).json(result.data)
  })
)

// Upload or replace the report on an already-recorded completion.
maintenanceEventsRouter.post(
  '/maintenance-completions/:id/report',
  requireCap('maintenance:complete'),
  ...uploadRoute(REPORT_UPLOAD, async (req, res, file) => {
    const url = file.url
    const row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query('update public.maintenance_events set report_url = $2 where id = $1 returning id, org_id, asset_id, site_id', [req.params.id, url])
      if (!rows[0]) return null
      await c.query(
        `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
         values (current_org_id(), $1, current_user_id(), 'maintenance', 'Maintenance completion report uploaded.', $2::jsonb)`,
        [rows[0].asset_id, JSON.stringify([{ url, name: file.name }])]
      )
      const { rows: full } = await c.query('select * from public.maintenance_events where id = $1', [req.params.id])
      await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'maintenance_event.attachment.add', entityType: 'maintenance_event', entityId: rows[0].id, after: { url, name: file.name } })
      await notifyRoleHolders(c, {
        orgId: rows[0].org_id, siteId: rows[0].site_id, roles: ['owner', 'admin', 'manager'],
        actorId: req.claims!.sub, kind: 'report_uploaded',
        title: 'Maintenance report uploaded', body: file.name,
        entityType: 'asset', entityId: rows[0].asset_id,
        dedupePrefix: `report_uploaded:maintenance_event:${rows[0].id}`,
      })
      return full[0]
    })
    if (!row) return res.status(404).json({ error: 'not_found' })
    res.status(201).json(row)
  })
)
