import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'
import { uploadTo, cleanupOrphanedUpload } from '../files.js'

export const workOrdersRouter = Router()
workOrdersRouter.use(requireAuth, requireOrg, requireActiveMembership)

const attachmentUpload = uploadTo('attachments')

const ALLOWED = [
  'site_id', 'asset_id', 'ref', 'title', 'description', 'type', 'status', 'priority',
  'assignee_id', 'sla_due', 'parts', 'cost_cents',
]

// Status transitions allowed per current status — mirrors apps/app/src/lib/db/workOrders.js.
const WO_TRANSITIONS: Record<string, string[]> = {
  new: ['assigned', 'in_progress', 'closed'],
  assigned: ['in_progress', 'awaiting_parts', 'closed'],
  in_progress: ['awaiting_parts', 'inspection', 'closed'],
  awaiting_parts: ['in_progress', 'closed'],
  inspection: ['closed', 'in_progress'],
  closed: [],
}
const WO_STATUS_LABEL: Record<string, string> = {
  new: 'New', assigned: 'Assigned', in_progress: 'In Progress',
  awaiting_parts: 'Awaiting Parts', inspection: 'Inspection', closed: 'Closed',
}

const SELECT = `
  select w.*,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when au.id is null then null else jsonb_build_object('id', au.id, 'full_name', au.full_name, 'email', au.email) end as assignee,
    case when cu.id is null then null else jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'email', cu.email) end as creator
  from public.work_orders w
  left join public.sites s on s.id = w.site_id
  left join public.assets a on a.id = w.asset_id
  left join public.users au on au.id = w.assignee_id
  left join public.users cu on cu.id = w.created_by
`

const woInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  asset_id: z.string().uuid().nullable().optional(),
  // The UI never collects a ref — it's generated server-side (generateWoRef)
  // unless the caller explicitly provides one.
  ref: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(['corrective', 'preventive', 'inspection', 'emergency']).optional(),
  status: z.enum(['new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  sla_due: z.string().nullable().optional(),
  parts: z.array(z.unknown()).optional(),
  cost_cents: z.number().int().nullable().optional(),
})

workOrdersRouter.get('/work-orders', async (req, res) => {
  const { status, priority } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where w.deleted_at is null']
    const values: unknown[] = []
    if (typeof status === 'string') { values.push(status); clauses.push(`and w.status = $${values.length}`) }
    if (typeof priority === 'string') { values.push(priority); clauses.push(`and w.priority = $${values.length}`) }
    clauses.push('order by w.created_at desc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

workOrdersRouter.get('/work-orders/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${SELECT} where w.id = $1`, [req.params.id])
    const wo = rows[0]
    if (!wo) return null
    const { rows: activity } = await c.query(
      `select wa.*, case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
       from public.work_order_activity wa
       left join public.users u on u.id = wa.user_id
       where wa.work_order_id = $1
       order by wa.created_at asc`,
      [req.params.id]
    )
    return { ...wo, activity }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// WO-{year}-{4-digit sequence within the org for that year}. Delegates to
// next_wo_ref() (0011_wo_ref_counter.sql) — a real per-org/year counter
// table, upserted under its own row lock — instead of counting existing
// rows itself. apply_asset_health()'s auto-draft path uses the same
// function, so there is exactly one sequence per org/year, not two
// independent counts that could compute the same next number and collide.
async function generateWoRef(c: import('pg').PoolClient): Promise<string> {
  const { rows } = await c.query(`select public.next_wo_ref(current_org_id()) as ref`)
  return rows[0].ref
}

workOrdersRouter.post('/work-orders', requireCap('wo:create'), async (req, res) => {
  const parsed = woInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { ref: providedRef, ...rest } = parsed.data
  const { columns, placeholders, values } = buildInsert(rest, ALLOWED.filter((c) => c !== 'ref'), 1)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const ref = providedRef || (await generateWoRef(c))
    const { rows } = await c.query(
      `insert into public.work_orders (org_id, created_by, ref, ${columns})
       values (current_org_id(), current_user_id(), $1, ${placeholders})
       returning id`,
      [ref, ...values]
    )
    const { rows: full } = await c.query(`${SELECT} where w.id = $1`, [rows[0].id])
    const wo = full[0]
    await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.create', entityType: 'work_order', entityId: wo.id, after: wo })
    return wo
  })
  res.status(201).json(row)
})

workOrdersRouter.patch('/work-orders/:id', requireCap('wo:update'), async (req, res) => {
  const parsed = woInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.work_orders set ${setSql}, updated_at = now() where id = $1 returning id, org_id`,
      [req.params.id, ...values]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where w.id = $1`, [req.params.id])
    const wo = full[0]
    await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.update', entityType: 'work_order', entityId: wo.id, after: parsed.data })
    return wo
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

const transitionInput = z.object({ status: z.string().min(1), comment: z.string().optional() })

workOrdersRouter.post('/work-orders/:id/transition', requireCap('wo:transition'), async (req, res) => {
  const parsed = transitionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { status: newStatus, comment } = parsed.data

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select status from public.work_orders where id = $1', [req.params.id])
    if (!cur[0]) return { error: 'not_found' as const }
    const allowed = WO_TRANSITIONS[cur[0].status] || []
    if (!allowed.includes(newStatus)) return { error: 'invalid_transition' as const, from: cur[0].status }

    const { rows } = await c.query(
      'update public.work_orders set status = $2, updated_at = now() where id = $1 returning id, org_id',
      [req.params.id, newStatus]
    )
    const wo = rows[0]

    await c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'status_change', $2)`,
      [req.params.id, comment || `Status changed to ${WO_STATUS_LABEL[newStatus] || newStatus}`]
    )

    await writeAuditLog(c, {
      orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.transition', entityType: 'work_order', entityId: wo.id,
      before: { status: cur[0].status }, after: { status: newStatus },
    })

    const { rows: full } = await c.query(`${SELECT} where w.id = $1`, [req.params.id])
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'invalid_transition', from: result.from, to: newStatus })
  }
  res.json(result.data)
})

workOrdersRouter.post('/work-orders/:id/attachments', requireCap('wo:update'), attachmentUpload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'missing_file' })
  const url = `attachments/${file.filename}`

  let row
  try {
    row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query(
        `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body, attachments)
         values (current_org_id(), $1, current_user_id(), 'attachment', $2, $3::jsonb)
         returning *`,
        [req.params.id, file.originalname, JSON.stringify([{ url, name: file.originalname, size: file.size }])]
      )
      const activity = rows[0]
      await writeAuditLog(c, { orgId: activity.org_id, actorId: req.claims!.sub, action: 'work_order.attachment.add', entityType: 'work_order', entityId: activity.work_order_id, after: { url, name: file.originalname, size: file.size } })
      return activity
    })
  } catch (err) {
    await cleanupOrphanedUpload(file.path)
    throw err
  }
  res.status(201).json(row)
})

const commentInput = z.object({ body: z.string().min(1) })

workOrdersRouter.post('/work-orders/:id/comments', requireCap('wo:update'), async (req, res) => {
  const parsed = commentInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'comment', $2)
       returning *`,
      [req.params.id, parsed.data.body]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
})

workOrdersRouter.delete('/work-orders/:id', requireCap('wo:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.work_orders set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const wo = rows[0]
    if (wo) await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.delete', entityType: 'work_order', entityId: wo.id })
    return wo
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
