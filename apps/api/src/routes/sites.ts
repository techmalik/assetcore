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
  // asset_count is what the shutdown dialog warns about ("N assets will be
  // marked Inactive"), so it is counted here rather than by the client from a
  // separate asset list that may be filtered or site-scoped.
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select s.*,
         (select count(*)::int from public.assets a where a.site_id = s.id and a.deleted_at is null) as asset_count
       from public.sites s
       where s.deleted_at is null
       order by s.name`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

const shutdownInput = z.object({ reason: z.string().trim().min(1).max(1000) })

/**
 * Shut a site down: its assets become Inactive and no new work can be raised
 * there (see siteShutdown.ts for the request side and is_work_suspended() in
 * 0027 for the cron side).
 *
 * Each asset's own status is kept in status_before_shutdown so a reopen puts a
 * standby unit back on standby. Assets already inactive are left alone, so a
 * value saved by an earlier shutdown is never overwritten with 'inactive'.
 */
sitesRouter.post('/sites/:id/shutdown', requireCap('org:manage'), async (req, res) => {
  const parsed = shutdownInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select id, status from public.sites where id = $1 and deleted_at is null for update',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    if (cur[0].status === 'shutdown') return { error: 'already_shutdown' as const }

    const { rows } = await c.query(
      `update public.sites
       set status = 'shutdown', shutdown_at = now(), shutdown_reason = $2, shutdown_by = current_user_id()
       where id = $1 returning *`,
      [req.params.id, parsed.data.reason]
    )
    const site = rows[0]
    const { rowCount } = await c.query(
      `update public.assets
       set status_before_shutdown = status, status = 'inactive'
       where site_id = $1 and deleted_at is null and status <> 'inactive'`,
      [req.params.id]
    )
    const affected = rowCount ?? 0
    await writeAuditLog(c, {
      orgId: site.org_id, actorId: req.claims!.sub, action: 'site.shutdown', entityType: 'site', entityId: site.id,
      before: { status: 'active' },
      after: { status: 'shutdown', reason: parsed.data.reason, assets_inactivated: affected },
    })
    return { data: { ...site, assets_affected: affected } }
  })
  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'already_shutdown' })
  }
  res.json(result.data)
})

sitesRouter.post('/sites/:id/reopen', requireCap('org:manage'), async (req, res) => {
  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select id, status, shutdown_at, shutdown_reason from public.sites where id = $1 and deleted_at is null for update',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    if (cur[0].status !== 'shutdown') return { error: 'not_shutdown' as const }

    // Only inactive assets are restored. One that was edited or moved while
    // the site was down already carries a live status and is not ours to reset.
    const { rowCount } = await c.query(
      `update public.assets
       set status = coalesce(status_before_shutdown, 'operational'), status_before_shutdown = null
       where site_id = $1 and deleted_at is null and status = 'inactive'`,
      [req.params.id]
    )
    const { rows } = await c.query(
      `update public.sites
       set status = 'active', shutdown_at = null, shutdown_reason = null, shutdown_by = null
       where id = $1 returning *`,
      [req.params.id]
    )
    const site = rows[0]
    const affected = rowCount ?? 0
    await writeAuditLog(c, {
      orgId: site.org_id, actorId: req.claims!.sub, action: 'site.reopen', entityType: 'site', entityId: site.id,
      before: { status: 'shutdown', shutdown_at: cur[0].shutdown_at, reason: cur[0].shutdown_reason },
      after: { status: 'active', assets_restored: affected },
    })
    return { data: { ...site, assets_affected: affected } }
  })
  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'not_shutdown' })
  }
  res.json(result.data)
})

sitesRouter.post('/sites', requireCap('org:manage'), async (req, res) => {
  const parsed = siteInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { name, code, region, lat, lng, location_id } = parsed.data

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Every site belongs to a location. When none is chosen but a region/zone
    // is given, upsert a location of that name and link it — so onboarding and
    // quick adds still produce the location→site hierarchy the app relies on.
    let locId = location_id ?? null
    if (!locId && region && region.trim()) {
      const { rows: loc } = await c.query(
        `insert into public.locations (org_id, name) values (current_org_id(), $1)
         on conflict (org_id, name) do update set name = excluded.name
         returning id`,
        [region.trim()]
      )
      locId = loc[0].id
    }
    const { rows } = await c.query(
      `insert into public.sites (org_id, name, code, region, lat, lng, location_id)
       values (current_org_id(), $1, $2, $3, $4, $5, $6) returning *`,
      [name, code ?? null, region ?? null, lat ?? null, lng ?? null, locId]
    )
    const site = rows[0]
    await writeAuditLog(c, { orgId: site.org_id, actorId: req.claims!.sub, action: 'site.create', entityType: 'site', entityId: site.id, after: site })
    return site
  })
  res.status(201).json(row)
})

sitesRouter.patch('/sites/:id', requireCap('org:manage'), async (req, res) => {
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

sitesRouter.delete('/sites/:id', requireCap('org:manage'), async (req, res) => {
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
