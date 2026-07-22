import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet } from '../sqlUtil.js'
import { uploadTo, cleanupOrphanedUpload } from '../files.js'

export const pmTasksRouter = Router()
pmTasksRouter.use(requireAuth, requireOrg, requireActiveMembership)

const reportUpload = uploadTo('maintenance-reports')

const ALLOWED = ['status', 'assignee_id', 'notes', 'checklist_results', 'completed_at', 'due_date']

const SELECT = `
  select t.*,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code) end as site,
    case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as assignee,
    case when sch.id is null then null else jsonb_build_object('title', sch.title, 'frequency', sch.frequency) end as schedule
  from public.pm_tasks t
  left join public.assets a on a.id = t.asset_id
  left join public.sites s on s.id = t.site_id
  left join public.users u on u.id = t.assignee_id
  left join public.pm_schedules sch on sch.id = t.schedule_id
`

pmTasksRouter.get('/pm-tasks', async (req, res) => {
  const { statuses, dueBefore, dueAfter, limit, asset_id } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    if (typeof statuses === 'string' && statuses) {
      values.push(statuses.split(','))
      clauses.push(`and t.status = any($${values.length})`)
    }
    if (typeof asset_id === 'string' && asset_id) { values.push(asset_id); clauses.push(`and t.asset_id = $${values.length}`) }
    if (typeof dueBefore === 'string') { values.push(dueBefore); clauses.push(`and t.due_date <= $${values.length}`) }
    if (typeof dueAfter === 'string') { values.push(dueAfter); clauses.push(`and t.due_date >= $${values.length}`) }
    clauses.push('order by t.due_date asc')
    values.push(typeof limit === 'string' ? Number(limit) || 100 : 100)
    clauses.push(`limit $${values.length}`)
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

const taskUpdateInput = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue', 'skipped']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  checklist_results: z.record(z.unknown()).nullable().optional(),
  completed_at: z.string().nullable().optional(),
  due_date: z.string().optional(),
})

pmTasksRouter.patch('/pm-tasks/:id', requireCap('pm:update'), async (req, res) => {
  const parsed = taskUpdateInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch = { ...parsed.data }
  if (patch.status === 'completed' && !patch.completed_at) patch.completed_at = new Date().toISOString()
  const { setSql, values } = buildSet(patch, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.pm_tasks set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where t.id = $1`, [req.params.id])
    const task = full[0]
    if (patch.status === 'completed') {
      // Completing a PM task is one of the ways an asset's maintenance gets
      // recorded — routed through the same maintenance_events table and
      // apply_asset_health() function the explicit "Complete Maintenance"
      // action (maintenanceEvents.ts) uses, so there's exactly one code path
      // that resets health and one that decides the next maintenance date.
      if (task.asset_id) {
        // greatest(..., current_date + 1) is the dead-zone fix from
        // 0007_health_lifecycle_fixes: a schedule whose next_due is today or
        // in the past would otherwise leave next_maintenance_at <=
        // last_maintenance_at, permanently excluding the asset from decay.
        const { rows: nextRows } = await c.query(
          `select greatest(coalesce((select s.next_due from public.pm_schedules s where s.id = $1), current_date + 90), current_date + 1) as next_due`,
          [task.schedule_id]
        )
        const nextMaintenance = nextRows[0].next_due

        await c.query(
          `insert into public.maintenance_events (org_id, site_id, asset_id, source, pm_task_id, completed_at, next_maintenance_at, notes, performed_by)
           values (current_org_id(), $1, $2, 'pm_task', $3, current_date, $4, $5, current_user_id())`,
          [task.site_id, task.asset_id, task.id, nextMaintenance, `Completed PM task: ${task.title}`]
        )
        await c.query(
          'update public.assets set last_maintenance_at = current_date, next_maintenance_at = $2 where id = $1',
          [task.asset_id, nextMaintenance]
        )
        await c.query('select public.apply_asset_health($1, 100, $2)', [task.asset_id, req.claims!.sub])
        await c.query(
          `insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
           values (current_org_id(), $1, current_user_id(), 'maintenance', $2)`,
          [task.asset_id, `Maintenance completed (${task.title}) — health reset to 100%.`]
        )
      }
      await writeAuditLog(c, { orgId: task.org_id, actorId: req.claims!.sub, action: 'pm_task.complete', entityType: 'pm_task', entityId: task.id, after: task })
    }
    return task
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// Maintenance report upload (by whoever can update PM tasks). Stored per task
// and surfaced in the asset's maintenance history + activity feed.
pmTasksRouter.post('/pm-tasks/:id/report', requireCap('pm:update'), reportUpload.single('report'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  const url = `maintenance-reports/${req.file.filename}`
  let row
  try {
    row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query('update public.pm_tasks set report_url = $2 where id = $1 returning id, org_id, asset_id', [req.params.id, url])
      if (!rows[0]) return null
      if (rows[0].asset_id) {
        await c.query(
          `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
           values (current_org_id(), $1, current_user_id(), 'maintenance', 'Maintenance report uploaded.', $2::jsonb)`,
          [rows[0].asset_id, JSON.stringify([{ url, name: req.file!.originalname }])]
        )
      }
      const { rows: full } = await c.query(`${SELECT} where t.id = $1`, [req.params.id])
      await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'pm_task.attachment.add', entityType: 'pm_task', entityId: rows[0].id, after: { url, name: req.file!.originalname } })
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
})

pmTasksRouter.post('/pm/generate', requireCap('pm:create'), async (req, res) => {
  const count = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select public.generate_pm_tasks(current_org_id()) as count').then((r) => r.rows[0].count)
  )
  res.json({ count })
})
