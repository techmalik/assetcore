import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'

export const auditRouter = Router()
auditRouter.use(requireAuth, requireOrg, requireActiveMembership)

// Filters an auditor actually asks for: who did it, what they did, what it was
// done to, and when. Anything unparseable is dropped rather than 400'd — a
// stale bookmark with a filter value that no longer exists should show the
// unfiltered log, not an error page.
const filters = z.object({
  actor_id: z.string().uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  entity_type: z.string().min(1).max(60).optional(),
  q: z.string().min(1).max(160).optional(),
  from: z.string().min(1).max(40).optional(),
  to: z.string().min(1).max(40).optional(),
})

/** Builds the shared where-clause so the page query and its count can never
 * disagree about what is being filtered. */
function buildWhere(q: z.infer<typeof filters>): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  const add = (sql: string, value: unknown) => {
    params.push(value)
    clauses.push(sql.replace('$?', `$${params.length}`))
  }

  if (q.actor_id) add('al.actor_id = $?', q.actor_id)
  if (q.action) add('al.action = $?', q.action)
  if (q.entity_type) add('al.entity_type = $?', q.entity_type)
  if (q.q) add('al.entity_label ilike $?', `%${q.q}%`)
  // `to` is a date, so it must include the whole of that day — a naive
  // `created_at <= '2026-09-12'` silently excludes everything after midnight.
  if (q.from) add('al.created_at >= $?', q.from)
  if (q.to) add('al.created_at < ($?::date + interval \'1 day\')', q.to)

  return { sql: clauses.length ? `where ${clauses.join(' and ')}` : '', params }
}

auditRouter.get('/audit-log', requireCap('audit:read'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0
  const parsed = filters.safeParse(req.query)
  const f = parsed.success ? parsed.data : {}
  const { sql: where, params } = buildWhere(f)

  const { rows, total } = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `select al.*,
         case when u.id is null then null else jsonb_build_object('full_name', u.full_name, 'email', u.email) end as actor
       from public.audit_log al
       left join public.users u on u.id = al.actor_id
       ${where}
       -- id as a tiebreaker: rows written in one transaction share a
       -- created_at, so without it they can shuffle between pages and an
       -- event can be seen twice or missed entirely while paging.
       order by al.created_at desc, al.id desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    )
    const { rows: countRows } = await c.query(
      `select count(*)::int as count from public.audit_log al ${where}`,
      params
    )
    return { rows, total: countRows[0].count }
  })
  res.json({ rows, total })
})

/** The values the log actually contains, so the filter bar can offer real
 * choices instead of every action string the app could theoretically write. */
auditRouter.get('/audit-log/facets', requireCap('audit:read'), async (req, res) => {
  const facets = await withOrgContext(claimsFromReq(req), async (c) => {
    const [actors, actions, entityTypes] = await Promise.all([
      c.query(
        `select distinct al.actor_id as id, u.full_name, u.email
         from public.audit_log al
         join public.users u on u.id = al.actor_id
         order by u.full_name nulls last`
      ),
      c.query('select distinct action from public.audit_log order by action'),
      c.query('select distinct entity_type from public.audit_log order by entity_type'),
    ])
    return {
      actors: actors.rows,
      actions: actions.rows.map((r) => r.action),
      entity_types: entityTypes.rows.map((r) => r.entity_type),
    }
  })
  res.json(facets)
})
