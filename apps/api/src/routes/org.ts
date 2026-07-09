import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { buildSet } from '../sqlUtil.js'

export const orgRouter = Router()
orgRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = ['name', 'short_name', 'region', 'settings']

orgRouter.get('/org', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      'select id, name, short_name, region, plan, settings from public.organizations where id = current_org_id()'
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

const orgPatch = z.object({
  name: z.string().min(1).optional(),
  short_name: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
})

// RLS (org_update policy) restricts this to role_key = 'owner' — a non-owner
// caller updates 0 rows, surfaced here as 403 rather than a silent no-op.
orgRouter.patch('/org', async (req, res) => {
  const parsed = orgPatch.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED, 0)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `update public.organizations set ${setSql} where id = current_org_id() returning id, name, short_name, region, plan, settings`,
      values
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(403).json({ error: 'forbidden' })
  res.json(row)
})
