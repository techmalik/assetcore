import { Router } from 'express'
import { withOrgContext } from '../../db.js'
import { claimsFromReq, effectiveRole } from '../../claims.js'
import { requireCap, requireAnyCap, can } from '../../middleware/rbac.js'
import { ROLE_RANK } from '@assetcore/rbac'
import { SELECT, eventsFor } from './shared.js'

export const readRouter = Router()

readRouter.get('/approvals', requireCap('approval:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'all'

    if (scope === 'inbox') {
      // What is waiting on this caller specifically. For the matrix: routed to
      // their role, and not something they submitted themselves. For a direct
      // request: sent to them by name. Holding the role it would otherwise go
      // to is not enough.
      values.push(effectiveRole(req))
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

readRouter.get('/approvals/stats', requireCap('approval:read'), async (req, res) => {
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
      [effectiveRole(req), req.claims!.sub]
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
readRouter.get('/approvals/approvers', requireAnyCap('approval:create', 'approval:read'), async (req, res) => {
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

  const rank: Record<string, number> = ROLE_RANK
  const out = members
    .filter((m) => can(m.role_key, 'approval:decide', m.extra_caps ?? []))
    .map(({ extra_caps: _caps, ...m }) => ({ ...m, line_manager_id: lineManagerId, is_line_manager: m.id === lineManagerId }))
    .sort((a, b) =>
      (rank[b.role_key] ?? 0) - (rank[a.role_key] ?? 0)
      || String(a.full_name ?? a.email).localeCompare(String(b.full_name ?? b.email)))
  res.json(out)
})

readRouter.get('/approvals/:id', requireCap('approval:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${SELECT} where ap.id = $1`, [req.params.id])
    if (!rows[0]) return null
    return { ...rows[0], events: await eventsFor(c, String(req.params.id)) }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})
