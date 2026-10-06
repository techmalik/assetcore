import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireCap, hasCap } from '../middleware/rbac.js'
import { auditFromReq } from '../audit.js'

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

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: before } = await c.query('select label, enabled, config from public.integrations where kind = $1', [req.params.kind])
    const { rows } = await c.query(
      `insert into public.integrations (org_id, kind, label, config, enabled, updated_at)
       values (current_org_id(), $1, $2, $3, $4, now())
       on conflict (org_id, kind) do update set
         label = excluded.label, config = excluded.config, enabled = excluded.enabled, updated_at = now()
       returning *`,
      [req.params.kind, label ?? null, config ?? {}, enabled ?? false]
    )
    // The config holds system URLs, usernames and sender ids, and can hold
    // credentials. The audit log is read by more people than this page, so
    // it records which settings changed, never their values.
    const shape = (r?: { label: string | null; enabled: boolean; config: Record<string, unknown> | null }) =>
      r ? { label: r.label, enabled: r.enabled, config_keys: Object.keys(r.config ?? {}).sort() } : null
    const changedKeys = [...new Set([...Object.keys(before[0]?.config ?? {}), ...Object.keys(config ?? {})])]
      .filter((k) => JSON.stringify(before[0]?.config?.[k]) !== JSON.stringify((config ?? {})[k])).sort()
    await auditFromReq(c, req, {
      action: 'integration.update', entityType: 'integration', entityId: rows[0].id,
      before: shape(before[0]), after: { ...shape(rows[0]), changed_keys: changedKeys, title: `${req.params.kind} integration` },
    })
    return rows[0]
  })
  res.json(row)
})

// No sync endpoint: connector wiring (SAP/Termii/SCADA) is commissioned per
// client engagement, not something this instance can fake a result for.
