import { Router } from 'express'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'

export const licenceRouter = Router()
licenceRouter.use(requireAuth, requireOrg)

// licence_info is a single, system-wide row (not org-scoped) — readable by
// any active member per the licence_info_read RLS policy. Written only via
// scripts/provision.mjs (owner-role connection), never through this route.
licenceRouter.get('/licence', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select licensed_to, contract_ref, issued_at, expires_at, maintenance_expires_at,
              annual_fee_cents, currency, seats, notes
       from public.licence_info limit 1`
    ).then((r) => r.rows[0] ?? null)
  )
  res.json(row)
})
