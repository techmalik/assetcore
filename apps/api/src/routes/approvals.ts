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

export const approvalsRouter = Router()
approvalsRouter.use(requireAuth, requireOrg, requireActiveMembership)

// What can be sent for approval, and for what. 0001 shipped the table with
// these as comments; they are enumerated here so a typo doesn't quietly create
// a category of request no rule will ever match.
export const APPROVAL_ENTITY_TYPES = ['work_order', 'defect', 'compliance_licence', 'pm_task'] as const
export const APPROVAL_KINDS = [
  'wo_closure',      // sign-off that a job is genuinely finished
  'wo_cost',         // spend on a job above a threshold
  'defect_deferral', // accepting a defect rather than fixing it
  'licence_renewal',
  'pm_signoff',
] as const
export const ROLE_KEYS = ['owner', 'ops_manager', 'maint_engineer', 'field_tech', 'hse_officer', 'viewer'] as const

const RULE_SELECT = `
  select r.*,
    coalesce((
      select jsonb_agg(jsonb_build_object('level', l.level, 'role_key', l.role_key, 'label', l.label) order by l.level)
      from public.approval_rule_levels l where l.rule_id = r.id
    ), '[]'::jsonb) as levels
  from public.approval_rules r
`

const SELECT = `
  select ap.*,
    case when rq.id is null then null else jsonb_build_object('id', rq.id, 'full_name', rq.full_name, 'email', rq.email) end as requester,
    case when apu.id is null then null else jsonb_build_object('id', apu.id, 'full_name', apu.full_name) end as approver,
    case when r.id is null then null else jsonb_build_object('id', r.id, 'name', r.name) end as rule,
    case when cr.key is null then null else cr.label end as current_role_label
  from public.approvals ap
  left join public.users rq on rq.id = ap.requester_id
  left join public.users apu on apu.id = ap.approver_id
  left join public.approval_rules r on r.id = ap.rule_id
  left join public.roles cr on cr.key = ap.current_role_key
`

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

async function eventsFor(c: import('pg').PoolClient, approvalId: string) {
  const { rows } = await c.query(
    `select e.*, case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
     from public.approval_events e
     left join public.users u on u.id = e.actor_id
     where e.approval_id = $1 order by e.created_at asc`,
    [approvalId]
  )
  return rows
}

approvalsRouter.get('/approvals', requireCap('approval:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all'

    if (scope === 'inbox') {
      // What is waiting on this caller specifically: pending, routed to their
      // role, and not something they submitted themselves.
      values.push(req.claims!.role_key)
      clauses.push(`and ap.status = 'pending' and ap.current_role_key = $${values.length}`)
      values.push(req.claims!.sub)
      clauses.push(`and ap.requester_id is distinct from $${values.length}`)
    } else if (scope === 'mine') {
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
         count(*) filter (where status = 'pending' and current_role_key = $1
                            and requester_id is distinct from $2)::int as awaiting_me,
         count(*) filter (where requester_id = $2 and status = 'pending')::int as my_pending,
         count(*) filter (where status = 'approved')::int as approved,
         count(*) filter (where status = 'rejected')::int as rejected
       from public.approvals`,
      [req.claims!.role_key, req.claims!.sub]
    ).then((r) => r.rows[0])
  )
  res.json(row)
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
})

/**
 * Submit for approval.
 *
 * The amount picks the band, the band's levels pick the route. A request with
 * no matching rule is refused rather than quietly approved or parked with
 * nobody to sign it: an unrouteable request is a gap in the matrix, and
 * saying so is more useful than inventing an approver.
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
    return res.status(403).json({ error: 'wrong_approver', expected: result.expected })
  }
  res.json(result.data)
})

/** Pulling a request back. Only the requester, only while it's still pending —
 * a decision already taken is not theirs to undo. */
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
