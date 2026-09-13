import type { PoolClient } from 'pg'
import { can } from '@assetcore/rbac'
import { writeAuditLog } from './audit.js'

// Shared by routes/approvals.ts and routes/workOrders.ts. It lives outside
// both routers because a work order sent for approval at creation has to raise
// the request inside the same transaction that inserts the job. Importing
// approvals.ts from workOrders.ts would couple two routers for one helper.

export const APPROVAL_SELECT = `
  select ap.*,
    case when rq.id is null then null else jsonb_build_object('id', rq.id, 'full_name', rq.full_name, 'email', rq.email) end as requester,
    case when apu.id is null then null else jsonb_build_object('id', apu.id, 'full_name', apu.full_name) end as approver,
    case when asg.id is null then null else jsonb_build_object('id', asg.id, 'full_name', asg.full_name) end as assignee,
    case when r.id is null then null else jsonb_build_object('id', r.id, 'name', r.name) end as rule,
    case when cr.key is null then null else cr.label end as current_role_label,
    -- The newest step, so an embedded panel (a job, an inspection) can say
    -- "Ada forwarded it to Tunde" without fetching every request's history.
    (select jsonb_build_object(
        'action', e.action, 'notes', e.notes, 'created_at', e.created_at,
        'actor', eu.full_name, 'to_user', etu.full_name)
       from public.approval_events e
       left join public.users eu on eu.id = e.actor_id
       left join public.users etu on etu.id = e.to_user_id
      where e.approval_id = ap.id
      order by e.created_at desc limit 1) as last_event
  from public.approvals ap
  left join public.users rq on rq.id = ap.requester_id
  left join public.users apu on apu.id = ap.approver_id
  left join public.users asg on asg.id = ap.assignee_id
  left join public.approval_rules r on r.id = ap.rule_id
  left join public.roles cr on cr.key = ap.current_role_key
`

export async function approvalEvents(c: PoolClient, approvalId: string) {
  const { rows } = await c.query(
    `select e.*,
       case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor,
       case when tu.id is null then null else jsonb_build_object('id', tu.id, 'full_name', tu.full_name) end as to_user
     from public.approval_events e
     left join public.users u on u.id = e.actor_id
     left join public.users tu on tu.id = e.to_user_id
     where e.approval_id = $1 order by e.created_at asc`,
    [approvalId]
  )
  return rows
}

export async function loadApproval(c: PoolClient, approvalId: string) {
  const { rows } = await c.query(`${APPROVAL_SELECT} where ap.id = $1`, [approvalId])
  if (!rows[0]) return null
  return { ...rows[0], events: await approvalEvents(c, approvalId) }
}

export async function notifyApprovalUser(
  c: PoolClient,
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

/**
 * Can this person be handed a request?
 *
 * An active member of the caller's org whose role or per-user grants include
 * approval:decide, and not the person asking. The capability check runs here
 * rather than in SQL because @assetcore/rbac is the one place the role map
 * lives. A second copy in a query would drift from it.
 *
 * Returns the user's name for notification copy, or null when they don't
 * qualify. The caller answers 422 invalid_assignee either way, so "no such
 * user" and "user can't decide" are deliberately indistinguishable.
 */
export async function eligibleAssignee(
  c: PoolClient,
  assigneeId: string,
  requesterId: string | null
): Promise<{ id: string; full_name: string | null } | null> {
  if (requesterId && assigneeId === requesterId) return null
  const { rows } = await c.query(
    `select u.id, u.full_name, m.role_key, m.extra_caps
     from public.memberships m
     join public.users u on u.id = m.user_id
     where m.org_id = current_org_id() and m.user_id = $1 and m.status = 'active'`,
    [assigneeId]
  )
  const m = rows[0]
  if (!m || !can(m.role_key, 'approval:decide', m.extra_caps ?? [])) return null
  return { id: m.id, full_name: m.full_name }
}

export type DirectSubmit = {
  entity_type: string
  entity_id: string
  kind: string
  title?: string | null
  notes?: string | null
  amount_cents?: number | null
  due_date?: string | null
  assignee_id: string
}

/**
 * Raise a request that sits with one named person.
 *
 * No rule lookup: the requester chose who signs, so there is one step and no
 * current role. Assumes the caller has already checked eligibility and the
 * duplicate-pending guard. Both need typed error answers, and they differ
 * between the two call sites (a standalone submit vs. a work order raised
 * with an approver).
 */
export async function insertDirectApproval(
  c: PoolClient,
  d: DirectSubmit,
  actor: { userId: string; roleKey: string | null; assigneeName: string | null }
): Promise<{ id: string; org_id: string }> {
  const { rows } = await c.query(
    `insert into public.approvals
       (org_id, entity_type, entity_id, kind, status, requester_id, notes,
        amount_cents, level, max_levels, current_role_key, title, due_date, route, assignee_id)
     values (current_org_id(), $1, $2, $3, 'pending', current_user_id(), $4,
             $5, 1, 1, null, $6, $7, 'direct', $8)
     returning id, org_id`,
    [d.entity_type, d.entity_id, d.kind, d.notes ?? null, d.amount_cents ?? null,
     d.title ?? null, d.due_date ?? null, d.assignee_id]
  )
  const approval = rows[0]

  await c.query(
    `insert into public.approval_events (org_id, approval_id, level, action, actor_id, role_key, notes, to_user_id)
     values (current_org_id(), $1, 1, 'submitted', current_user_id(), $2, $3, $4)`,
    [approval.id, actor.roleKey, d.notes ?? null, d.assignee_id]
  )
  await notifyApprovalUser(c, d.assignee_id, {
    kind: 'approval_pending',
    title: `Sent to you for approval: ${d.title || d.kind}`,
    body: d.notes ? String(d.notes).slice(0, 160) : 'Accept it, forward it, return it or discard it.',
    entityId: approval.id,
  })
  await writeAuditLog(c, {
    orgId: approval.org_id, actorId: actor.userId, action: 'approval.submit',
    entityType: 'approval', entityId: approval.id,
    after: { ...d, route: 'direct', assignee_name: actor.assigneeName },
  })
  return approval
}

/**
 * What concluding a direct request does to the thing it was about.
 *
 * Only `wo_approval` has a consequence today. A work order raised "for
 * approval" is created as a draft, and acceptance is the planner step that
 * moves it into the normal flow. The move is guarded on status = 'draft'
 * because WO_TRANSITIONS only allows draft → new, and someone may have moved
 * or closed the job by hand while the request was waiting. In that case the
 * acceptance is recorded but the job is left where it is.
 *
 * A discard leaves the draft in place, recorded rather than deleted. Whether
 * to close it is the requester's call, and a deleted job can't be audited.
 */
export async function applyDirectOutcome(
  c: PoolClient,
  ap: { id: string; org_id: string; entity_type: string; entity_id: string; kind: string },
  outcome: 'approved' | 'discarded' | 'returned',
  actorId: string,
  notes: string | null
): Promise<void> {
  if (ap.kind !== 'wo_approval' || ap.entity_type !== 'work_order') return

  if (outcome === 'approved') {
    const { rows } = await c.query(
      `update public.work_orders set status = 'new', updated_at = now()
        where id = $1 and status = 'draft' and deleted_at is null
        returning id`,
      [ap.entity_id]
    )
    const moved = Boolean(rows[0])
    await c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
       values (current_org_id(), $1, $2, 'status_change', $3)`,
      [ap.entity_id, actorId, moved
        ? `Approved${notes ? `: ${notes}` : ''}. Status changed to New.`
        : `Approval accepted${notes ? `: ${notes}` : ''}. The job had already left Draft, so its status was not changed.`]
    )
    await writeAuditLog(c, {
      orgId: ap.org_id, actorId, action: 'work_order.approved', entityType: 'work_order', entityId: ap.entity_id,
      before: { status: 'draft' }, after: { status: moved ? 'new' : 'unchanged', approval_id: ap.id },
    })
    return
  }

  await c.query(
    `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
     values (current_org_id(), $1, $2, 'comment', $3)`,
    [ap.entity_id, actorId, outcome === 'discarded'
      ? `Approval discarded${notes ? `: ${notes}` : ''}. The job stays in Draft.`
      : `Returned for changes${notes ? `: ${notes}` : ''}. Edit the job and resubmit it.`]
  )
  await writeAuditLog(c, {
    orgId: ap.org_id, actorId,
    action: outcome === 'discarded' ? 'work_order.approval_discarded' : 'work_order.approval_returned',
    entityType: 'work_order', entityId: ap.entity_id, after: { approval_id: ap.id, notes },
  })
}
