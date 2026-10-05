import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireCap, hasCap } from '../middleware/rbac.js'

export const integrationsRouter = Router()

// Every member sees which connectors are set up (the Integrations page is open
// to all). Only integration:manage holders (the owner) see the settings
// themselves: they hold system URLs, usernames and sender ids.
integrationsRouter.get('/integrations', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select * from public.integrations order by kind').then((r) => r.rows)
  )
  const canManage = hasCap(req, 'integration:manage')
  res.json(canManage ? rows : rows.map((r) => ({ ...r, config: {} })))
})

const upsertInput = z.object({
  label: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
})

integrationsRouter.put('/integrations/:kind', requireCap('integration:manage'), async (req, res) => {
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
