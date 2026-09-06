import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap, hasCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { refreshAssetHealth } from '../healthService.js'
import { buildSet, buildInsert } from '../sqlUtil.js'
import { uploadTo, cleanupOrphanedUpload } from '../files.js'
import { notifyUsers, notifyWorkOrderClosed } from '../notify.js'

export const workOrdersRouter = Router()
workOrdersRouter.use(requireAuth, requireOrg, requireActiveMembership)

const attachmentUpload = uploadTo('attachments')

// assigned_by/assigned_at are deliberately absent: they are stamped from the
// authenticated caller whenever assignee_id moves, never accepted from a body.
const ALLOWED = [
  'site_id', 'asset_id', 'ref', 'title', 'description', 'type', 'status', 'priority',
  'assignee_id', 'sla_due', 'parts', 'cost_cents',
  // 0022 — labour, schedule and the completion report. cost_cents is now
  // explicitly the ACTUAL cost, with estimated_cost_cents beside it rather
  // than a second "actual" column.
  'estimated_hours', 'actual_hours', 'estimated_cost_cents',
  'planned_start', 'planned_end', 'actual_start', 'actual_end',
  'completion_notes', 'root_cause', 'failure_mode', 'corrective_actions',
  'safety_observations', 'downtime_hours',
  'incident_type', 'discovery_method', 'systems_affected',
]

// Fields the close dialog collects. Its own list so closing a job can never
// quietly rewrite its asset, assignee or priority.
const REPORT_FIELDS = [
  'completion_notes', 'root_cause', 'failure_mode', 'corrective_actions',
  'safety_observations', 'downtime_hours', 'actual_hours', 'cost_cents',
]

// Status transitions allowed per current status — mirrors apps/app/src/lib/db/workOrders.js.
// `draft` is where auto-generated WOs land (apply_asset_health, 0013) — a
// planner approves it into `new` (or closes it) before the normal flow starts.
const WO_TRANSITIONS: Record<string, string[]> = {
  draft: ['new', 'closed'],
  new: ['assigned', 'in_progress', 'closed'],
  assigned: ['in_progress', 'awaiting_parts', 'closed'],
  in_progress: ['awaiting_parts', 'inspection', 'closed'],
  awaiting_parts: ['in_progress', 'closed'],
  inspection: ['closed', 'in_progress'],
  closed: [],
}
const WO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', new: 'New', assigned: 'Assigned', in_progress: 'In Progress',
  awaiting_parts: 'Awaiting Parts', inspection: 'Inspection', closed: 'Closed',
}

const SELECT = `
  select w.*,
    (select count(*)::int from public.work_order_tasks t where t.work_order_id = w.id) as task_count,
    (select count(*)::int from public.work_order_tasks t where t.work_order_id = w.id and t.done) as task_done_count,
    (select count(*)::int from public.work_order_parts p where p.work_order_id = w.id) as part_count,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when au.id is null then null else jsonb_build_object('id', au.id, 'full_name', au.full_name, 'email', au.email) end as assignee,
    case when cu.id is null then null else jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'email', cu.email) end as creator,
    case when ab.id is null then null else jsonb_build_object('id', ab.id, 'full_name', ab.full_name, 'email', ab.email) end as assigner
  from public.work_orders w
  left join public.sites s on s.id = w.site_id
  left join public.assets a on a.id = w.asset_id
  left join public.users au on au.id = w.assignee_id
  left join public.users cu on cu.id = w.created_by
  left join public.users ab on ab.id = w.assigned_by
`

// An empty <input type="date"> posts '', which must clear the column rather
// than fail validation.
const woDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'expected YYYY-MM-DD' })

const woInput = z.object({
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
  site_id: z.string().uuid().nullable().optional(),
  asset_id: z.string().uuid().nullable().optional(),
  // The UI never collects a ref — it's generated server-side (generateWoRef)
  // unless the caller explicitly provides one.
  ref: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(['corrective', 'preventive', 'inspection', 'emergency']).optional(),
  status: z.enum(['draft', 'new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  sla_due: z.string().nullable().optional(),
  parts: z.array(z.unknown()).optional(),
  cost_cents: z.number().int().nullable().optional(),
})

workOrdersRouter.get('/work-orders', async (req, res) => {
  const { status, priority, asset_id, location_id } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where w.deleted_at is null']
    const values: unknown[] = []
    if (typeof status === 'string') { values.push(status); clauses.push(`and w.status = $${values.length}`) }
    if (typeof priority === 'string') { values.push(priority); clauses.push(`and w.priority = $${values.length}`) }
    if (typeof asset_id === 'string' && asset_id) { values.push(asset_id); clauses.push(`and w.asset_id = $${values.length}`) }
    if (typeof location_id === 'string' && location_id) { values.push(location_id); clauses.push(`and w.site_id in (select id from public.sites where location_id = $${values.length})`) }
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
    const [{ rows: tasks }, { rows: parts }, { rows: defects }] = await Promise.all([
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
      // The finding this job came from, if it came from one — the other half
      // of the inspection -> defect -> work order chain.
      c.query(
        `select d.id, d.ref, d.title, d.severity, d.status, d.inspection_id
         from public.defects d
         where d.work_order_id = $1 and d.deleted_at is null
         order by d.identified_date desc`,
        [req.params.id]
      ),
    ])
    return { ...wo, activity, tasks, parts, defects }
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
// Exported so a job raised from a defect draws from that same counter.
export async function generateWoRef(c: import('pg').PoolClient): Promise<string> {
  const { rows } = await c.query(`select public.next_wo_ref(current_org_id()) as ref`)
  return rows[0].ref
}

// Inserts a work_order_activity row of kind 'assignment' — trg_notify_wo_activity
// (0014_activity_assignment_notifications.sql) reacts to it and fires wo_assigned
// to the new assignee (self-assignment and null-assignee already no-op there).
async function recordAssignment(c: import('pg').PoolClient, orgId: string, woId: string, actorId: string, assigneeId: string | null): Promise<void> {
  let body: string
  if (assigneeId) {
    const { rows } = await c.query('select full_name from public.users where id = $1', [assigneeId])
    body = `Assigned to ${rows[0]?.full_name || 'a team member'}.`
  } else {
    body = 'Assignee removed.'
  }
  // Stamp the durable columns as well as the activity row. The feed alone was
  // not enough: notifyWorkOrderClosed() used to reverse-engineer "the assigner"
  // as the newest assignment activity row, but unassignment writes one of those
  // too, so an assign-by-A / unassign-by-B sequence reported B.
  await c.query(
    `update public.work_orders
     set assigned_by = case when $2::uuid is null then null else $3::uuid end,
         assigned_at = case when $2::uuid is null then null else now() end
     where id = $1`,
    [woId, assigneeId, actorId]
  )
  await c.query(
    `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
     values ($1, $2, $3, 'assignment', $4)`,
    [orgId, woId, actorId, body]
  )
}

// `maintenance` is an operational state, not something anyone should hand-pick
// on a form (it was removed from the asset status picker in the same commit
// series). It follows from the work: an asset with a work order actually being
// worked on IS under maintenance, and stops being so when that work ends.
//
// Only ever moves an asset between `operational` and `maintenance`. `offline`
// and `standby` are deliberate operator decisions and are never overridden —
// a decommissioned asset with an open WO stays offline.
async function syncAssetStatusForWorkOrder(c: import('pg').PoolClient, assetId: string | null, actorId: string): Promise<void> {
  if (!assetId) return

  const { rows: assetRows } = await c.query('select status from public.assets where id = $1 and deleted_at is null', [assetId])
  const current = assetRows[0]?.status
  if (current !== 'operational' && current !== 'maintenance') return

  const { rows: active } = await c.query(
    `select 1 from public.work_orders
     where asset_id = $1 and deleted_at is null and status = 'in_progress' limit 1`,
    [assetId]
  )
  const next = active[0] ? 'maintenance' : 'operational'
  if (next === current) return

  await c.query('update public.assets set status = $2 where id = $1', [assetId, next])
  await c.query(
    `insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
     select org_id, id, $2, 'status_change', $3 from public.assets where id = $1`,
    [assetId, actorId,
     next === 'maintenance'
       ? 'Status set to Under Maintenance — a work order is in progress.'
       : 'Status returned to Operational — no work orders in progress.']
  )
}

workOrdersRouter.post('/work-orders', requireCap('wo:create'), async (req, res) => {
  const parsed = woInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  // Any wo:create holder may create a WO, but only wo:assign holders may hand
  // it to someone at the same time — otherwise wo:create alone would let a
  // caller route work to a colleague without the assignment capability.
  if (parsed.data.assignee_id && !hasCap(req, 'wo:assign')) {
    return res.status(403).json({ error: 'forbidden', capability: 'wo:assign' })
  }
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
    const woId = rows[0].id
    if (parsed.data.assignee_id) {
      await recordAssignment(c, req.claims!.org_id!, woId, req.claims!.sub, parsed.data.assignee_id)
    }
    const { rows: full } = await c.query(`${SELECT} where w.id = $1`, [woId])
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

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select assignee_id from public.work_orders where id = $1', [req.params.id])
    if (!cur[0]) return { error: 'not_found' as const }
    const assigneeChanged = 'assignee_id' in parsed.data && parsed.data.assignee_id !== cur[0].assignee_id
    // Any wo:update holder may PATCH a work order, but reassigning it is
    // gated on wo:assign specifically — otherwise every wo:update holder
    // (e.g. a field tech) could reroute work without that capability.
    if (assigneeChanged && !hasCap(req, 'wo:assign')) {
      return { error: 'forbidden' as const, capability: 'wo:assign' }
    }

    const { rows } = await c.query(
      `update public.work_orders set ${setSql}, updated_at = now() where id = $1 returning id, org_id`,
      [req.params.id, ...values]
    )
    if (!rows[0]) return { error: 'not_found' as const }
    // Update the row before recording the assignment — trg_notify_wo_activity
    // reads the WO's current assignee_id off the just-updated row.
    if (assigneeChanged) {
      await recordAssignment(c, rows[0].org_id, String(req.params.id), req.claims!.sub, parsed.data.assignee_id ?? null)
    }
    const { rows: full } = await c.query(`${SELECT} where w.id = $1`, [req.params.id])
    const wo = full[0]
    await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.update', entityType: 'work_order', entityId: wo.id, after: parsed.data })
    // PATCH can move `status` too (it's in ALLOWED), so the asset's operational
    // state has to follow from here as well as from /transition.
    if ('status' in parsed.data) {
      await syncAssetStatusForWorkOrder(c, wo.asset_id, req.claims!.sub)
    }
    return { data: wo }
  })
  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(403).json({ error: 'forbidden', capability: result.capability })
  }
  res.json(result.data)
})

const transitionInput = z.object({
  status: z.string().min(1),
  comment: z.string().optional(),
  // Only read when closing — the completion report the technician fills in.
  report: z.record(z.unknown()).optional(),
})

/** Draws every unconsumed part on a work order out of stock, writing one
 * ledger row per part. Returns the parts that don't have enough on hand
 * instead of going negative, so the caller can roll the whole close back and
 * say which ones were short. */
async function consumeParts(
  c: import('pg').PoolClient,
  workOrderId: string
): Promise<{ shortfalls: Array<{ part_number: string; name: string; needed: number; in_stock: number }> }> {
  const { rows: lines } = await c.query(
    `select wp.id, wp.part_id, wp.quantity_required, wp.quantity_used, wp.unit_cost_cents
     from public.work_order_parts wp
     where wp.work_order_id = $1 and wp.consumed_at is null and wp.part_id is not null`,
    [workOrderId]
  )

  const shortfalls: Array<{ part_number: string; name: string; needed: number; in_stock: number }> = []

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
  }

  return { shortfalls }
}

workOrdersRouter.post('/work-orders/:id/transition', requireCap('wo:transition'), async (req, res) => {
  const parsed = transitionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { status: newStatus, comment, report } = parsed.data

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select status, actual_start, asset_id from public.work_orders where id = $1',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    const allowed = WO_TRANSITIONS[cur[0].status] || []
    if (!allowed.includes(newStatus)) return { error: 'invalid_transition' as const, from: cur[0].status }

    // Closing draws the reserved parts out of stock. Done before the status
    // write so a shortfall rolls the whole thing back rather than leaving a
    // job closed against stock that was never there.
    if (newStatus === 'closed') {
      const consumed = await consumeParts(c, String(req.params.id))
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

    // Closing the job closes the finding it came from. Without this the defect
    // register slowly fills with items fixed months ago and nobody trusts it —
    // the failure mode a register exists to avoid.
    let resolvedDefects: string[] = []
    if (newStatus === 'closed') {
      const { rows: defects } = await c.query(
        `update public.defects
            set status = 'resolved', resolved_at = now(),
                resolution_notes = coalesce(resolution_notes, $2)
          where work_order_id = $1 and deleted_at is null
            and status not in ('resolved','closed')
          returning ref`,
        [req.params.id, comment || 'Resolved by the work order raised for it.']
      )
      resolvedDefects = defects.map((d: { ref: string }) => d.ref)
    }

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
    const woFull = full[0]

    // Closing a WO is the "done" signal — tell whoever created it and
    // whoever most recently assigned it (they're the ones who were waiting on
    // it, not the assignee who just did the work). Auto-drafted WOs that were
    // never assigned to anyone yield an empty set here — nothing to notify
    // (supervisors were already alerted when it was drafted).
    if (newStatus === 'closed') {
      await notifyWorkOrderClosed(c, {
        orgId: woFull.org_id, woId: woFull.id, ref: woFull.ref, title: woFull.title,
        actorId: req.claims!.sub,
      })
    }

    await syncAssetStatusForWorkOrder(c, woFull.asset_id, req.claims!.sub)

    // Closing clears an overdue job and may clear a defect with it, both of
    // which the condition score reads.
    if (newStatus === 'closed') await refreshAssetHealth(c, woFull.asset_id, req.claims!.sub)

    return { data: { ...woFull, defects_resolved: resolvedDefects } }
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

      // PM tasks, inspections and maintenance completions all announce a
      // report upload; work orders were the one attachment path that silently
      // did nothing. Goes to the assignee and the raiser — whoever isn't the
      // uploader is the one waiting to see it.
      const { rows: woRows } = await c.query(
        'select id, org_id, ref, assignee_id, created_by from public.work_orders where id = $1',
        [req.params.id]
      )
      const wo = woRows[0]
      if (wo) {
        await notifyUsers(c, {
          orgId: wo.org_id,
          userIds: [wo.assignee_id, wo.created_by],
          actorId: req.claims!.sub,
          kind: 'report_uploaded',
          title: `File attached to ${wo.ref}`,
          body: file.originalname,
          entityType: 'work_order',
          entityId: wo.id,
        })
      }
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
