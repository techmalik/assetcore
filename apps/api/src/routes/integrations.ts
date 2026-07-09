import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'

export const integrationsRouter = Router()
integrationsRouter.use(requireAuth, requireOrg, requireActiveMembership)

integrationsRouter.get('/integrations', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select * from public.integrations order by kind').then((r) => r.rows)
  )
  res.json(rows)
})

integrationsRouter.get('/integrations/:kind', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select * from public.integrations where kind = $1', [req.params.kind]).then((r) => r.rows[0] ?? null)
  )
  res.json(row)
})

const upsertInput = z.object({
  label: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

integrationsRouter.put('/integrations/:kind', async (req, res) => {
  const parsed = upsertInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { label, config, enabled } = parsed.data

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.integrations (org_id, kind, label, config, enabled, updated_at)
       values (current_org_id(), $1, $2, $3, $4, now())
       on conflict (org_id, kind) do update set
         label = excluded.label, config = excluded.config, enabled = excluded.enabled, updated_at = now()
       returning *`,
      [req.params.kind, label ?? null, config ?? {}, enabled ?? false]
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

// No sync endpoint: connector wiring (SAP/Termii/SCADA) is commissioned per
// client engagement, not something this instance can fake a result for.
