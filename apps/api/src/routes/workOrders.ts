import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq, effectiveRole } from '../claims.js'
import { requireCap, hasCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { isSiteShutdown, SITE_SHUTDOWN_ERROR } from '../siteShutdown.js'
import { buildSet, buildInsert } from '../sqlUtil.js'
import { uploadRoute, DOCUMENT_MIME_TYPES } from '../files.js'
import { notifyUsers } from '../notify.js'
import { eligibleAssignee, insertDirectApproval, loadApproval } from '../approvalRouting.js'
import { nextWoRef } from '../refs.js'
import { WO_SELECT, recordAssignment, transitionWorkOrder } from '../services/workOrders.js'
import { WO_TYPES, WO_STATUSES, PRIORITIES } from '@assetcore/domain'

export const workOrdersRouter = Router()


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

workOrdersRouter.get('/work-orders', requireCap('wo:read'), async (req, res) => {
  const { status, priority, asset_id, location_id } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [WO_SELECT, 'where w.deleted_at is null']
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

workOrdersRouter.get('/work-orders/:id', requireCap('wo:read'), async (req, res) => {
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
    await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.create', entityType: 'work_order', entityId: wo.id, after: wo })

    const estimate = wo.estimated_cost_cents ?? wo.cost_cents
    const ap = await insertDirectApproval(c, {
      entity_type: 'work_order', entity_id: wo.id, kind: 'wo_approval',
      title: `${wo.ref} — ${wo.title}`, notes,
      amount_cents: estimate == null ? null : Number(estimate),
      assignee_id: approverId,
    }, {
      userId: req.claims!.sub,
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

  if ('error' in result) return res.status(422).json({ error: result.error })
  return res.status(201).json(result.data)
}

const INITIAL_STATUSES: readonly string[] = ['new', 'assigned', 'draft']

// Sending a new job to a named person for approval, in the same request that
// creates it. Parsed apart from woInput so a PATCH can never carry it.
const woApprovalInput = z.object({
  approver_id: z.string().uuid().optional(),
  approval_notes: z.string().max(2000).nullable().optional(),
})

workOrdersRouter.post('/work-orders', requireCap('wo:create'), async (req, res) => {
  const parsed = woInput.safeParse(req.body)
  const approvalParsed = woApprovalInput.safeParse(req.body ?? {})
  if (!parsed.success || !approvalParsed.success) return res.status(400).json({ error: 'invalid_request' })
  // A job starts new, assigned (handed to someone as it is raised) or draft
  // (waiting on approval). Any later status is reached through /transition.
  if (parsed.data.status && !INITIAL_STATUSES.includes(parsed.data.status)) {
    return res.status(400).json({ error: 'invalid_initial_status' })
  }
  const approverId = approvalParsed.data.approver_id
  // It raises an approval request as well as a job, so it needs the
  // capability POST /approvals asks for.
  if (approverId && !hasCap(req, 'approval:create')) {
    return res.status(403).json({ error: 'forbidden', capability: 'approval:create' })
  }
  if (approverId) return createForApproval(req, res, parsed.data, approverId, approvalParsed.data.approval_notes ?? null)
  // No work is raised at a shut-down site — by a person here, or by the health
  // crossings in SQL (is_work_suspended, 0027).
  if (await withOrgContext(claimsFromReq(req), (c) => isSiteShutdown(c, parsed.data.site_id, parsed.data.asset_id))) {
    return res.status(422).json(SITE_SHUTDOWN_ERROR)
  }
  // Any wo:create holder may create a WO, but only wo:assign holders may hand
  // it to someone at the same time — otherwise wo:create alone would let a
  // caller route work to a colleague without the assignment capability.
  if (parsed.data.assignee_id && !hasCap(req, 'wo:assign')) {
    return res.status(403).json({ error: 'forbidden', capability: 'wo:assign' })
  }
  const { ref: providedRef, ...rest } = parsed.data
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
    if (parsed.data.assignee_id) {
      await recordAssignment(c, req.claims!.org_id!, woId, req.claims!.sub, parsed.data.assignee_id)
    }
    const { rows: full } = await c.query(`${WO_SELECT} where w.id = $1`, [woId])
    const wo = full[0]
    await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.create', entityType: 'work_order', entityId: wo.id, after: wo })
    return wo
  })
  res.status(201).json(row)
})

workOrdersRouter.patch('/work-orders/:id', requireCap('wo:update'), async (req, res) => {
  // A status change goes through /transition, which applies the transition
  // rules and everything closing means (parts, defect, actual_end). A PATCH
  // used to set status directly and skip all of it.
  if (req.body && typeof req.body === 'object' && 'status' in req.body) {
    return res.status(400).json({ error: 'use_transition' })
  }
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
    const { rows: full } = await c.query(`${WO_SELECT} where w.id = $1`, [req.params.id])
    const wo = full[0]
    await writeAuditLog(c, { orgId: wo.org_id, actorId: req.claims!.sub, action: 'wo.update', entityType: 'work_order', entityId: wo.id, after: parsed.data })
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

workOrdersRouter.post('/work-orders/:id/transition', requireCap('wo:transition'), async (req, res) => {
  const parsed = transitionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { status: newStatus, comment, report } = parsed.data

  const result = await withOrgContext(claimsFromReq(req), (c) =>
    transitionWorkOrder(c, String(req.params.id), newStatus, { actorId: req.claims!.sub, comment, report })
  )

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'insufficient_stock') {
      return res.status(409).json({ error: 'insufficient_stock', shortfalls: result.shortfalls })
    }
    return res.status(409).json({ error: 'invalid_transition', from: result.from, to: newStatus })
  }
  res.json(result.data)
})

workOrdersRouter.post('/work-orders/:id/attachments', requireCap('wo:update'), ...uploadRoute({ subdir: 'attachments', field: 'file', mime: DOCUMENT_MIME_TYPES }, async (req, res, file) => {
  const url = file.url

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body, attachments)
       values (current_org_id(), $1, current_user_id(), 'attachment', $2, $3::jsonb)
       returning *`,
      [req.params.id, file.name, JSON.stringify([{ url, name: file.name, size: file.size }])]
    )
    const activity = rows[0]
    await writeAuditLog(c, { orgId: activity.org_id, actorId: req.claims!.sub, action: 'work_order.attachment.add', entityType: 'work_order', entityId: activity.work_order_id, after: { url, name: file.name, size: file.size } })

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
        body: file.name,
        entityType: 'work_order',
        entityId: wo.id,
      })
    }
    return activity
  })
  res.status(201).json(row)
}))

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
