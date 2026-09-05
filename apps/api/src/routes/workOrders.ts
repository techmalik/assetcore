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
import { uploadTo } from '../files.js'

export const workOrdersRouter = Router()
workOrdersRouter.use(requireAuth, requireOrg, requireActiveMembership)

const attachmentUpload = uploadTo('attachments')

const ALLOWED = [
  'site_id', 'asset_id', 'ref', 'title', 'description', 'type', 'status', 'priority',
  'assignee_id', 'sla_due', 'parts', 'cost_cents',
  // Phase 2 (0003). cost_cents is the ACTUAL cost; estimated_cost_cents sits
  // beside it rather than a second "actual" column.
  'estimated_hours', 'actual_hours', 'estimated_cost_cents',
  'planned_start', 'planned_end', 'actual_start', 'actual_end',
  'completion_notes', 'root_cause', 'failure_mode', 'corrective_actions',
  'safety_observations', 'downtime_hours',
  'incident_type', 'discovery_method', 'systems_affected',
]

// Fields the close dialog collects. Kept as its own list so closing a job can
// never quietly rewrite its asset, assignee or priority.
const REPORT_FIELDS = [
  'completion_notes', 'root_cause', 'failure_mode', 'corrective_actions',
  'safety_observations', 'downtime_hours', 'actual_hours', 'cost_cents',
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
    case when cu.id is null then null else jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'email', cu.email) end as creator,
    (select count(*)::int from public.work_order_tasks t where t.work_order_id = w.id) as task_count,
    (select count(*)::int from public.work_order_tasks t where t.work_order_id = w.id and t.done) as task_done_count,
    (select count(*)::int from public.work_order_parts p where p.work_order_id = w.id) as part_count
  from public.work_orders w
  left join public.sites s on s.id = w.site_id
  left join public.assets a on a.id = w.asset_id
  left join public.users au on au.id = w.assignee_id
  left join public.users cu on cu.id = w.created_by
`

// An empty <input type="date"> posts '', which must clear the column rather
// than fail validation.
const woDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'expected YYYY-MM-DD' })

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

  estimated_hours: z.number().nonnegative().nullable().optional(),
  actual_hours: z.number().nonnegative().nullable().optional(),
  estimated_cost_cents: z.number().int().nonnegative().nullable().optional(),
  planned_start: woDate,
  planned_end: woDate,
  actual_start: z.string().nullable().optional(),
  actual_end: z.string().nullable().optional(),
  completion_notes: z.string().nullable().optional(),
  root_cause: z.string().nullable().optional(),
  failure_mode: z.string().nullable().optional(),
  corrective_actions: z.string().nullable().optional(),
  safety_observations: z.string().nullable().optional(),
  downtime_hours: z.number().nonnegative().nullable().optional(),
  incident_type: z.string().nullable().optional(),
  discovery_method: z.string().nullable().optional(),
  systems_affected: z.string().nullable().optional(),
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
    const [{ rows: tasks }, { rows: parts }] = await Promise.all([
      c.query(
        `select t.*, case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as completed_by
         from public.work_order_tasks t
         left join public.users u on u.id = t.done_by
         where t.work_order_id = $1 order by t.sequence asc, t.created_at asc`,
        [req.params.id]
      ),
      c.query(
        `select wp.*,
           case when sp.id is null then null else jsonb_build_object(
             'id', sp.id, 'part_number', sp.part_number, 'name', sp.name,
             'unit', sp.unit, 'quantity_in_stock', sp.quantity_in_stock) end as part
         from public.work_order_parts wp
         left join public.spare_parts sp on sp.id = wp.part_id
         where wp.work_order_id = $1 order by wp.created_at asc`,
        [req.params.id]
      ),
    ])
    return { ...wo, activity, tasks, parts }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// WO-{year}-{4-digit sequence within the org for that year}, matching the
// seed data's format. Not concurrency-safe under heavy simultaneous creates
// (fine at this scale) — the ref column's unique constraint is the backstop.
async function generateWoRef(c: import('pg').PoolClient): Promise<string> {
  const year = new Date().getFullYear()
  const { rows } = await c.query(
    `select count(*)::int as n from public.work_orders where ref like $1`,
    [`WO-${year}-%`]
  )
  return `WO-${year}-${String(rows[0].n + 1).padStart(4, '0')}`
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

const transitionInput = z.object({
  status: z.string().min(1),
  comment: z.string().optional(),
  // Only read when closing — the completion report the technician fills in.
  report: z.record(z.unknown()).optional(),
})

/** Draws every unconsumed part on a work order out of stock, writing one ledger
 * row per part. Returns the parts that don't have enough on hand instead of
 * going negative, so the caller can roll the whole close back and say why. */
async function consumeParts(
  c: import('pg').PoolClient,
  workOrderId: string
): Promise<{ shortfalls: Array<{ part_number: string; name: string; needed: number; in_stock: number }>; consumedCostCents: number }> {
  const { rows: lines } = await c.query(
    `select wp.id, wp.part_id, wp.quantity_required, wp.quantity_used, wp.unit_cost_cents
     from public.work_order_parts wp
     where wp.work_order_id = $1 and wp.consumed_at is null and wp.part_id is not null`,
    [workOrderId]
  )

  const shortfalls: Array<{ part_number: string; name: string; needed: number; in_stock: number }> = []
  let consumedCostCents = 0

  for (const line of lines) {
    // A job closed without anyone recording usage consumed what it reserved.
    const qty = Number(line.quantity_used) > 0 ? Number(line.quantity_used) : Number(line.quantity_required)
    if (qty <= 0) continue

    const { rows: part } = await c.query(
      'select id, part_number, name, quantity_in_stock, unit_cost_cents from public.spare_parts where id = $1 for update',
      [line.part_id]
    )
    if (!part[0]) continue

    const inStock = Number(part[0].quantity_in_stock)
    if (inStock < qty) {
      shortfalls.push({ part_number: part[0].part_number, name: part[0].name, needed: qty, in_stock: inStock })
      continue
    }

    const balanceAfter = inStock - qty
    const unitCost = line.unit_cost_cents ?? part[0].unit_cost_cents ?? 0
    await c.query('update public.spare_parts set quantity_in_stock = $2 where id = $1', [line.part_id, balanceAfter])
    await c.query(
      `insert into public.stock_movements
         (org_id, part_id, kind, quantity, balance_after, unit_cost_cents, reason, work_order_id, actor_id)
       values (current_org_id(), $1, 'consumption', $2, $3, $4, 'Consumed on work order', $5, current_user_id())`,
      [line.part_id, -qty, balanceAfter, unitCost, workOrderId]
    )
    await c.query(
      'update public.work_order_parts set consumed_at = now(), quantity_used = $2, unit_cost_cents = $3 where id = $1',
      [line.id, qty, unitCost]
    )
    consumedCostCents += Math.round(unitCost * qty)
  }

  return { shortfalls, consumedCostCents }
}

workOrdersRouter.post('/work-orders/:id/transition', requireCap('wo:transition'), async (req, res) => {
  const parsed = transitionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { status: newStatus, comment, report } = parsed.data
  const woId = String(req.params.id)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select status, actual_start from public.work_orders where id = $1',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    const allowed = WO_TRANSITIONS[cur[0].status] || []
    if (!allowed.includes(newStatus)) return { error: 'invalid_transition' as const, from: cur[0].status }

    // Closing draws the reserved parts out of stock. Do it before the status
    // write so a shortfall rolls the whole thing back.
    let consumed = { shortfalls: [] as Array<{ part_number: string; name: string; needed: number; in_stock: number }>, consumedCostCents: 0 }
    if (newStatus === 'closed') {
      consumed = await consumeParts(c, woId)
      if (consumed.shortfalls.length > 0) {
        return { error: 'insufficient_stock' as const, shortfalls: consumed.shortfalls }
      }
    }

    // Optional completion report, restricted to the report fields.
    const reportPatch = report ? buildSet(report, REPORT_FIELDS, 2) : { setSql: '', values: [] as unknown[] }
    const extra = [
      reportPatch.setSql,
      // Stamp the clock the first time work actually starts, and when it ends.
      newStatus === 'in_progress' && !cur[0].actual_start ? 'actual_start = now()' : '',
      newStatus === 'closed' ? 'actual_end = now()' : '',
    ].filter(Boolean).join(', ')

    const { rows } = await c.query(
      `update public.work_orders
          set status = $2, updated_at = now()${extra ? `, ${extra}` : ''}
        where id = $1 returning id, org_id`,
      [req.params.id, newStatus, ...reportPatch.values]
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
    if (result.error === 'insufficient_stock') {
      return res.status(409).json({ error: 'insufficient_stock', shortfalls: result.shortfalls })
    }
    return res.status(409).json({ error: 'invalid_transition', from: result.from, to: newStatus })
  }
  res.json(result.data)
})

workOrdersRouter.post('/work-orders/:id/attachments', requireCap('wo:update'), attachmentUpload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'missing_file' })
  const url = `attachments/${file.filename}`

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body, attachments)
       values (current_org_id(), $1, current_user_id(), 'attachment', $2, $3::jsonb)
       returning *`,
      [req.params.id, file.originalname, JSON.stringify([{ url, name: file.originalname, size: file.size }])]
    ).then((r) => r.rows[0])
  )
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

// ── Task checklist ───────────────────────────────────────────────────────────
// The steps a job is actually worked from. 0001 had only a free-text
// description, so there was nothing to tick off and nothing to audit.

const taskInput = z.object({
  description: z.string().min(1).max(500),
  sequence: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).nullable().optional(),
})

workOrdersRouter.get('/work-orders/:id/tasks', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select t.*, case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as completed_by
       from public.work_order_tasks t
       left join public.users u on u.id = t.done_by
       where t.work_order_id = $1 order by t.sequence asc, t.created_at asc`,
      [req.params.id]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

workOrdersRouter.post('/work-orders/:id/tasks', requireCap('wo:update'), async (req, res) => {
  const parsed = taskInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Append to the end unless the caller places it explicitly.
    const sequence = parsed.data.sequence ?? (await c.query(
      'select coalesce(max(sequence), -1) + 1 as next from public.work_order_tasks where work_order_id = $1',
      [req.params.id]
    )).rows[0].next
    const { rows } = await c.query(
      `insert into public.work_order_tasks (org_id, work_order_id, sequence, description, notes)
       values (current_org_id(), $1, $2, $3, $4) returning *`,
      [req.params.id, sequence, parsed.data.description, parsed.data.notes ?? null]
    )
    return rows[0]
  })
  res.status(201).json(row)
})

workOrdersRouter.patch('/work-orders/:id/tasks/:taskId', requireCap('wo:update'), async (req, res) => {
  const parsed = z.object({
    done: z.boolean().optional(),
    description: z.string().min(1).max(500).optional(),
    notes: z.string().max(500).nullable().optional(),
    sequence: z.number().int().nonnegative().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Ticking a step records who and when; un-ticking clears both, so the
    // record never claims someone completed a step that is now open.
    const { rows } = await c.query(
      `update public.work_order_tasks
          set description = coalesce($3, description),
              notes       = coalesce($4, notes),
              sequence    = coalesce($5, sequence),
              done        = coalesce($6, done),
              done_by     = case when $6 is null then done_by  when $6 then current_user_id() else null end,
              done_at     = case when $6 is null then done_at  when $6 then now()             else null end
        where id = $1 and work_order_id = $2
        returning *`,
      [req.params.taskId, req.params.id, parsed.data.description ?? null, parsed.data.notes ?? null,
       parsed.data.sequence ?? null, parsed.data.done ?? null]
    )
    return rows[0] ?? null
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

workOrdersRouter.delete('/work-orders/:id/tasks/:taskId', requireCap('wo:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('delete from public.work_order_tasks where id = $1 and work_order_id = $2 returning id',
      [req.params.taskId, req.params.id]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// ── Parts on a work order ────────────────────────────────────────────────────
// Replaces the free-text `parts` JSON blob with lines that point at real stock.

const woPartInput = z.object({
  part_id: z.string().uuid().nullable().optional(),
  description: z.string().max(300).nullable().optional(),
  quantity_required: z.number().positive(),
  quantity_used: z.number().nonnegative().optional(),
  unit_cost_cents: z.number().int().nonnegative().nullable().optional(),
}).refine((v) => v.part_id || v.description, { message: 'part_id or description required' })

workOrdersRouter.get('/work-orders/:id/parts', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select wp.*,
         case when sp.id is null then null else jsonb_build_object(
           'id', sp.id, 'part_number', sp.part_number, 'name', sp.name,
           'unit', sp.unit, 'quantity_in_stock', sp.quantity_in_stock) end as part
       from public.work_order_parts wp
       left join public.spare_parts sp on sp.id = wp.part_id
       where wp.work_order_id = $1 order by wp.created_at asc`,
      [req.params.id]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

workOrdersRouter.post('/work-orders/:id/parts', requireCap('wo:update'), async (req, res) => {
  const parsed = woPartInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const d = parsed.data

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Snapshot the price now: what it cost on the day is what the job cost,
    // even if the part is repriced later.
    let unitCost = d.unit_cost_cents ?? null
    if (unitCost == null && d.part_id) {
      const { rows } = await c.query('select unit_cost_cents from public.spare_parts where id = $1', [d.part_id])
      unitCost = rows[0] ? Number(rows[0].unit_cost_cents) : null
    }
    const { rows } = await c.query(
      `insert into public.work_order_parts
         (org_id, work_order_id, part_id, description, quantity_required, quantity_used, unit_cost_cents, added_by)
       values (current_org_id(), $1, $2, $3, $4, $5, $6, current_user_id())
       returning id`,
      [req.params.id, d.part_id ?? null, d.description ?? null, d.quantity_required, d.quantity_used ?? 0, unitCost]
    )
    const { rows: full } = await c.query(
      `select wp.*,
         case when sp.id is null then null else jsonb_build_object(
           'id', sp.id, 'part_number', sp.part_number, 'name', sp.name,
           'unit', sp.unit, 'quantity_in_stock', sp.quantity_in_stock) end as part
       from public.work_order_parts wp
       left join public.spare_parts sp on sp.id = wp.part_id where wp.id = $1`,
      [rows[0].id]
    )
    return full[0]
  })
  res.status(201).json(row)
})

workOrdersRouter.patch('/work-orders/:id/parts/:lineId', requireCap('wo:update'), async (req, res) => {
  const parsed = z.object({
    quantity_required: z.number().positive().optional(),
    quantity_used: z.number().nonnegative().optional(),
    unit_cost_cents: z.number().int().nonnegative().nullable().optional(),
    description: z.string().max(300).nullable().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    // Once stock has moved for a line, editing it would put the ledger and the
    // balance out of step. Reverse it with a stock adjustment instead.
    const { rows: cur } = await c.query(
      'select consumed_at from public.work_order_parts where id = $1 and work_order_id = $2',
      [req.params.lineId, req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    if (cur[0].consumed_at) return { error: 'already_consumed' as const }

    const { setSql, values } = buildSet(parsed.data, ['quantity_required', 'quantity_used', 'unit_cost_cents', 'description'])
    if (!setSql) return { error: 'empty_patch' as const }
    const { rows } = await c.query(
      `update public.work_order_parts set ${setSql} where id = $1 returning *`,
      [req.params.lineId, ...values]
    )
    return { data: rows[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'already_consumed') return res.status(409).json({ error: 'already_consumed' })
    return res.status(400).json({ error: 'empty_patch' })
  }
  res.json(result.data)
})

workOrdersRouter.delete('/work-orders/:id/parts/:lineId', requireCap('wo:update'), async (req, res) => {
  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'delete from public.work_order_parts where id = $1 and work_order_id = $2 and consumed_at is null returning id',
      [req.params.lineId, req.params.id]
    )
    if (rows[0]) return { ok: true }
    const { rows: exists } = await c.query(
      'select consumed_at from public.work_order_parts where id = $1 and work_order_id = $2',
      [req.params.lineId, req.params.id]
    )
    return exists[0] ? { error: 'already_consumed' as const } : { error: 'not_found' as const }
  })
  if ('error' in result) {
    return res.status(result.error === 'already_consumed' ? 409 : 404).json({ error: result.error })
  }
  res.status(204).end()
})
