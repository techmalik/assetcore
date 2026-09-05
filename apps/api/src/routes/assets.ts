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
import { previewAssetHealth, recomputeAssetHealth } from '../healthService.js'

export const assetsRouter = Router()
assetsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const photoUpload = uploadTo('assets')

const ALLOWED = [
  'site_id', 'ain', 'name', 'category_id', 'status', 'health_score', 'lat', 'lng',
  'specs', 'purchase_value_cents', 'nbv_cents', 'parent_asset_id', 'photos',
  // Phase 1 — nameplate, lifecycle and depreciation basis (0002).
  'lifecycle_status', 'criticality', 'manufacturer', 'model', 'serial_number', 'supplier',
  'purchase_date', 'commission_date', 'warranty_expiry',
  'useful_life_years', 'salvage_value_cents', 'depreciation_method',
  'custodian_id', 'tags', 'notes',
  // Phase 3 — who owns the condition score, the engine or a person (0004).
  'health_score_source',
]

export const LIFECYCLE_STATUSES = ['planned', 'in_service', 'standby', 'under_maintenance', 'in_storage', 'disposed'] as const
export const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const
export const DEPRECIATION_METHODS = ['straight_line', 'declining_balance', 'sum_of_years_digits', 'units_of_production'] as const

const SELECT = `
  select a.*,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end as category,
    case when cu.id is null then null else jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'email', cu.email) end as custodian,
    case when p.id is null then null else jsonb_build_object('id', p.id, 'ain', p.ain, 'name', p.name) end as parent_asset
  from public.assets a
  left join public.sites s on s.id = a.site_id
  left join public.asset_categories c on c.id = a.category_id
  left join public.users cu on cu.id = a.custodian_id
  left join public.assets p on p.id = a.parent_asset_id
`

// A date input the UI can clear: '' from an empty <input type="date"> becomes null
// rather than failing validation or writing an invalid date.
const dateField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? (v === '' ? null : undefined) : v))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'expected YYYY-MM-DD' })

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

  // Phase 1 additions
  lifecycle_status: z.enum(LIFECYCLE_STATUSES).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  purchase_date: dateField,
  commission_date: dateField,
  warranty_expiry: dateField,
  useful_life_years: z.number().nonnegative().nullable().optional(),
  salvage_value_cents: z.number().int().nonnegative().nullable().optional(),
  depreciation_method: z.enum(DEPRECIATION_METHODS).nullable().optional(),
  custodian_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  notes: z.string().nullable().optional(),

  // Phase 3 addition
  health_score_source: z.enum(['manual', 'computed']).optional(),
})

const qp = (req: { query: Record<string, unknown> }, key: string): string | null => {
  const v = req.query[key]
  return typeof v === 'string' && v !== '' && v !== 'all' ? v : null
}

assetsRouter.get('/assets', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, req.query.archived === 'true' ? 'where a.deleted_at is not null' : 'where a.deleted_at is null']
    const values: unknown[] = []
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('$?', `$${values.length}`)) }

    const status = qp(req, 'status')
    if (status) add('and a.status = $?', status)
    const criticality = qp(req, 'criticality')
    if (criticality) add('and a.criticality = $?', criticality)
    const lifecycle = qp(req, 'lifecycle_status')
    if (lifecycle) add('and a.lifecycle_status = $?', lifecycle)
    const siteId = qp(req, 'site_id')
    if (siteId) add('and a.site_id = $?', siteId)
    const categoryId = qp(req, 'category_id')
    if (categoryId) add('and a.category_id = $?', categoryId)
    const tag = qp(req, 'tag')
    if (tag) add('and $? = any(a.tags)', tag)

    // Free-text across the three fields a person actually searches by.
    const q = qp(req, 'q')
    if (q) {
      values.push(`%${q}%`)
      clauses.push(`and (a.ain ilike $${values.length} or a.name ilike $${values.length} or a.serial_number ilike $${values.length})`)
    }

    clauses.push('order by a.created_at desc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

// Asset tag lookup — what a QR scan resolves against. AIN is unique per org,
// and RLS scopes the query, so no org filter is needed here.
assetsRouter.get('/assets/by-ain/:ain', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where upper(a.ain) = upper($1) and a.deleted_at is null`, [req.params.ain]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
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
  const patch: Record<string, unknown> = { ...parsed.data }

  // Typing a condition score is what makes it a manual override — the engine
  // then leaves the asset alone until someone hands it back (0004).
  if (patch.health_score !== undefined && patch.health_score_source === undefined) {
    patch.health_score_source = 'manual'
  }
  const { setSql, values } = buildSet(patch, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  // A hand-entered score has no breakdown behind it; leaving the old one in
  // place would explain a number that is no longer there.
  const clearBreakdown = patch.health_score_source === 'manual'
    ? ', health_score_components = null, health_score_computed_at = null'
    : ''

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets set ${setSql}${clearBreakdown} where id = $1 returning id, org_id`,
      [req.params.id, ...values]
    )
    if (!rows[0]) return null
    // Handing the score back to the engine takes effect now, not at 03:00.
    if (patch.health_score_source === 'computed') {
      await recomputeAssetHealth(c, String(req.params.id), { claim: true })
    }
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.update', entityType: 'asset', entityId: asset.id, after: patch })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

/**
 * The condition score, taken apart.
 *
 * Always returns what the engine makes of the asset right now, even when the
 * stored score is a manual override — so somebody deciding whether to keep
 * their own number can see the calculated one beside it.
 */
assetsRouter.get('/assets/:id/health', async (req, res) => {
  const health = await withOrgContext(claimsFromReq(req), (c) => previewAssetHealth(c, String(req.params.id)))
  if (!health) return res.status(404).json({ error: 'not_found' })
  res.json(health)
})

/** Recompute and store. `claim` takes the score off manual entry, which is the
 * only way a hand-typed number is ever replaced. */
assetsRouter.post('/assets/:id/health/recompute', requireCap('asset:update'), async (req, res) => {
  const parsed = z.object({ claim: z.boolean().optional() }).safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const health = await withOrgContext(claimsFromReq(req), async (c) => {
    const result = await recomputeAssetHealth(c, String(req.params.id), { claim: parsed.data.claim ?? false })
    if (!result) return null
    await writeAuditLog(c, {
      orgId: req.claims!.org_id!, actorId: req.claims!.sub, action: 'asset.health.recompute',
      entityType: 'asset', entityId: String(req.params.id),
      after: { score: result.score, source: result.source, weight_applied: result.weight_applied },
    })
    return result
  })
  if (!health) return res.status(404).json({ error: 'not_found' })
  res.json(health)
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

// The counterpart to the archive above — 0001 had a soft delete with no way back.
assetsRouter.post('/assets/:id/restore', requireCap('asset:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.assets set deleted_at = null where id = $1 and deleted_at is not null returning id, org_id',
      [req.params.id]
    )
    const asset = rows[0]
    if (asset) await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.restore', entityType: 'asset', entityId: asset.id })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  const full = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where a.id = $1`, [req.params.id]).then((r) => r.rows[0])
  )
  res.json(full)
})
