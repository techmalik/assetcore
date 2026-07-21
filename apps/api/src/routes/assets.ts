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
const documentUpload = uploadTo('asset-documents')

const MAX_PHOTOS = 5

const ALLOWED = [
  'site_id', 'ain', 'name', 'category_id', 'status', 'health_score', 'lat', 'lng',
  'specs', 'purchase_value_cents', 'nbv_cents', 'parent_asset_id', 'photos',
  'assigned_operator_id', 'last_maintenance_at', 'next_maintenance_at', 'documents',
]

const SELECT = `
  select a.*,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end as category,
    case when op.id is null then null else jsonb_build_object('id', op.id, 'full_name', op.full_name) end as operator
  from public.assets a
  left join public.sites s on s.id = a.site_id
  left join public.asset_categories c on c.id = a.category_id
  left join public.users op on op.id = a.assigned_operator_id
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
  assigned_operator_id: z.string().uuid().nullable().optional(),
  last_maintenance_at: z.string().nullable().optional(),
  next_maintenance_at: z.string().nullable().optional(),
  documents: z.array(z.unknown()).optional(),
})

assetsRouter.get('/assets', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null
  const archived = req.query.archived === '1' || req.query.archived === 'true'
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, archived ? 'where a.deleted_at is not null' : 'where a.deleted_at is null']
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

// Merged, newest-first per-asset activity feed: human events from asset_activity
// (comments, alerts) UNION system events from audit_log (create/update/archive).
assetsRouter.get('/assets/:id/activity', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: acts } = await c.query(
      `select aa.id, aa.kind, aa.body, aa.attachments, aa.created_at, 'activity' as source,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
       from public.asset_activity aa
       left join public.users u on u.id = aa.user_id
       where aa.asset_id = $1`,
      [req.params.id]
    )
    const { rows: audits } = await c.query(
      `select al.id, al.action as kind, null as body, '[]'::jsonb as attachments, al.created_at, 'audit' as source,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
       from public.audit_log al
       left join public.users u on u.id = al.actor_id
       where al.entity_type = 'asset' and al.entity_id = $1`,
      [req.params.id]
    )
    return [...acts, ...audits].sort(
      (x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
    )
  })
  res.json(rows)
})

const commentInput = z.object({ body: z.string().min(1) })

// Any active member may log a comment/note on an asset's timeline.
assetsRouter.post('/assets/:id/activity', async (req, res) => {
  const parsed = commentInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'comment', $2)
       returning *`,
      [req.params.id, parsed.data.body]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
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

// Bulk CSV import. Body: { rows: [{ ain, name, category, site, status, ... }] }.
// Create-only (dedupe by AIN), per-row result, one row's failure never aborts
// the rest (savepoint per row).
const importRowSchema = z.object({ ain: z.string().min(1), name: z.string().min(1) }).passthrough()

assetsRouter.post('/assets/import', requireCap('asset:create'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null
  if (!rows) return res.status(400).json({ error: 'invalid_request' })
  if (rows.length > 1000) return res.status(400).json({ error: 'too_many_rows', max: 1000 })

  const results = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cats } = await c.query('select id, name, code from public.asset_categories where org_id = current_org_id()')
    const { rows: sites } = await c.query('select id, name, code from public.sites where deleted_at is null')
    const catByKey = new Map<string, string>()
    for (const cat of cats) { if (cat.name) catByKey.set(String(cat.name).toLowerCase(), cat.id); if (cat.code) catByKey.set(String(cat.code).toLowerCase(), cat.id) }
    const siteByKey = new Map<string, string>()
    for (const s of sites) { if (s.name) siteByKey.set(String(s.name).toLowerCase(), s.id); if (s.code) siteByKey.set(String(s.code).toLowerCase(), s.id) }

    const out: Array<{ ain: string; status: 'created' | 'skipped' | 'error'; message?: string }> = []
    for (const raw of rows) {
      const parsed = importRowSchema.safeParse(raw)
      if (!parsed.success) { out.push({ ain: String(raw?.ain ?? '(missing)'), status: 'error', message: 'ain and name are required' }); continue }
      const r = parsed.data as Record<string, any>
      const categoryId = r.category ? catByKey.get(String(r.category).toLowerCase()) ?? null : null
      const siteId = r.site ? siteByKey.get(String(r.site).toLowerCase()) ?? null : null
      const specs: Record<string, unknown> = {}
      if (r.manufacturer) specs.manufacturer = r.manufacturer
      if (r.model) specs.model = r.model
      if (r.serial_number) specs.serial_number = r.serial_number
      if (r.install_date) specs.install_date = r.install_date
      if (r.tags) specs.tags = String(r.tags).split(',').map((t: string) => t.trim()).filter(Boolean)
      const status = ['operational', 'attention', 'critical', 'offline'].includes(r.status) ? r.status : 'operational'
      const num = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null)
      const health = num(r.health_score) != null ? Math.max(0, Math.min(100, Math.round(num(r.health_score)!))) : null
      const value = num(r.value) != null ? Math.round(num(r.value)! * 100) : null

      await c.query('savepoint import_row')
      try {
        const { rows: ins } = await c.query(
          `insert into public.assets (org_id, ain, name, category_id, site_id, status, health_score, purchase_value_cents, specs, lat, lng)
           values (current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
           on conflict (org_id, ain) do nothing
           returning id`,
          [r.ain, r.name, categoryId, siteId, status, health, value, JSON.stringify(specs), num(r.lat), num(r.lng)]
        )
        if (ins[0]) {
          await writeAuditLog(c, { orgId: req.claims!.org_id!, actorId: req.claims!.sub, action: 'asset.import', entityType: 'asset', entityId: ins[0].id })
          out.push({ ain: r.ain, status: 'created' })
        } else {
          out.push({ ain: r.ain, status: 'skipped', message: 'AIN already exists' })
        }
        await c.query('release savepoint import_row')
      } catch (e: any) {
        await c.query('rollback to savepoint import_row')
        out.push({ ain: r.ain, status: 'error', message: e?.message || 'insert failed' })
      }
    }
    return out
  })
  const summary = {
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
  }
  res.json({ summary, results })
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

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select coalesce(jsonb_array_length(photos), 0) as n from public.assets where id = $1', [req.params.id])
    if (!cur[0]) return { error: 'not_found' as const }
    if (cur[0].n >= MAX_PHOTOS) return { error: 'photo_limit' as const }
    await c.query(`update public.assets set photos = photos || $2::jsonb where id = $1`, [req.params.id, JSON.stringify([url])])
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    return { data: full[0] }
  })
  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(400).json({ error: 'photo_limit', max: MAX_PHOTOS })
  }
  res.status(201).json(result.data)
})

assetsRouter.post('/assets/:id/documents', requireCap('asset:update'), documentUpload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  const doc = { url: `asset-documents/${req.file.filename}`, name: req.file.originalname, size: req.file.size }

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.assets set documents = documents || $2::jsonb where id = $1 returning id`, [req.params.id, JSON.stringify([doc])])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
})

assetsRouter.delete('/assets/:id/documents', requireCap('asset:update'), async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : null
  if (!url) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets
       set documents = coalesce((select jsonb_agg(d) from jsonb_array_elements(documents) d where d->>'url' <> $2), '[]'::jsonb)
       where id = $1 returning id`,
      [req.params.id, url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// Archive (soft delete) — record kept, hidden from the default registry.
assetsRouter.delete('/assets/:id', requireCap('asset:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.assets set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const asset = rows[0]
    if (asset) await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.archive', entityType: 'asset', entityId: asset.id })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// Restore an archived asset.
assetsRouter.post('/assets/:id/restore', requireCap('asset:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.assets set deleted_at = null where id = $1 returning id, org_id',
      [req.params.id]
    )
    if (!rows[0]) return null
    await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'asset.restore', entityType: 'asset', entityId: rows[0].id })
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})
