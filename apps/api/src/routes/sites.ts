import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { writeAuditLog } from '../audit.js'
import { buildSet } from '../sqlUtil.js'

export const sitesRouter = Router()
sitesRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = ['name', 'code', 'region', 'lat', 'lng', 'location_id']

const siteInput = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  location_id: z.string().uuid().nullable().optional(),
})

sitesRouter.get('/sites', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select * from public.sites where deleted_at is null order by name').then((r) => r.rows)
  )
  res.json(rows)
})

sitesRouter.post('/sites', async (req, res) => {
  const parsed = siteInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { name, code, region, lat, lng, location_id } = parsed.data

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.sites (org_id, name, code, region, lat, lng, location_id)
       values (current_org_id(), $1, $2, $3, $4, $5, $6) returning *`,
      [name, code ?? null, region ?? null, lat ?? null, lng ?? null, location_id ?? null]
    )
    const site = rows[0]
    await writeAuditLog(c, { orgId: site.org_id, actorId: req.claims!.sub, action: 'site.create', entityType: 'site', entityId: site.id, after: site })
    return site
  })
  res.status(201).json(row)
})

sitesRouter.patch('/sites/:id', async (req, res) => {
  const parsed = siteInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.sites set ${setSql} where id = $1 returning *`,
      [req.params.id, ...values]
    )
    const site = rows[0]
    if (site) await writeAuditLog(c, { orgId: site.org_id, actorId: req.claims!.sub, action: 'site.update', entityType: 'site', entityId: site.id, after: parsed.data })
    return site
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

sitesRouter.delete('/sites/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.sites set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const site = rows[0]
    if (site) await writeAuditLog(c, { orgId: site.org_id, actorId: req.claims!.sub, action: 'site.delete', entityType: 'site', entityId: site.id })
    return site
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
