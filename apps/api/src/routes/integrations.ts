import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'

export const integrationsRouter = Router()
integrationsRouter.use(requireAuth, requireOrg)

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

// Mechanical port of the old fake `triggerSync` (marks last_synced_at/ok). The
// honest replacement — a disabled sync notice — lands in Phase 6.
integrationsRouter.post('/integrations/:kind/sync', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('select id from public.integrations where kind = $1', [req.params.kind])
    if (!rows[0]) return null
    const { rows: updated } = await c.query(
      `update public.integrations set last_synced_at = now(), last_sync_status = 'ok', last_sync_error = null
       where id = $1 returning *`,
      [rows[0].id]
    )
    return updated[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})
