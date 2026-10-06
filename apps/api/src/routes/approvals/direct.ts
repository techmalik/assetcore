import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq, effectiveRole } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { auditFromReq } from '../../audit.js'
import {
  loadApproval, notifyApprovalUser, eligibleAssignee, applyDirectOutcome, lockForAssignee, recordApprovalEvent, type DirectRow,
} from '../../approvalRouting.js'
import { send, type Result } from '../../http/result.js'
import { noticeCtx } from './shared.js'
import { parseOr400 } from '../../http/validate.js'

export const directRouter = Router()

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

type DirectErrorCode =
  | 'not_found' | 'not_direct' | 'not_pending' | 'not_returned' | 'already_pending'
  | 'self_approval' | 'not_assignee' | 'not_requester'
  | 'invalid_assignee' | 'cannot_forward_to_self' | 'cannot_forward_to_requester'
type DirectResult = Result<unknown, DirectErrorCode>

const DIRECT_HTTP_STATUS: Record<DirectErrorCode, number> = {
  not_found: 404,
  not_direct: 409, not_pending: 409, not_returned: 409, already_pending: 409,
  self_approval: 403, not_assignee: 403, not_requester: 403,
  invalid_assignee: 422, cannot_forward_to_self: 422, cannot_forward_to_requester: 422,
}

/**
 * Forward: hand the request to someone else, usually further up.
 *
 * It stays pending with one step and a new holder, so a forward never makes
 * a request "more approved". Whoever finally accepts it is the one on record.
 * Not to yourself (nothing would change), and not to the requester: sending a
 * request back to its author is a return, which says it needs changes.
 */
directRouter.post('/approvals/:id/forward', requireCap('approval:decide'), async (req, res) => {
  const body = parseOr400(forwardInput, req.body ?? {}, res)
  if (!body) return
  const toUserId = body.to_user_id
  const notes = body.notes?.trim() || null

  const result = await withOrgContext(claimsFromReq(req), async (c): Promise<DirectResult> => {
    const locked = await lockForAssignee(c, String(req.params.id), req.claims!.sub)
    if ('error' in locked) return locked
    const { ap } = locked
    if (toUserId === req.claims!.sub) return { error: 'cannot_forward_to_self' }
    if (toUserId === ap.requester_id) return { error: 'cannot_forward_to_requester' }
    const target = await eligibleAssignee(c, toUserId, ap.requester_id)
    if (!target) return { error: 'invalid_assignee' }

    await c.query('update public.approvals set assignee_id = $2 where id = $1', [ap.id, toUserId])
    await recordApprovalEvent(c, ap, 'forwarded', effectiveRole(req), notes, toUserId)
    await notifyApprovalUser(c, noticeCtx(req), toUserId, {
      kind: 'approval_pending',
      title: `Forwarded to you for approval: ${ap.title || ap.kind}`,
      body: notes || 'Accept it, forward it, return it or discard it.',
      entityId: ap.id,
    })
    // The requester would otherwise only see the change by opening it.
    await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
      kind: 'approval_forwarded',
      title: `Forwarded: ${ap.title || ap.kind}`,
      body: `Now with ${target.full_name || 'another reviewer'}.`,
      entityId: ap.id,
    })
    await auditFromReq(c, req, {
      action: 'approval.forward',
      entityType: 'approval', entityId: ap.id,
      before: { assignee_id: ap.assignee_id }, after: { assignee_id: toUserId, notes }})
    return { data: await loadApproval(c, ap.id) }
  })
  return send(res, result, DIRECT_HTTP_STATUS)
})

/**
 * Return: hand it back to the requester to fix and resubmit.
 *
 * Not a conclusion. decided_at stays empty and nobody holds it, because it
 * waits on the requester. A reason is required: "returned" without one tells
 * the requester nothing they can act on.
 */
directRouter.post('/approvals/:id/return', requireCap('approval:decide'), async (req, res) => {
  const body = parseOr400(reasonInput, req.body ?? {}, res)
  if (!body) return
  const notes = body.notes?.trim() || null
  if (!notes) return res.status(422).json({ error: 'notes_required' })

  const result = await withOrgContext(claimsFromReq(req), async (c): Promise<DirectResult> => {
    const locked = await lockForAssignee(c, String(req.params.id), req.claims!.sub)
    if ('error' in locked) return locked
    const { ap } = locked

    await c.query("update public.approvals set status = 'returned', assignee_id = null where id = $1", [ap.id])
    await recordApprovalEvent(c, ap, 'returned', effectiveRole(req), notes)
    await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
      kind: 'approval_decided',
      title: `Returned to you: ${ap.title || ap.kind}`,
      body: notes,
      entityId: ap.id,
    })
    await applyDirectOutcome(c, ap, 'returned', req.claims!.sub, notes, req.ip ?? null)
    await auditFromReq(c, req, {
      action: 'approval.return',
      entityType: 'approval', entityId: ap.id,
      before: { status: 'pending', assignee_id: ap.assignee_id }, after: { status: 'returned', notes }})
    return { data: await loadApproval(c, ap.id) }
  })
  return send(res, result, DIRECT_HTTP_STATUS)
})

/**
 * Discard: conclude it without accepting it.
 *
 * Final, and kept. Nothing is deleted, so the request, its history and the
 * record it was about all remain as evidence that it was seen and turned
 * down. A reason is required for the same reason as a return.
 */
directRouter.post('/approvals/:id/discard', requireCap('approval:decide'), async (req, res) => {
  const body = parseOr400(reasonInput, req.body ?? {}, res)
  if (!body) return
  const notes = body.notes?.trim() || null
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
    await recordApprovalEvent(c, ap, 'discarded', effectiveRole(req), notes)
    await notifyApprovalUser(c, noticeCtx(req), ap.requester_id, {
      kind: 'approval_decided',
      title: `Discarded: ${ap.title || ap.kind}`,
      body: notes,
      entityId: ap.id,
    })
    await applyDirectOutcome(c, ap, 'discarded', req.claims!.sub, notes, req.ip ?? null)
    await auditFromReq(c, req, {
      action: 'approval.discard',
      entityType: 'approval', entityId: ap.id,
      before: { status: 'pending', assignee_id: ap.assignee_id }, after: { status: 'discarded', notes }})
    return { data: await loadApproval(c, ap.id) }
  })
  return send(res, result, DIRECT_HTTP_STATUS)
})

/**
 * Resubmit a returned request, to the same reviewer or someone else.
 *
 * The requester only, and only from 'returned'. The same request row goes
 * back to pending, so the return and its reason stay in its history rather
 * than being orphaned on a dead request next to a new one.
 */
directRouter.post('/approvals/:id/resubmit', requireCap('approval:create'), async (req, res) => {
  const body = parseOr400(resubmitInput, req.body ?? {}, res)
  if (!body) return
  const assigneeId = body.assignee_id
  const notes = body.notes?.trim() || null

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
    await recordApprovalEvent(c, ap, 'resubmitted', effectiveRole(req), notes, assigneeId)
    await notifyApprovalUser(c, noticeCtx(req), assigneeId, {
      kind: 'approval_pending',
      title: `Sent to you for approval: ${ap.title || ap.kind}`,
      body: notes || 'Resubmitted after changes. Accept it, forward it, return it or discard it.',
      entityId: ap.id,
    })
    await auditFromReq(c, req, {
      action: 'approval.resubmit',
      entityType: 'approval', entityId: ap.id,
      before: { status: 'returned' }, after: { status: 'pending', assignee_id: assigneeId, notes }})
    return { data: await loadApproval(c, ap.id) }
  })
  return send(res, result, DIRECT_HTTP_STATUS)
})
