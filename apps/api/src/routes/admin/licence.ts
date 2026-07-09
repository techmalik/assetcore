import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'
import { buildSet } from '../../sqlUtil.js'

export const adminLicenceRouter = Router()

const ALLOWED = [
  'licensed_to', 'contract_ref', 'issued_at', 'expires_at', 'maintenance_expires_at',
  'annual_fee_cents', 'currency', 'seats', 'notes',
]

// licence_info is a single-row-per-instance table (see db/migrations/0001_baseline.sql);
// there is no org scoping here since a platform admin session has no org_id.
adminLicenceRouter.get('/licence', requirePlatformCap('billing:read'), async (_req, res) => {
  const { rows } = await ownerPool.query('select * from public.licence_info limit 1')
  res.json({ licence: rows[0] ?? null })
})

adminLicenceRouter.patch('/licence', requirePlatformCap('billing:write'), async (req, res) => {
  const { rows: beforeRows } = await ownerPool.query('select * from public.licence_info limit 1')
  const before = beforeRows[0]
  if (!before) return res.status(404).json({ error: 'licence_not_provisioned' })

  const { setSql, values } = buildSet(req.body ?? {}, ALLOWED, 0)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const { rows } = await ownerPool.query(
    `update public.licence_info set ${setSql} where id = $${values.length + 1} returning *`,
    [...values, before.id]
  )
  const licence = rows[0]
  await writePlatformAuditLog({
    actorId: req.claims!.sub, action: 'licence.update', targetType: 'licence', targetId: licence.id,
    before, after: licence, ip: req.ip,
  })
  res.json({ licence })
})
