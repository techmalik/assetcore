import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq, effectiveRole, isOwner } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { writeAuditLog } from '../../audit.js'
import {
  loadApproval, notifyApprovalUser, notifyApprovalRole, eligibleAssignee, insertDirectApproval, applyDirectOutcome,
} from '../../approvalRouting.js'
import { APPROVAL_ENTITY_TYPES, APPROVAL_KINDS } from '@assetcore/domain'
import { RULE_SELECT, SELECT, noticeCtx, eventsFor } from './shared.js'

export const matrixRouter = Router()

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
matrixRouter.post('/approvals', requireCap('approval:create'), async (req, res) => {
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
        roleKey: effectiveRole(req),
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
      [approval.id, effectiveRole(req), d.notes ?? null]
    )
    await notifyApprovalRole(c, noticeCtx(req), first.role_key, {
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
matrixRouter.post('/approvals/:id/approve', requireCap('approval:decide'), async (req, res) => {
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
        [ap.id, ap.level, effectiveRole(req), notes]
      )
      await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
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

    const callerIsOwner = isOwner(req)
    if (!callerIsOwner && ap.current_role_key !== effectiveRole(req)) {
      return { error: 'wrong_approver' as const, expected: ap.current_role_key }
    }

    await c.query(
      `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes)
       values (current_org_id(), $1, $2, 'approved', current_user_id(), $3, $4)`,
      [ap.id, ap.level, effectiveRole(req), notes]
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
      await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
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
        await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
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
        await notifyApprovalRole(c, noticeCtx(req), next[0].role_key, {
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
matrixRouter.post('/approvals/:id/reject', requireCap('approval:decide'), async (req, res) => {
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
    if (!isOwner(req) && ap.current_role_key !== effectiveRole(req)) {
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
      [ap.id, ap.level, effectiveRole(req), notes]
    )
    await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
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
matrixRouter.post('/approvals/:id/recall', requireCap('approval:create'), async (req, res) => {
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
      [ap.id, ap.level, effectiveRole(req), notes]
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
