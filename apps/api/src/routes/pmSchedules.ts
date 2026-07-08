import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'

export const pmSchedulesRouter = Router()
pmSchedulesRouter.use(requireAuth, requireOrg)

const ALLOWED = ['asset_id', 'site_id', 'title', 'description', 'frequency', 'estimated_hours', 'next_due', 'assignee_id', 'active']

const SELECT = `
  select p.*,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code) end as site,
    case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as assignee
  from public.pm_schedules p
  left join public.assets a on a.id = p.asset_id
  left join public.sites s on s.id = p.site_id
  left join public.users u on u.id = p.assignee_id
`

const scheduleInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual']),
  estimated_hours: z.number().nullable().optional(),
  next_due: z.string(),
  assignee_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
})

pmSchedulesRouter.get('/pm-schedules', async (req, res) => {
  const activeOnly = req.query.activeOnly !== 'false'
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where p.deleted_at is null']
    if (activeOnly) clauses.push('and p.active = true')
    clauses.push('order by p.next_due asc')
    return c.query(clauses.join(' ')).then((r) => r.rows)
  })
  res.json(rows)
})

pmSchedulesRouter.post('/pm-schedules', requireCap('pm:create'), async (req, res) => {
  const parsed = scheduleInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.pm_schedules (org_id, ${columns}) values (current_org_id(), ${placeholders}) returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where p.id = $1`, [rows[0].id])
    const schedule = full[0]
    await writeAuditLog(c, { orgId: schedule.org_id, actorId: req.claims!.sub, action: 'pm_schedule.create', entityType: 'pm_schedule', entityId: schedule.id, after: schedule })
    return schedule
  })
  res.status(201).json(row)
})

pmSchedulesRouter.patch('/pm-schedules/:id', requireCap('pm:update'), async (req, res) => {
  const parsed = scheduleInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.pm_schedules set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where p.id = $1`, [req.params.id])
    const schedule = full[0]
    await writeAuditLog(c, { orgId: schedule.org_id, actorId: req.claims!.sub, action: 'pm_schedule.update', entityType: 'pm_schedule', entityId: schedule.id, after: parsed.data })
    return schedule
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

pmSchedulesRouter.delete('/pm-schedules/:id', requireCap('pm:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.pm_schedules set deleted_at = now(), active = false where id = $1 returning id, org_id',
      [req.params.id]
    )
    const schedule = rows[0]
    if (schedule) await writeAuditLog(c, { orgId: schedule.org_id, actorId: req.claims!.sub, action: 'pm_schedule.archive', entityType: 'pm_schedule', entityId: schedule.id })
    return schedule
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
