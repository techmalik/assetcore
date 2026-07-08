import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet } from '../sqlUtil.js'

export const pmTasksRouter = Router()
pmTasksRouter.use(requireAuth, requireOrg)

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
  const { statuses, dueBefore, dueAfter, limit } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    if (typeof statuses === 'string' && statuses) {
      values.push(statuses.split(','))
      clauses.push(`and t.status = any($${values.length})`)
    }
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
      await writeAuditLog(c, { orgId: task.org_id, actorId: req.claims!.sub, action: 'pm_task.complete', entityType: 'pm_task', entityId: task.id, after: task })
    }
    return task
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

pmTasksRouter.post('/pm/generate', requireCap('pm:create'), async (req, res) => {
  const count = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select public.generate_pm_tasks(current_org_id()) as count').then((r) => r.rows[0].count)
  )
  res.json({ count })
})
