import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap, ROLE_KEYS, can } from '../middleware/rbac.js'
import * as rbac from '@assetcore/rbac'
import { writeAuditLog } from '../audit.js'
import { buildSet } from '../sqlUtil.js'
import {
  APPROVAL_SELECT, approvalEvents, loadApproval, notifyApprovalUser, eligibleAssignee,
  insertDirectApproval, applyDirectOutcome,
} from '../approvalRouting.js'

export const approvalsRouter = Router()
approvalsRouter.use(requireAuth, requireOrg, requireActiveMembership)

// What can be sent for approval, and for what. 0001 shipped the table with
// these as comments; they are enumerated here so a typo doesn't quietly create
// a category of request no rule will ever match.
export const APPROVAL_ENTITY_TYPES = [
  'work_order', 'defect', 'compliance_licence', 'pm_task',
  'inspection', 'maintenance_event',
] as const
export const APPROVAL_KINDS = [
  'wo_closure',      // sign-off that a job is genuinely finished
  'wo_cost',         // spend on a job above a threshold
  'defect_deferral', // accepting a defect rather than fixing it
  'licence_renewal',
  'pm_signoff',
  'wo_approval',        // letting a drafted job go ahead (0028)
  'inspection_report',  // a completed inspection sent up for review (0028)
  'maintenance_report', // a completed maintenance record sent up for review (0028)
] as const
// Re-exported from @assetcore/rbac (escalations.ts imports it from here) — a
// local copy of the role list drifted the moment the role set changed.
export { ROLE_KEYS }

const RULE_SELECT = `
  select r.*,
    coalesce((
      select jsonb_agg(jsonb_build_object('level', l.level, 'role_key', l.role_key, 'label', l.label) order by l.level)
      from public.approval_rule_levels l where l.rule_id = r.id
    ), '[]'::jsonb) as levels
  from public.approval_rules r
`

// Shared with workOrders.ts via approvalRouting.ts, which also adds the
// direct-route assignee and the latest history step.
const SELECT = APPROVAL_SELECT

// ── The matrix ───────────────────────────────────────────────────────────────
// Owner-only: who signs off on what is an org governance decision, not
// something an operations manager grants themselves.

const levelInput = z.object({
  role_key: z.enum(ROLE_KEYS),
  label: z.string().max(120).nullable().optional(),
})

const ruleInput = z.object({
  name: z.string().min(1).max(160),
  entity_type: z.enum(APPROVAL_ENTITY_TYPES),
  kind: z.enum(APPROVAL_KINDS),
  min_amount_cents: z.number().int().nonnegative().optional(),
  max_amount_cents: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
  // Order is the routing order: levels[0] signs first.
  levels: z.array(levelInput).min(1).max(5),
})

const RULE_ALLOWED = ['name', 'entity_type', 'kind', 'min_amount_cents', 'max_amount_cents', 'active']

approvalsRouter.get('/approval-rules', requireCap('approval:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `${RULE_SELECT} where r.deleted_at is null
       order by r.entity_type, r.kind, r.min_amount_cents`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

async function replaceLevels(c: import('pg').PoolClient, ruleId: string, levels: z.infer<typeof levelInput>[]) {
  await c.query('delete from public.approval_rule_levels where rule_id = $1', [ruleId])
  for (const [i, level] of levels.entries()) {
    await c.query(
      `insert into public.approval_rule_levels (org_id, rule_id, level, role_key, label)
       values (current_org_id(), $1, $2, $3, $4)`,
      [ruleId, i + 1, level.role_key, level.label ?? null]
    )
  }
}

approvalsRouter.post('/approval-rules', requireCap('approval:manage'), async (req, res) => {
  const parsed = ruleInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { levels, ...fields } = parsed.data
  if (fields.max_amount_cents != null && fields.max_amount_cents <= (fields.min_amount_cents ?? 0)) {
    return res.status(422).json({ error: 'invalid_band' })
  }

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.approval_rules
         (org_id, created_by, name, entity_type, kind, min_amount_cents, max_amount_cents, active)
       values (current_org_id(), current_user_id(), $1, $2, $3, $4, $5, $6)
       returning id, org_id`,
      [fields.name, fields.entity_type, fields.kind, fields.min_amount_cents ?? 0,
       fields.max_amount_cents ?? null, fields.active ?? true]
    )
    await replaceLevels(c, rows[0].id, levels)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'approval.rule.create',
      entityType: 'approval_rule', entityId: rows[0].id, after: parsed.data,
    })
    const { rows: full } = await c.query(`${RULE_SELECT} where r.id = $1`, [rows[0].id])
    return full[0]
  })
  res.status(201).json(row)
})

approvalsRouter.patch('/approval-rules/:id', requireCap('approval:manage'), async (req, res) => {
  const parsed = ruleInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { levels, ...fields } = parsed.data
  const { setSql, values } = buildSet(fields, RULE_ALLOWED)
  if (!setSql && !levels) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // The band has to be checked against what the rule will BE, not against
    // what the patch happens to carry: raising only the floor above the stored
    // ceiling is just as invalid as sending both. Without this the DB's
    // approval_rules_check raises and escapes as a 500, so an editor is told
    // to call an administrator about a range they could fix themselves —
    // while the create path answers a typed 422. Same rule, same answer.
    if (fields.min_amount_cents !== undefined || fields.max_amount_cents !== undefined) {
      const { rows: current } = await c.query(
        'select min_amount_cents, max_amount_cents from public.approval_rules where id = $1 and deleted_at is null',
        [req.params.id]
      )
      if (!current[0]) return null
      const min = fields.min_amount_cents ?? Number(current[0].min_amount_cents ?? 0)
      const max = fields.max_amount_cents !== undefined
        ? fields.max_amount_cents
        : (current[0].max_amount_cents == null ? null : Number(current[0].max_amount_cents))
      if (max != null && max <= min) return { error: 'invalid_band' as const }
    }
    if (setSql) {
      const { rows } = await c.query(
        `update public.approval_rules set ${setSql} where id = $1 and deleted_at is null returning id`,
        [req.params.id, ...values]
      )
      if (!rows[0]) return null
    }
    if (levels) await replaceLevels(c, String(req.params.id), levels)
    const { rows: full } = await c.query(`${RULE_SELECT} where r.id = $1 and r.deleted_at is null`, [req.params.id])
    if (!full[0]) return null
    await writeAuditLog(c, {
      orgId: full[0].org_id, actorId: req.claims!.sub, action: 'approval.rule.update',
      entityType: 'approval_rule', entityId: String(req.params.id), after: parsed.data,
    })
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  if ('error' in row) return res.status(422).json({ error: row.error })
  res.json(row)
})

approvalsRouter.delete('/approval-rules/:id', requireCap('approval:manage'), async (req, res) => {
  // Soft delete: requests already routed by this rule keep pointing at it, so
  // "who was supposed to sign this?" stays answerable after it's retired.
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.approval_rules set deleted_at = now(), active = false where id = $1 and deleted_at is null returning id, org_id',
      [req.params.id]
    )
    if (rows[0]) {
      await writeAuditLog(c, {
        orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'approval.rule.retire',
        entityType: 'approval_rule', entityId: rows[0].id,
      })
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// ── Requests ─────────────────────────────────────────────────────────────────

async function notifyRole(
  c: import('pg').PoolClient,
  roleKey: string,
  n: { kind: string; title: string; body: string; entityId: string }
): Promise<void> {
  await c.query(
    `insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
     select current_org_id(), m.user_id, $1, $2, $3, 'approval', $4
     from public.memberships m
     where m.org_id = current_org_id() and m.status = 'active' and m.role_key = $5`,
    [n.kind, n.title, n.body, n.entityId, roleKey]
  )
}

async function notifyUser(
  c: import('pg').PoolClient,
  userId: string | null,
  n: { kind: string; title: string; body: string; entityId: string }
): Promise<void> {
  if (!userId) return
  await c.query(
    `insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
     values (current_org_id(), $1, $2, $3, $4, 'approval', $5)`,
    [userId, n.kind, n.title, n.body, n.entityId]
  )
}

// Events now carry `to_user` as well as `actor`: a forward is only legible if
// it says who it went to.
async function eventsFor(c: import('pg').PoolClient, approvalId: string) {
  return approvalEvents(c, approvalId)
}

/** Same resolution as requireCap/hasCap (fresh membership over JWT claims),
 * inline for the one route gated on either of two capabilities. */
function callerCan(req: import('express').Request, capability: string): boolean {
  return can(
    req.membership?.roleKey ?? req.claims?.role_key,
    capability,
    req.membership?.extraCaps ?? req.claims?.extra_caps ?? []
  )
}

approvalsRouter.get('/approvals', requireCap('approval:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all'

    if (scope === 'inbox') {
      // What is waiting on this caller specifically. For the matrix: routed to
      // their role, and not something they submitted themselves. For a direct
      // request: sent to them by name. Holding the role it would otherwise go
      // to is not enough.
      values.push(req.membership?.roleKey ?? req.claims!.role_key)
      values.push(req.claims!.sub)
      clauses.push(`and ap.status = 'pending' and (
        (ap.route = 'rule' and ap.current_role_key = $1 and ap.requester_id is distinct from $2)
        or (ap.route = 'direct' and ap.assignee_id = $2))`)
    } else if (scope === 'mine') {
      // Includes returned requests, which are waiting on the requester to fix
      // and resubmit.
      values.push(req.claims!.sub)
      clauses.push(`and ap.requester_id = $${values.length}`)
    }

    const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null
    if (status) { values.push(status); clauses.push(`and ap.status = $${values.length}`) }
    const entityType = typeof req.query.entity_type === 'string' && req.query.entity_type !== 'all' ? req.query.entity_type : null
    if (entityType) { values.push(entityType); clauses.push(`and ap.entity_type = $${values.length}`) }
    const entityId = typeof req.query.entity_id === 'string' ? req.query.entity_id : null
    if (entityId) { values.push(entityId); clauses.push(`and ap.entity_id = $${values.length}`) }

    clauses.push("order by (ap.status = 'pending') desc, ap.created_at desc")
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

approvalsRouter.get('/approvals/stats', requireCap('approval:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select
         count(*) filter (where status = 'pending')::int  as pending,
         count(*) filter (where status = 'pending' and (
                            (route = 'rule' and current_role_key = $1 and requester_id is distinct from $2)
                            or (route = 'direct' and assignee_id = $2)))::int as awaiting_me,
         count(*) filter (where requester_id = $2 and status = 'pending')::int as my_pending,
         count(*) filter (where requester_id = $2 and status = 'returned')::int as returned_to_me,
         count(*) filter (where status = 'approved')::int as approved,
         count(*) filter (where status = 'rejected')::int as rejected
       from public.approvals`,
      [req.membership?.roleKey ?? req.claims!.role_key, req.claims!.sub]
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

/**
 * Who a request can be sent to.
 *
 * Active members, other than the caller, whose role or per-user grants
 * include approval:decide. The capability is resolved through
 * @assetcore/rbac, not SQL, so the list can't disagree with who the action
 * routes will let decide. The caller's own line manager is flagged so pickers
 * can preselect them. Sorted most senior first: "send it up" usually means up.
 */
approvalsRouter.get('/approvals/approvers', (req, res, next) => {
  if (callerCan(req, 'approval:create') || callerCan(req, 'approval:read')) return next()
  return res.status(403).json({ error: 'forbidden', capability: 'approval:create' })
}, async (req, res) => {
  const { members, lineManagerId } = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: me } = await c.query(
      'select manager_id from public.memberships where org_id = current_org_id() and user_id = $1',
      [req.claims!.sub]
    )
    const { rows } = await c.query(
      `select u.id, u.full_name, u.email, m.role_key, m.extra_caps, r.label as role_label
       from public.memberships m
       join public.users u on u.id = m.user_id
       left join public.roles r on r.key = m.role_key
       where m.org_id = current_org_id() and m.status = 'active' and m.user_id <> $1`,
      [req.claims!.sub]
    )
    return { members: rows, lineManagerId: (me[0]?.manager_id as string | null) ?? null }
  })

  // ROLE_RANK is recent in @assetcore/rbac. Without it everyone ranks
  // equal and the list falls back to name order.
  const rank: Record<string, number> = (rbac as { ROLE_RANK?: Record<string, number> }).ROLE_RANK ?? {}
  const out = members
    .filter((m) => can(m.role_key, 'approval:decide', m.extra_caps ?? []))
    .map(({ extra_caps: _caps, ...m }) => ({ ...m, line_manager_id: lineManagerId, is_line_manager: m.id === lineManagerId }))
    .sort((a, b) =>
      (rank[b.role_key] ?? 0) - (rank[a.role_key] ?? 0)
      || String(a.full_name ?? a.email).localeCompare(String(b.full_name ?? b.email)))
  res.json(out)
})

approvalsRouter.get('/approvals/:id', requireCap('approval:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${SELECT} where ap.id = $1`, [req.params.id])
    if (!rows[0]) return null
    return { ...rows[0], events: await eventsFor(c, String(req.params.id)) }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

const submitInput = z.object({
  entity_type: z.enum(APPROVAL_ENTITY_TYPES),
  entity_id: z.string().uuid(),
  kind: z.enum(APPROVAL_KINDS),
  title: z.string().max(200).nullable().optional(),
  amount_cents: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Present: sent to this person (route 'direct'). Absent: routed by the matrix.
  assignee_id: z.string().uuid().optional(),
})

/**
 * Submit for approval.
 *
 * With `assignee_id` the requester has chosen who signs: the request sits with
 * that one person, and no rule is consulted. They must be an active member who
 * can decide approvals, and not the requester.
 *
 * Without it, the amount picks the band and the band's levels pick the route.
 * A request with no matching rule is refused rather than quietly approved or
 * parked with nobody to sign it: an unrouteable request is a gap in the
 * matrix, and saying so is more useful than inventing an approver.
 */
approvalsRouter.post('/approvals', requireCap('approval:create'), async (req, res) => {
  const parsed = submitInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const d = parsed.data
  const amount = d.amount_cents ?? 0

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    // Two live requests for the same thing would let one be approved and the
    // other rejected, with no way to say which won.
    const { rows: dupe } = await c.query(
      `select id from public.approvals
       where entity_type = $1 and entity_id = $2 and kind = $3 and status = 'pending'`,
      [d.entity_type, d.entity_id, d.kind]
    )
    if (dupe[0]) return { error: 'already_pending' as const, approval_id: dupe[0].id }

    if (d.assignee_id) {
      const assignee = await eligibleAssignee(c, d.assignee_id, req.claims!.sub)
      if (!assignee) return { error: 'invalid_assignee' as const }
      const approval = await insertDirectApproval(c, { ...d, assignee_id: d.assignee_id }, {
        userId: req.claims!.sub,
        roleKey: req.membership?.roleKey ?? req.claims!.role_key ?? null,
        assigneeName: assignee.full_name,
      })
      return { data: await loadApproval(c, approval.id) }
    }

    const { rows: rules } = await c.query(
      `${RULE_SELECT}
       where r.deleted_at is null and r.active
         and r.entity_type = $1 and r.kind = $2
         and $3 >= r.min_amount_cents
         and (r.max_amount_cents is null or $3 < r.max_amount_cents)
       order by r.min_amount_cents desc limit 1`,
      [d.entity_type, d.kind, amount]
    )
    const rule = rules[0]
    if (!rule || rule.levels.length === 0) return { error: 'no_matching_rule' as const }

    const first = rule.levels[0]
    const { rows } = await c.query(
      `insert into public.approvals
         (org_id, entity_type, entity_id, kind, status, requester_id, notes,
          rule_id, amount_cents, level, max_levels, current_role_key, title, due_date)
       values (current_org_id(), $1, $2, $3, 'pending', current_user_id(), $4,
               $5, $6, 1, $7, $8, $9, $10)
       returning id, org_id`,
      [d.entity_type, d.entity_id, d.kind, d.notes ?? null, rule.id, d.amount_cents ?? null,
       rule.levels.length, first.role_key, d.title ?? null, d.due_date ?? null]
    )
    const approval = rows[0]

    await c.query(
      `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes)
       values (current_org_id(), $1, 1, 'submitted', current_user_id(), $2, $3)`,
      [approval.id, req.claims!.role_key, d.notes ?? null]
    )
    await notifyRole(c, first.role_key, {
      kind: 'approval_pending',
      title: `Approval needed: ${d.title || d.kind}`,
      body: `Step 1 of ${rule.levels.length} under "${rule.name}".`,
      entityId: approval.id,
    })
    await writeAuditLog(c, {
      orgId: approval.org_id, actorId: req.claims!.sub, action: 'approval.submit',
      entityType: 'approval', entityId: approval.id, after: { ...d, rule: rule.name, levels: rule.levels.length },
    })

    const { rows: full } = await c.query(`${SELECT} where ap.id = $1`, [approval.id])
    return { data: { ...full[0], events: await eventsFor(c, approval.id) } }
  })

  if ('error' in result) {
    if (result.error === 'already_pending') {
      return res.status(409).json({ error: 'already_pending', approval_id: result.approval_id })
    }
    // Named explicitly: this fall-through used to answer every other error as
    // no_matching_rule, which told someone who picked the wrong person to go
    // and fix the approval matrix.
    if (result.error === 'invalid_assignee') return res.status(422).json({ error: 'invalid_assignee' })
    return res.status(422).json({ error: 'no_matching_rule', entity_type: d.entity_type, kind: d.kind, amount_cents: amount })
  }
  res.status(201).json(result.data)
})

const decisionInput = z.object({ notes: z.string().max(2000).nullable().optional() })

/**
 * Approve the current step.
 *
 * Two gates, both required: the capability says the caller may decide
 * approvals at all, and `current_role_key` says whether this particular
 * request is waiting on them. The owner can act at any level — in a small
 * organisation they are often the only person who can — but not on their own
 * request, which is the one rule an approval matrix exists to enforce.
 */
approvalsRouter.post('/approvals/:id/approve', requireCap('approval:decide'), async (req, res) => {
  const parsed = decisionInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const notes = parsed.data.notes ?? null

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select * from public.approvals where id = $1 for update', [req.params.id])
    const ap = cur[0]
    if (!ap) return { error: 'not_found' as const }
    if (ap.status !== 'pending') return { error: 'not_pending' as const, status: ap.status }
    if (ap.requester_id === req.claims!.sub) return { error: 'self_approval' as const }

    // Only the person a direct request is with can decide it. That excludes
    // other holders of the role it might have gone to, and the owner too: the
    // requester chose who signs, and an override would make that choice moot.
    // Accepting is final. There are no levels to climb, and "send it higher"
    // is a forward, not an approval.
    if (ap.route === 'direct') {
      if (ap.assignee_id !== req.claims!.sub) return { error: 'not_assignee' as const }
      await c.query(
        `update public.approvals
            set status = 'approved', approver_id = current_user_id(), decided_at = now()
          where id = $1`,
        [ap.id]
      )
      await c.query(
        `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes)
         values (current_org_id(), $1, $2, 'approved', current_user_id(), $3, $4)`,
        [ap.id, ap.level, req.membership?.roleKey ?? req.claims!.role_key, notes]
      )
      await notifyUser(c, ap.requester_id, {
        kind: 'approval_decided',
        title: `Accepted: ${ap.title || ap.kind}`,
        body: notes || 'Accepted and kept on record.',
        entityId: ap.id,
      })
      await applyDirectOutcome(c, ap, 'approved', req.claims!.sub, notes)
      await writeAuditLog(c, {
        orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.approve',
        entityType: 'approval', entityId: ap.id,
        before: { status: 'pending', assignee_id: ap.assignee_id }, after: { notes, route: 'direct', final: true },
      })
      return { data: await loadApproval(c, ap.id) }
    }

    const isOwner = req.claims!.role_key === 'owner'
    if (!isOwner && ap.current_role_key !== req.claims!.role_key) {
      return { error: 'wrong_approver' as const, expected: ap.current_role_key }
    }

    await c.query(
      `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes)
       values (current_org_id(), $1, $2, 'approved', current_user_id(), $3, $4)`,
      [ap.id, ap.level, req.claims!.role_key, notes]
    )

    const finalStep = ap.level >= ap.max_levels
    if (finalStep) {
      await c.query(
        `update public.approvals
            set status = 'approved', approver_id = current_user_id(), decided_at = now(),
                current_role_key = null
          where id = $1`,
        [ap.id]
      )
      await notifyUser(c, ap.requester_id, {
        kind: 'approval_decided',
        title: `Approved: ${ap.title || ap.kind}`,
        body: `Signed off at step ${ap.level} of ${ap.max_levels}.`,
        entityId: ap.id,
      })
    } else {
      const { rows: next } = await c.query(
        'select role_key from public.approval_rule_levels where rule_id = $1 and level = $2',
        [ap.rule_id, ap.level + 1]
      )
      // The rule was edited underneath a live request and lost the step it was
      // heading for. Treat the route as complete rather than stranding it.
      if (!next[0]) {
        await c.query(
          `update public.approvals
              set status = 'approved', approver_id = current_user_id(), decided_at = now(),
                  max_levels = level, current_role_key = null
            where id = $1`,
          [ap.id]
        )
        await notifyUser(c, ap.requester_id, {
          kind: 'approval_decided',
          title: `Approved: ${ap.title || ap.kind}`,
          body: 'Signed off at the final step available on its rule.',
          entityId: ap.id,
        })
      } else {
        await c.query(
          'update public.approvals set level = level + 1, current_role_key = $2 where id = $1',
          [ap.id, next[0].role_key]
        )
        await notifyRole(c, next[0].role_key, {
          kind: 'approval_pending',
          title: `Approval needed: ${ap.title || ap.kind}`,
          body: `Step ${ap.level + 1} of ${ap.max_levels}.`,
          entityId: ap.id,
        })
      }
    }

    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.approve',
      entityType: 'approval', entityId: ap.id,
      before: { level: ap.level, status: 'pending' }, after: { notes, final: finalStep },
    })

    const { rows: full } = await c.query(`${SELECT} where ap.id = $1`, [ap.id])
    return { data: { ...full[0], events: await eventsFor(c, ap.id) } }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'not_pending') return res.status(409).json({ error: 'not_pending', status: result.status })
    if (result.error === 'self_approval') return res.status(403).json({ error: 'self_approval' })
    if (result.error === 'not_assignee') return res.status(403).json({ error: 'not_assignee' })
    return res.status(403).json({ error: 'wrong_approver', expected: result.expected })
  }
  res.json(result.data)
})

/** Rejection ends the request outright — there is no "reject back to step 1".
 * The requester fixes what was wrong and submits again, which leaves both
 * attempts in the history rather than overwriting the first. */
approvalsRouter.post('/approvals/:id/reject', requireCap('approval:decide'), async (req, res) => {
  const parsed = decisionInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const notes = parsed.data.notes ?? null

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select * from public.approvals where id = $1 for update', [req.params.id])
    const ap = cur[0]
    if (!ap) return { error: 'not_found' as const }
    if (ap.status !== 'pending') return { error: 'not_pending' as const, status: ap.status }
    if (ap.requester_id === req.claims!.sub) return { error: 'self_approval' as const }
    // A request sent to a person ends with return (fix it) or discard (kept
    // on record, not accepted). Rejection is the matrix's word for it, and
    // allowing it here would also let a role holder end someone else's request.
    if (ap.route === 'direct') return { error: 'wrong_route' as const }
    if (req.claims!.role_key !== 'owner' && ap.current_role_key !== req.claims!.role_key) {
      return { error: 'wrong_approver' as const, expected: ap.current_role_key }
    }

    await c.query(
      `update public.approvals
          set status = 'rejected', approver_id = current_user_id(), decided_at = now(), current_role_key = null
        where id = $1`,
      [ap.id]
    )
    await c.query(
      `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes)
       values (current_org_id(), $1, $2, 'rejected', current_user_id(), $3, $4)`,
      [ap.id, ap.level, req.claims!.role_key, notes]
    )
    await notifyUser(c, ap.requester_id, {
      kind: 'approval_decided',
      title: `Rejected: ${ap.title || ap.kind}`,
      body: notes || `Rejected at step ${ap.level} of ${ap.max_levels}.`,
      entityId: ap.id,
    })
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.reject',
      entityType: 'approval', entityId: ap.id, before: { level: ap.level }, after: { notes },
    })

    const { rows: full } = await c.query(`${SELECT} where ap.id = $1`, [ap.id])
    return { data: { ...full[0], events: await eventsFor(c, ap.id) } }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'not_pending') return res.status(409).json({ error: 'not_pending', status: result.status })
    if (result.error === 'self_approval') return res.status(403).json({ error: 'self_approval' })
    if (result.error === 'wrong_route') return res.status(409).json({ error: 'wrong_route' })
    return res.status(403).json({ error: 'wrong_approver', expected: result.expected })
  }
  res.json(result.data)
})

/** Pulling a request back. Only the requester, only while it's still pending —
 * a decision already taken is not theirs to undo. Works on both routes. */
approvalsRouter.post('/approvals/:id/recall', requireCap('approval:create'), async (req, res) => {
  const parsed = decisionInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const notes = parsed.data.notes ?? null

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select * from public.approvals where id = $1 for update', [req.params.id])
    const ap = cur[0]
    if (!ap) return { error: 'not_found' as const }
    if (ap.status !== 'pending') return { error: 'not_pending' as const, status: ap.status }
    if (ap.requester_id !== req.claims!.sub) return { error: 'not_requester' as const }

    await c.query(
      "update public.approvals set status = 'recalled', decided_at = now(), current_role_key = null where id = $1",
      [ap.id]
    )
    await c.query(
      `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes)
       values (current_org_id(), $1, $2, 'recalled', current_user_id(), $3, $4)`,
      [ap.id, ap.level, req.claims!.role_key, notes]
    )
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.recall',
      entityType: 'approval', entityId: ap.id, after: { notes },
    })

    const { rows: full } = await c.query(`${SELECT} where ap.id = $1`, [ap.id])
    return { data: { ...full[0], events: await eventsFor(c, ap.id) } }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'not_pending') return res.status(409).json({ error: 'not_pending', status: result.status })
    return res.status(403).json({ error: 'not_requester' })
  }
  res.json(result.data)
})

// ── Sent to a person: forward, return, discard, resubmit ─────────────────────
// A direct request (route 'direct', 0028) sits with one person, and only that
// person can move it on. Accept is POST /approve above. These are the other
// three answers they can give, plus the requester's resubmit after a return.

const forwardInput = z.object({
  to_user_id: z.string().uuid(),
  notes: z.string().max(2000).nullable().optional(),
})
const reasonInput = z.object({ notes: z.string().max(2000).nullable().optional() })
const resubmitInput = z.object({
  assignee_id: z.string().uuid(),
  notes: z.string().max(2000).nullable().optional(),
})

type DirectRow = {
  id: string; org_id: string; entity_type: string; entity_id: string; kind: string
  title: string | null; level: number; status: string; route: string
  requester_id: string | null; assignee_id: string | null
}

type DirectErrorCode =
  | 'not_found' | 'not_direct' | 'not_pending' | 'not_returned' | 'already_pending'
  | 'self_approval' | 'not_assignee' | 'not_requester'
  | 'invalid_assignee' | 'cannot_forward_to_self' | 'cannot_forward_to_requester'
type DirectResult = { error: DirectErrorCode; status?: string } | { data: unknown }

const DIRECT_HTTP_STATUS: Record<DirectErrorCode, number> = {
  not_found: 404,
  not_direct: 409, not_pending: 409, not_returned: 409, already_pending: 409,
  self_approval: 403, not_assignee: 403, not_requester: 403,
  invalid_assignee: 422, cannot_forward_to_self: 422, cannot_forward_to_requester: 422,
}

function sendDirect(res: import('express').Response, result: DirectResult) {
  if ('error' in result) {
    return res.status(DIRECT_HTTP_STATUS[result.error]).json(
      result.status ? { error: result.error, status: result.status } : { error: result.error }
    )
  }
  return res.json(result.data)
}

const roleOf = (req: import('express').Request) => req.membership?.roleKey ?? req.claims?.role_key ?? null

/** Lock a direct request that is waiting on the caller, or say why it isn't.
 * The requester is refused before the assignee check. Nobody can ever act on
 * their own request, even if it was somehow forwarded back to them. */
async function lockForAssignee(
  c: import('pg').PoolClient, approvalId: string, userId: string
): Promise<{ ap: DirectRow } | { error: DirectErrorCode; status?: string }> {
  const { rows } = await c.query('select * from public.approvals where id = $1 for update', [approvalId])
  const ap = rows[0] as DirectRow | undefined
  if (!ap) return { error: 'not_found' }
  if (ap.route !== 'direct') return { error: 'not_direct' }
  if (ap.status !== 'pending') return { error: 'not_pending', status: ap.status }
  if (ap.requester_id === userId) return { error: 'self_approval' }
  if (ap.assignee_id !== userId) return { error: 'not_assignee' }
  return { ap }
}

async function recordDirectEvent(
  c: import('pg').PoolClient, ap: DirectRow, action: string,
  roleKey: string | null, notes: string | null, toUserId: string | null = null
) {
  await c.query(
    `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes, to_user_id)
     values (current_org_id(), $1, $2, $3, current_user_id(), $4, $5, $6)`,
    [ap.id, ap.level, action, roleKey, notes, toUserId]
  )
}

/**
 * Forward: hand the request to someone else, usually further up.
 *
 * It stays pending with one step and a new holder, so a forward never makes
 * a request "more approved". Whoever finally accepts it is the one on record.
 * Not to yourself (nothing would change), and not to the requester: sending a
 * request back to its author is a return, which says it needs changes.
 */
approvalsRouter.post('/approvals/:id/forward', requireCap('approval:decide'), async (req, res) => {
  const parsed = forwardInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const toUserId = parsed.data.to_user_id
  const notes = parsed.data.notes?.trim() || null

  const result = await withOrgContext(claimsFromReq(req), async (c): Promise<DirectResult> => {
    const locked = await lockForAssignee(c, String(req.params.id), req.claims!.sub)
    if ('error' in locked) return locked
    const { ap } = locked
    if (toUserId === req.claims!.sub) return { error: 'cannot_forward_to_self' }
    if (toUserId === ap.requester_id) return { error: 'cannot_forward_to_requester' }
    const target = await eligibleAssignee(c, toUserId, ap.requester_id)
    if (!target) return { error: 'invalid_assignee' }

    await c.query('update public.approvals set assignee_id = $2 where id = $1', [ap.id, toUserId])
    await recordDirectEvent(c, ap, 'forwarded', roleOf(req), notes, toUserId)
    await notifyApprovalUser(c, toUserId, {
      kind: 'approval_pending',
      title: `Forwarded to you for approval: ${ap.title || ap.kind}`,
      body: notes || 'Accept it, forward it, return it or discard it.',
      entityId: ap.id,
    })
    // The requester would otherwise only see the change by opening it.
    await notifyApprovalUser(c, ap.requester_id, {
      kind: 'approval_forwarded',
      title: `Forwarded: ${ap.title || ap.kind}`,
      body: `Now with ${target.full_name || 'another reviewer'}.`,
      entityId: ap.id,
    })
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.forward',
      entityType: 'approval', entityId: ap.id,
      before: { assignee_id: ap.assignee_id }, after: { assignee_id: toUserId, notes },
    })
    return { data: await loadApproval(c, ap.id) }
  })
  return sendDirect(res, result)
})

/**
 * Return: hand it back to the requester to fix and resubmit.
 *
 * Not a conclusion. decided_at stays empty and nobody holds it, because it
 * waits on the requester. A reason is required: "returned" without one tells
 * the requester nothing they can act on.
 */
approvalsRouter.post('/approvals/:id/return', requireCap('approval:decide'), async (req, res) => {
  const parsed = reasonInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const notes = parsed.data.notes?.trim() || null
  if (!notes) return res.status(422).json({ error: 'notes_required' })

  const result = await withOrgContext(claimsFromReq(req), async (c): Promise<DirectResult> => {
    const locked = await lockForAssignee(c, String(req.params.id), req.claims!.sub)
    if ('error' in locked) return locked
    const { ap } = locked

    await c.query("update public.approvals set status = 'returned', assignee_id = null where id = $1", [ap.id])
    await recordDirectEvent(c, ap, 'returned', roleOf(req), notes)
    await notifyApprovalUser(c, ap.requester_id, {
      kind: 'approval_decided',
      title: `Returned to you: ${ap.title || ap.kind}`,
      body: notes,
      entityId: ap.id,
    })
    await applyDirectOutcome(c, ap, 'returned', req.claims!.sub, notes)
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.return',
      entityType: 'approval', entityId: ap.id,
      before: { status: 'pending', assignee_id: ap.assignee_id }, after: { status: 'returned', notes },
    })
    return { data: await loadApproval(c, ap.id) }
  })
  return sendDirect(res, result)
})

/**
 * Discard: conclude it without accepting it.
 *
 * Final, and kept. Nothing is deleted, so the request, its history and the
 * record it was about all remain as evidence that it was seen and turned
 * down. A reason is required for the same reason as a return.
 */
approvalsRouter.post('/approvals/:id/discard', requireCap('approval:decide'), async (req, res) => {
  const parsed = reasonInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const notes = parsed.data.notes?.trim() || null
  if (!notes) return res.status(422).json({ error: 'notes_required' })

  const result = await withOrgContext(claimsFromReq(req), async (c): Promise<DirectResult> => {
    const locked = await lockForAssignee(c, String(req.params.id), req.claims!.sub)
    if ('error' in locked) return locked
    const { ap } = locked

    await c.query(
      `update public.approvals
          set status = 'discarded', approver_id = current_user_id(), decided_at = now()
        where id = $1`,
      [ap.id]
    )
    await recordDirectEvent(c, ap, 'discarded', roleOf(req), notes)
    await notifyApprovalUser(c, ap.requester_id, {
      kind: 'approval_decided',
      title: `Discarded: ${ap.title || ap.kind}`,
      body: notes,
      entityId: ap.id,
    })
    await applyDirectOutcome(c, ap, 'discarded', req.claims!.sub, notes)
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.discard',
      entityType: 'approval', entityId: ap.id,
      before: { status: 'pending', assignee_id: ap.assignee_id }, after: { status: 'discarded', notes },
    })
    return { data: await loadApproval(c, ap.id) }
  })
  return sendDirect(res, result)
})

/**
 * Resubmit a returned request, to the same reviewer or someone else.
 *
 * The requester only, and only from 'returned'. The same request row goes
 * back to pending, so the return and its reason stay in its history rather
 * than being orphaned on a dead request next to a new one.
 */
approvalsRouter.post('/approvals/:id/resubmit', requireCap('approval:create'), async (req, res) => {
  const parsed = resubmitInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const assigneeId = parsed.data.assignee_id
  const notes = parsed.data.notes?.trim() || null

  const result = await withOrgContext(claimsFromReq(req), async (c): Promise<DirectResult> => {
    const { rows } = await c.query('select * from public.approvals where id = $1 for update', [req.params.id])
    const ap = rows[0] as DirectRow | undefined
    if (!ap) return { error: 'not_found' }
    if (ap.requester_id !== req.claims!.sub) return { error: 'not_requester' }
    if (ap.status !== 'returned') return { error: 'not_returned', status: ap.status }

    // The same guard as a fresh submit. Something else may have been sent
    // for this record while this one sat returned.
    const { rows: dupe } = await c.query(
      `select id from public.approvals
       where entity_type = $1 and entity_id = $2 and kind = $3 and status = 'pending' and id <> $4`,
      [ap.entity_type, ap.entity_id, ap.kind, ap.id]
    )
    if (dupe[0]) return { error: 'already_pending' }

    const target = await eligibleAssignee(c, assigneeId, req.claims!.sub)
    if (!target) return { error: 'invalid_assignee' }

    await c.query(
      `update public.approvals
          set status = 'pending', assignee_id = $2, approver_id = null, decided_at = null
        where id = $1`,
      [ap.id, assigneeId]
    )
    await recordDirectEvent(c, ap, 'resubmitted', roleOf(req), notes, assigneeId)
    await notifyApprovalUser(c, assigneeId, {
      kind: 'approval_pending',
      title: `Sent to you for approval: ${ap.title || ap.kind}`,
      body: notes || 'Resubmitted after changes. Accept it, forward it, return it or discard it.',
      entityId: ap.id,
    })
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId: req.claims!.sub, action: 'approval.resubmit',
      entityType: 'approval', entityId: ap.id,
      before: { status: 'returned' }, after: { status: 'pending', assignee_id: assigneeId, notes },
    })
    return { data: await loadApproval(c, ap.id) }
  })
  return sendDirect(res, result)
})
