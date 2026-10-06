import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq, effectiveRole } from '../../claims.js'
import { requireCap, hasCap } from '../../middleware/rbac.js'
import { auditFromReq } from '../../audit.js'
import { isSiteShutdown, SITE_SHUTDOWN_ERROR } from '../../siteShutdown.js'
import { buildSet, buildInsert } from '../../sqlUtil.js'
import { eligibleAssignee, insertDirectApproval, loadApproval } from '../../approvalRouting.js'
import { nextWoRef } from '../../refs.js'
import { WO_SELECT, recordAssignment, transitionWorkOrder } from '../../services/workOrders.js'
import { WO_TYPES, WO_STATUSES, PRIORITIES } from '@assetcore/domain'
import { parseOr400 } from '../../http/validate.js'
import { send } from '../../http/result.js'
import { Where } from '../../http/query.js'

export const coreRouter = Router()

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
  type: z.enum(WO_TYPES).optional(),
  status: z.enum(WO_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  sla_due: z.string().nullable().optional(),
  parts: z.array(z.unknown()).optional(),
  cost_cents: z.number().int().nullable().optional(),
})

coreRouter.get('/work-orders', requireCap('wo:read'), async (req, res) => {
  const { status, priority, asset_id, location_id } = req.query
  // Unpaged on purpose: the board and the list show every open job, and a
  // default page size would quietly drop the rest.
  const where = new Where()
  where.add('w.deleted_at is null')
  if (typeof status === 'string') where.add('w.status = $?', status)
  if (typeof priority === 'string') where.add('w.priority = $?', priority)
  if (typeof asset_id === 'string' && asset_id) where.add('w.asset_id = $?', asset_id)
  if (typeof location_id === 'string' && location_id) where.add('w.site_id in (select id from public.sites where location_id = $?)', location_id)
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${WO_SELECT} ${where.sql} order by w.created_at desc`, where.params).then((r) => r.rows)
  )
  res.json(rows)
})

coreRouter.get('/work-orders/:id', requireCap('wo:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${WO_SELECT} where w.id = $1`, [req.params.id])
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

/**
 * Create a job and send it to a named person for approval, in one transaction.
 *
 * The job is created as a draft: WO_TRANSITIONS already treats draft as
 * "proposed, waiting on someone to let it go ahead", and nothing in the normal
 * flow picks up a draft. Accepting the approval moves it to New
 * (approvalRouting.applyDirectOutcome). One transaction, so a refused approver
 * never leaves an orphan draft that nobody was asked to look at.
 *
 * Carries the same guards as the plain create path above it, which it returns
 * before reaching.
 */
async function createForApproval(
  req: import('express').Request,
  res: import('express').Response,
  data: z.infer<typeof woInput>,
  approverId: string,
  notes: string | null
) {
  if (await withOrgContext(claimsFromReq(req), (c) => isSiteShutdown(c, data.site_id, data.asset_id))) {
    return res.status(422).json(SITE_SHUTDOWN_ERROR)
  }
  if (data.assignee_id && !hasCap(req, 'wo:assign')) {
    return res.status(403).json({ error: 'forbidden', capability: 'wo:assign' })
  }
  const { ref: providedRef, ...rest } = data
  const { columns, placeholders, values } = buildInsert({ ...rest, status: 'draft' }, ALLOWED.filter((c) => c !== 'ref'), 1)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const approver = await eligibleAssignee(c, approverId, req.claims!.sub)
    if (!approver) return { error: 'invalid_assignee' as const }

    const ref = providedRef || (await nextWoRef(c))
    const { rows } = await c.query(
      `insert into public.work_orders (org_id, created_by, ref, ${columns})
       values (current_org_id(), current_user_id(), $1, ${placeholders})
       returning id`,
      [ref, ...values]
    )
    const woId = rows[0].id
    if (data.assignee_id) {
      await recordAssignment(c, req.claims!.org_id!, woId, req.claims!.sub, data.assignee_id)
    }
    const { rows: full } = await c.query(`${WO_SELECT} where w.id = $1`, [woId])
    const wo = full[0]
    await auditFromReq(c, req, { action: 'wo.create', entityType: 'work_order', entityId: wo.id, after: wo })

    const estimate = wo.estimated_cost_cents ?? wo.cost_cents
    const ap = await insertDirectApproval(c, {
      entity_type: 'work_order', entity_id: wo.id, kind: 'wo_approval',
      title: `${wo.ref} — ${wo.title}`, notes,
      amount_cents: estimate == null ? null : Number(estimate),
      assignee_id: approverId,
    }, {
      userId: req.claims!.sub,
      ip: req.ip ?? null,
      roleKey: effectiveRole(req),
      assigneeName: approver.full_name,
    })
    await c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'comment', $2)`,
      [wo.id, `Sent to ${approver.full_name || 'a reviewer'} for approval. Stays in Draft until accepted.`]
    )
    return { data: { ...wo, approval: await loadApproval(c, ap.id) } }
  })

  return send(res, result, { invalid_assignee: 422 }, 201)
}

const INITIAL_STATUSES: readonly string[] = ['new', 'assigned', 'draft']

// Sending a new job to a named person for approval, in the same request that
// creates it. Parsed apart from woInput so a PATCH can never carry it.
const woApprovalInput = z.object({
  approver_id: z.string().uuid().optional(),
  approval_notes: z.string().max(2000).nullable().optional(),
})

coreRouter.post('/work-orders', requireCap('wo:create'), async (req, res) => {
  const input = parseOr400(woInput, req.body, res)
  if (!input) return
  const approval = parseOr400(woApprovalInput, req.body ?? {}, res)
  if (!approval) return
  // A job starts new, assigned (handed to someone as it is raised) or draft
  // (waiting on approval). Any later status is reached through /transition.
  if (input.status && !INITIAL_STATUSES.includes(input.status)) {
    return res.status(400).json({ error: 'invalid_initial_status' })
  }
  const approverId = approval.approver_id
  // It raises an approval request as well as a job, so it needs the
  // capability POST /approvals asks for.
  if (approverId && !hasCap(req, 'approval:create')) {
    return res.status(403).json({ error: 'forbidden', capability: 'approval:create' })
  }
  if (approverId) return createForApproval(req, res, input, approverId, approval.approval_notes ?? null)
  // No work is raised at a shut-down site — by a person here, or by the health
  // crossings in SQL (is_work_suspended, 0027).
  if (await withOrgContext(claimsFromReq(req), (c) => isSiteShutdown(c, input.site_id, input.asset_id))) {
    return res.status(422).json(SITE_SHUTDOWN_ERROR)
  }
  // Any wo:create holder may create a WO, but only wo:assign holders may hand
  // it to someone at the same time — otherwise wo:create alone would let a
  // caller route work to a colleague without the assignment capability.
  if (input.assignee_id && !hasCap(req, 'wo:assign')) {
    return res.status(403).json({ error: 'forbidden', capability: 'wo:assign' })
  }
  const { ref: providedRef, ...rest } = input
  const { columns, placeholders, values } = buildInsert(rest, ALLOWED.filter((c) => c !== 'ref'), 1)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const ref = providedRef || (await nextWoRef(c))
    const { rows } = await c.query(
      `insert into public.work_orders (org_id, created_by, ref, ${columns})
       values (current_org_id(), current_user_id(), $1, ${placeholders})
       returning id`,
      [ref, ...values]
    )
    const woId = rows[0].id
    if (input.assignee_id) {
      await recordAssignment(c, req.claims!.org_id!, woId, req.claims!.sub, input.assignee_id)
    }
    const { rows: full } = await c.query(`${WO_SELECT} where w.id = $1`, [woId])
    const wo = full[0]
    await auditFromReq(c, req, { action: 'wo.create', entityType: 'work_order', entityId: wo.id, after: wo })
    return wo
  })
  res.status(201).json(row)
})

coreRouter.patch('/work-orders/:id', requireCap('wo:update'), async (req, res) => {
  // A status change goes through /transition, which applies the transition
  // rules and everything closing means (parts, defect, actual_end). A PATCH
  // used to set status directly and skip all of it.
  if (req.body && typeof req.body === 'object' && 'status' in req.body) {
    return res.status(400).json({ error: 'use_transition' })
  }
  const input = parseOr400(woInput.partial(), req.body, res)
  if (!input) return
  const { setSql, values } = buildSet(input, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select assignee_id from public.work_orders where id = $1', [req.params.id])
    if (!cur[0]) return { error: 'not_found' as const }
    const assigneeChanged = 'assignee_id' in input && input.assignee_id !== cur[0].assignee_id
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
      await recordAssignment(c, rows[0].org_id, String(req.params.id), req.claims!.sub, input.assignee_id ?? null)
    }
    const { rows: full } = await c.query(`${WO_SELECT} where w.id = $1`, [req.params.id])
    const wo = full[0]
    await auditFromReq(c, req, { action: 'wo.update', entityType: 'work_order', entityId: wo.id, after: input })
    return { data: wo }
  })
  send(res, result, { not_found: 404, forbidden: 403 })
})

const transitionInput = z.object({
  status: z.string().min(1),
  comment: z.string().optional(),
  // Only read when closing — the completion report the technician fills in.
  report: z.record(z.unknown()).optional(),
})

coreRouter.post('/work-orders/:id/transition', requireCap('wo:transition'), async (req, res) => {
  const input = parseOr400(transitionInput, req.body, res)
  if (!input) return
  const { status: newStatus, comment, report } = input

  const result = await withOrgContext(claimsFromReq(req), (c) =>
    transitionWorkOrder(c, String(req.params.id), newStatus, { actorId: req.claims!.sub, ip: req.ip ?? null, comment, report })
  )

  send(res, result, { not_found: 404, insufficient_stock: 409, invalid_transition: 409 })
})

coreRouter.delete('/work-orders/:id', requireCap('wo:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.work_orders set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const wo = rows[0]
    if (wo) await auditFromReq(c, req, { action: 'wo.delete', entityType: 'work_order', entityId: wo.id })
    return wo
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
