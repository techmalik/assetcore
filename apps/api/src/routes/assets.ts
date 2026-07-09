import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'
import { uploadTo } from '../files.js'

export const assetsRouter = Router()
assetsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const photoUpload = uploadTo('assets')

const ALLOWED = [
  'site_id', 'ain', 'name', 'category_id', 'status', 'health_score', 'lat', 'lng',
  'specs', 'purchase_value_cents', 'nbv_cents', 'parent_asset_id', 'photos',
]

const SELECT = `
  select a.*,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end as category
  from public.assets a
  left join public.sites s on s.id = a.site_id
  left join public.asset_categories c on c.id = a.category_id
`

const assetInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  ain: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().uuid().nullable().optional(),
  status: z.enum(['operational', 'attention', 'critical', 'offline']).optional(),
  health_score: z.number().int().min(0).max(100).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  specs: z.record(z.unknown()).optional(),
  purchase_value_cents: z.number().int().nullable().optional(),
  nbv_cents: z.number().int().nullable().optional(),
  parent_asset_id: z.string().uuid().nullable().optional(),
  photos: z.array(z.unknown()).optional(),
})

assetsRouter.get('/assets', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where a.deleted_at is null']
    const values: unknown[] = []
    if (status && status !== 'all') { clauses.push(`and a.status = $1`); values.push(status) }
    clauses.push('order by a.created_at desc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

assetsRouter.get('/assets/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where a.id = $1`, [req.params.id]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

assetsRouter.post('/assets', requireCap('asset:create'), async (req, res) => {
  const parsed = assetInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.assets (org_id, ${columns})
       values (current_org_id(), ${placeholders})
       returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [rows[0].id])
    const asset = full[0]
    await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.create', entityType: 'asset', entityId: asset.id, after: asset })
    return asset
  })
  res.status(201).json(row)
})

assetsRouter.patch('/assets/:id', requireCap('asset:update'), async (req, res) => {
  const parsed = assetInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets set ${setSql} where id = $1 returning id, org_id`,
      [req.params.id, ...values]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.update', entityType: 'asset', entityId: asset.id, after: parsed.data })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

assetsRouter.post('/assets/:id/photos', requireCap('asset:update'), photoUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  const url = `assets/${req.file.filename}`

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets set photos = photos || $2::jsonb where id = $1 returning id, org_id`,
      [req.params.id, JSON.stringify([url])]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
})

assetsRouter.delete('/assets/:id', requireCap('asset:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.assets set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const asset = rows[0]
    if (asset) await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.delete', entityType: 'asset', entityId: asset.id })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
