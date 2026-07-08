import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'

export const supportRouter = Router()

supportRouter.post('/support/impersonate', requirePlatformCap('impersonate'), async (req, res) => {
  const { org_id, reason, minutes: rawMinutes } = req.body ?? {}
  if (!org_id || !reason) return res.status(400).json({ error: 'org_id and reason are required' })
  const minutes = Math.min(Math.max(Number(rawMinutes) || 30, 5), 240)

  const { rows } = await ownerPool.query(
    `insert into public.impersonation_grants (admin_id, org_id, reason, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4))
     returning *`,
    [req.claims!.sub, org_id, reason, minutes]
  )
  const grant = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'support.impersonate', targetType: 'impersonation', targetId: grant.id, orgId: org_id, after: { reason, minutes }, ip: req.ip })
  res.status(201).json({ grant })
})

async function activeGrant(adminId: string, orgId: string) {
  const { rows } = await ownerPool.query(
    `select id, expires_at, revoked_at from public.impersonation_grants
     where admin_id = $1 and org_id = $2 and revoked_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [adminId, orgId]
  )
  return rows[0] ?? null
}

supportRouter.get('/support/org/:id', requirePlatformCap('impersonate'), async (req, res) => {
  if (!(await activeGrant(req.claims!.sub, String(req.params.id)))) {
    return res.status(403).json({ error: 'No active support session for this org' })
  }
  const [{ rows: orgRows }, { rows: assets }, { rows: workOrders }, { rows: licences }] = await Promise.all([
    ownerPool.query('select * from public.organizations where id = $1', [req.params.id]),
    ownerPool.query('select id, ain, name, status, health_score from public.assets where org_id = $1 and deleted_at is null limit 50', [req.params.id]),
    ownerPool.query('select id, ref, title, status, priority, sla_due from public.work_orders where org_id = $1 and deleted_at is null order by created_at desc limit 50', [req.params.id]),
    ownerPool.query('select id, name, licence_number, expiry_date from public.compliance_licences where org_id = $1 limit 50', [req.params.id]),
  ])
  res.json({ org: orgRows[0] ?? null, assets, workOrders, licences })
})

supportRouter.post('/support/revoke/:id', requirePlatformCap('impersonate'), async (req, res) => {
  const { rows } = await ownerPool.query(
    'update public.impersonation_grants set revoked_at = now() where id = $1 and admin_id = $2 returning *',
    [req.params.id, req.claims!.sub]
  )
  const grant = rows[0]
  if (!grant) return res.status(404).json({ error: 'not_found' })
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'support.revoke', targetType: 'impersonation', targetId: grant.id, orgId: grant.org_id, ip: req.ip })
  res.json({ grant })
})
