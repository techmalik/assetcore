import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'

export const platformAuditRouter = Router()

platformAuditRouter.get('/audit', requirePlatformCap('audit:read'), async (req, res) => {
  const clauses = [
    `select pal.*,
       jsonb_build_object('full_name', u.full_name, 'email', u.email) as profiles,
       jsonb_build_object('name', o.name, 'short_name', o.short_name) as organizations
     from public.platform_audit_log pal
     left join public.users u on u.id = pal.actor_id
     left join public.organizations o on o.id = pal.org_id
     where 1=1`,
  ]
  const values: unknown[] = []
  if (typeof req.query.org_id === 'string') { values.push(req.query.org_id); clauses.push(`and pal.org_id = $${values.length}`) }
  if (typeof req.query.actor_id === 'string') { values.push(req.query.actor_id); clauses.push(`and pal.actor_id = $${values.length}`) }
  clauses.push('order by pal.created_at desc limit 200')

  const { rows } = await ownerPool.query(clauses.join(' '), values)
  res.json({ entries: rows })
})
