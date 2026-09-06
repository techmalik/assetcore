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

const ALLOWED = [
  'name', 'short_name', 'region', 'settings',
  // Phase 4 (0005). Money is stored in the base currency's minor units
  // everywhere; the secondary is presentation only.
  'base_currency', 'secondary_currency', 'fx_rate', 'fx_rate_at',
]

const CURRENCY_COLUMNS = 'base_currency, secondary_currency, fx_rate, fx_rate_at'

orgRouter.get('/org', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select id, name, short_name, region, plan, settings, ${CURRENCY_COLUMNS}
       from public.organizations where id = current_org_id()`
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

const currency = z.string().regex(/^[A-Z]{3}$/, 'expected a 3-letter ISO code')

const orgPatch = z.object({
  name: z.string().min(1).optional(),
  short_name: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  settings: z.record(z.unknown()).optional(),

  base_currency: currency.optional(),
  secondary_currency: currency.nullable().optional(),
  fx_rate: z.number().positive().nullable().optional(),
  fx_rate_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).refine(
  // A rate with no currency converts nothing, and a currency with no rate
  // cannot be shown. Either both or neither.
  (v) => !(v.secondary_currency && v.fx_rate === null),
  { message: 'a secondary currency needs a rate' }
)

// RLS (org_update policy) restricts this to role_key = 'owner' — a non-owner
// caller updates 0 rows, surfaced here as 403 rather than a silent no-op.
orgRouter.patch('/org', async (req, res) => {
  const parsed = orgPatch.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch: Record<string, unknown> = { ...parsed.data }
  // Clearing the secondary currency clears what described it, so a stale rate
  // can never resurface if someone sets a currency again later.
  if (patch.secondary_currency === null) { patch.fx_rate = null; patch.fx_rate_at = null }
  // A rate that changed without a date is dated today — an undated conversion
  // is the thing this column exists to prevent.
  if (patch.fx_rate != null && patch.fx_rate_at === undefined) {
    patch.fx_rate_at = new Date().toISOString().slice(0, 10)
  }

  const { setSql, values } = buildSet(patch, ALLOWED, 0)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `update public.organizations set ${setSql} where id = current_org_id()
       returning id, name, short_name, region, plan, settings, ${CURRENCY_COLUMNS}`,
      values
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(403).json({ error: 'forbidden' })
  res.json(row)
})
