import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet } from '../sqlUtil.js'

export const locationsRouter = Router()
locationsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = ['name', 'code']
const locationInput = z.object({ name: z.string().min(1), code: z.string().nullable().optional() })

locationsRouter.get('/locations', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select l.*, coalesce(count(s.id) filter (where s.deleted_at is null), 0)::int as site_count
       from public.locations l
       left join public.sites s on s.location_id = l.id
       where l.deleted_at is null
       group by l.id
       order by l.name`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

// Locations the CALLER's own site scope actually reaches — unlike GET
// /locations above (an admin-management listing, intentionally org-wide so
// e.g. an unscoped ops_manager can still administer every location), this
// backs the topbar location-filter switcher (EPIC-2), where offering a
// site-scoped user a location none of their sites belong to would be
// pointless and confusing. current_site_ids() is null for unscoped callers
// (see everything), else the same effective site-id array RLS itself uses.
locationsRouter.get('/locations/mine', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select l.id, l.name, l.code
       from public.locations l
       where l.deleted_at is null
         and (
           current_site_ids() is null
           or exists (
             select 1 from public.sites s
             where s.location_id = l.id and s.deleted_at is null and s.id = any(current_site_ids())
           )
         )
       order by l.name`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

locationsRouter.post('/locations', requireCap('org:manage'), async (req, res) => {
  const parsed = locationInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { name, code } = parsed.data
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.locations (org_id, name, code) values (current_org_id(), $1, $2) returning *`,
      [name, code ?? null]
    )
    const loc = rows[0]
    await writeAuditLog(c, { orgId: loc.org_id, actorId: req.claims!.sub, action: 'location.create', entityType: 'location', entityId: loc.id, after: loc })
    return loc
  })
  res.status(201).json(row)
})

locationsRouter.patch('/locations/:id', requireCap('org:manage'), async (req, res) => {
  const parsed = locationInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.locations set ${setSql} where id = $1 returning *`, [req.params.id, ...values])
    const loc = rows[0]
    if (loc) await writeAuditLog(c, { orgId: loc.org_id, actorId: req.claims!.sub, action: 'location.update', entityType: 'location', entityId: loc.id, after: parsed.data })
    return loc
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

locationsRouter.delete('/locations/:id', requireCap('org:manage'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('update public.locations set deleted_at = now() where id = $1 returning id, org_id', [req.params.id])
    const loc = rows[0]
    if (loc) await writeAuditLog(c, { orgId: loc.org_id, actorId: req.claims!.sub, action: 'location.archive', entityType: 'location', entityId: loc.id })
    return loc
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
