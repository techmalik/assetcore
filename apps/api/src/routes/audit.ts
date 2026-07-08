import { Router } from 'express'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireCap } from '../middleware/rbac.js'

export const auditRouter = Router()
auditRouter.use(requireAuth, requireOrg)

auditRouter.get('/audit-log', requireCap('audit:read'), async (req, res) => {
  const limit = Number(req.query.limit) || 50
  const offset = Number(req.query.offset) || 0

  const { rows, total } = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `select al.*,
         case when u.id is null then null else jsonb_build_object('full_name', u.full_name, 'email', u.email) end as actor
       from public.audit_log al
       left join public.users u on u.id = al.actor_id
       order by al.created_at desc
       limit $1 offset $2`,
      [limit, offset]
    )
    const { rows: countRows } = await c.query('select count(*)::int as count from public.audit_log')
    return { rows, total: countRows[0].count }
  })
  res.json({ rows, total })
})
