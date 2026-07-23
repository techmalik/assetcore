import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { uploadTo, guardedSingle, validateUploadOrCleanup, cleanupOrphanedUpload, DOCUMENT_MIME_TYPES } from '../files.js'
import { notifyRoleHolders, notifyWorkOrderClosed } from '../notify.js'

export const maintenanceEventsRouter = Router()
maintenanceEventsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const reportUpload = uploadTo('maintenance-completions', { maxSizeBytes: 25 * 1024 * 1024 })

// Multipart bodies arrive with every field as a string, including the ones
// that would otherwise be omitted — an empty string from a blank optional
// input should mean "not provided", not a literal empty value.
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v)

// Plain YYYY-MM-DD, validated and compared as strings — never wrapped in a
// JS Date for comparison. Dates round-tripped through `new Date(...)` re-render
// in the process's local TZ and can drift a calendar day either side of what
// the user actually typed (see db.ts's DATE type-parser override, same issue).
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const completionInput = z.object({
  source: z.preprocess(blankToUndefined, z.enum(['pm_task', 'work_order', 'manual'])).default('manual'),
  pm_task_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  work_order_id: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  completed_at: dateStr,
  next_maintenance_at: dateStr,
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
  guardedSingle(reportUpload.single('report')),
  async (req, res) => {
    const parsed = completionInput.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
    const { source, pm_task_id, work_order_id, completed_at, next_maintenance_at, notes } = parsed.data

    if (completed_at > todayLocal()) {
      return res.status(400).json({ error: 'completed_at_in_future' })
    }
    if (next_maintenance_at <= completed_at) {
      return res.status(400).json({ error: 'next_maintenance_before_completed' })
    }

    let reportUrl: string | null = null
    if (req.file) {
      if (!(await validateUploadOrCleanup(req.file.path, DOCUMENT_MIME_TYPES))) {
        return res.status(400).json({ error: 'unsupported_type' })
      }
      reportUrl = `maintenance-completions/${req.file.filename}`
    }

    let result
    try {
      result = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows: assetRows } = await c.query('select id, org_id, site_id, name from public.assets where id = $1', [req.params.id])
      const asset = assetRows[0]
      if (!asset) return { error: 'not_found' as const }

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
      if (work_order_id) {
        const { rows: woRows } = await c.query(
          `update public.work_orders set status = 'closed', updated_at = now() where id = $1 and status <> 'closed' returning id, ref, title`,
          [work_order_id]
        )
        if (woRows[0]) {
          await c.query(
            `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
             values (current_org_id(), $1, current_user_id(), 'status_change', 'Closed via maintenance completion.')`,
            [work_order_id]
          )
          await notifyWorkOrderClosed(c, {
            orgId: asset.org_id, woId: woRows[0].id, ref: woRows[0].ref, title: woRows[0].title,
            actorId: req.claims!.sub,
          })
        }
      }

      await c.query(
        'update public.assets set last_maintenance_at = $2, next_maintenance_at = $3 where id = $1',
        [asset.id, completed_at, next_maintenance_at]
      )
      await c.query('select public.apply_asset_health($1, 100, $2)', [asset.id, req.claims!.sub])

      const activityBody = 'Maintenance completed — health reset to 100%.' + (notes ? ` ${notes}` : '')
      await c.query(
        `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
         values (current_org_id(), $1, current_user_id(), 'maintenance', $2, $3::jsonb)`,
        [asset.id, activityBody, JSON.stringify(reportUrl ? [{ url: reportUrl, name: req.file!.originalname }] : [])]
      )

      await writeAuditLog(c, {
        orgId: asset.org_id, actorId: req.claims!.sub, action: 'maintenance.complete',
        entityType: 'asset', entityId: asset.id, after: event,
      })

      await notifyRoleHolders(c, {
        orgId: asset.org_id, siteId: asset.site_id, roles: ['owner', 'ops_manager'],
        actorId: req.claims!.sub, kind: 'work_completed',
        title: `Maintenance completed on ${asset.name || 'asset'}`,
        body: reportUrl ? 'Completed. Report attached.' : (notes || 'Completed.'),
        entityType: 'maintenance_event', entityId: event.id,
        dedupePrefix: `work_completed:maintenance_event:${event.id}`,
      })

      return { data: event }
      })
    } catch (err) {
      await cleanupOrphanedUpload(req.file?.path)
      throw err
    }

    if ('error' in result) {
      await cleanupOrphanedUpload(req.file?.path)
      return res.status(404).json({ error: 'not_found' })
    }
    res.status(201).json(result.data)
  }
)

// Upload or replace the report on an already-recorded completion.
maintenanceEventsRouter.post(
  '/maintenance-completions/:id/report',
  requireCap('maintenance:complete'),
  guardedSingle(reportUpload.single('report')),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'missing_file' })
    if (!(await validateUploadOrCleanup(req.file.path, DOCUMENT_MIME_TYPES))) {
      return res.status(400).json({ error: 'unsupported_type' })
    }
    const url = `maintenance-completions/${req.file.filename}`
    let row
    try {
      row = await withOrgContext(claimsFromReq(req), async (c) => {
        const { rows } = await c.query('update public.maintenance_events set report_url = $2 where id = $1 returning id, org_id, asset_id, site_id', [req.params.id, url])
        if (!rows[0]) return null
        await c.query(
          `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
           values (current_org_id(), $1, current_user_id(), 'maintenance', 'Maintenance completion report uploaded.', $2::jsonb)`,
          [rows[0].asset_id, JSON.stringify([{ url, name: req.file!.originalname }])]
        )
        const { rows: full } = await c.query('select * from public.maintenance_events where id = $1', [req.params.id])
        await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'maintenance_event.attachment.add', entityType: 'maintenance_event', entityId: rows[0].id, after: { url, name: req.file!.originalname } })
        await notifyRoleHolders(c, {
          orgId: rows[0].org_id, siteId: rows[0].site_id, roles: ['owner', 'ops_manager'],
          actorId: req.claims!.sub, kind: 'report_uploaded',
          title: 'Maintenance report uploaded', body: req.file!.originalname,
          entityType: 'maintenance_event', entityId: rows[0].id,
          dedupePrefix: `report_uploaded:maintenance_event:${rows[0].id}`,
        })
        return full[0]
      })
    } catch (err) {
      await cleanupOrphanedUpload(req.file.path)
      throw err
    }
    if (!row) {
      await cleanupOrphanedUpload(req.file.path)
      return res.status(404).json({ error: 'not_found' })
    }
    res.status(201).json(row)
  }
)
