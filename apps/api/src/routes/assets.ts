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
import { uploadTo, guardedSingle, validateUploadOrCleanup, cleanupOrphanedUpload, deleteUploadedFile, IMAGE_MIME_TYPES, DOCUMENT_MIME_TYPES } from '../files.js'

export const assetsRouter = Router()
assetsRouter.use(requireAuth, requireOrg, requireActiveMembership)

// operational/maintenance/standby/offline is the current model (TASK-4.2);
// attention/critical are legacy values kept legal so existing rows stay
// valid and editable (0012_asset_status_expansion.sql keeps both sets in
// the DB check constraint) — new writes aren't steered away from them here,
// the UI picker does that (Assets.jsx's STATUS_PICKER_KEYS).
const ASSET_STATUSES = ['operational', 'maintenance', 'standby', 'offline', 'attention', 'critical'] as const

const photoUpload = uploadTo('assets', { maxSizeBytes: 10 * 1024 * 1024 })
const documentUpload = uploadTo('asset-documents', { maxSizeBytes: 25 * 1024 * 1024 })

const MAX_PHOTOS = 5

// photos/documents are intentionally NOT in this list — they may only change
// via the dedicated upload/remove endpoints below, which validate file
// content and enforce the photo cap server-side. Accepting them here would
// let a client PATCH in arbitrary URLs, bypassing both checks entirely.
//
// health_score is also excluded: it's written through apply_asset_health()
// below instead of the generic column update, so a manual edit runs through
// the same 50%/30% crossing logic (inspection creation, notifications,
// auto-drafted work order) as the daily decay job — a PATCH that drops an
// asset to 20% health should behave identically to it decaying there.
const ALLOWED = [
  'site_id', 'ain', 'name', 'category_id', 'status', 'lat', 'lng',
  'specs', 'purchase_value_cents', 'nbv_cents', 'parent_asset_id',
  'assigned_operator_id', 'last_maintenance_at', 'next_maintenance_at',
]

// An asset's location is derived from its site (site -> location), so the two
// always stay in sync from the single site_id the asset stores.
const SELECT = `
  select a.*,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'location_id', s.location_id) end as site,
    case when loc.id is null then null else jsonb_build_object('id', loc.id, 'name', loc.name) end as location,
    case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end as category,
    case when op.id is null then null else jsonb_build_object('id', op.id, 'full_name', op.full_name) end as operator
  from public.assets a
  left join public.sites s on s.id = a.site_id
  left join public.locations loc on loc.id = s.location_id
  left join public.asset_categories c on c.id = a.category_id
  left join public.users op on op.id = a.assigned_operator_id
`

const assetInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  ain: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().uuid().nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  health_score: z.number().int().min(0).max(100).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  specs: z.record(z.unknown()).optional(),
  purchase_value_cents: z.number().int().nullable().optional(),
  nbv_cents: z.number().int().nullable().optional(),
  parent_asset_id: z.string().uuid().nullable().optional(),
  assigned_operator_id: z.string().uuid().nullable().optional(),
  // Required on create (and never clearable via PATCH): without both dates
  // the asset is invisible to recompute_asset_health()'s daily decay pass —
  // it would sit at its initial health forever and never alert.
  last_maintenance_at: z.string().min(1),
  next_maintenance_at: z.string().min(1),
})

// next must be strictly after last, or the decay denominator is <= 0 and the
// recompute job skips the asset. ISO yyyy-mm-dd strings compare lexically.
function maintenanceDatesOrdered(data: { last_maintenance_at?: string; next_maintenance_at?: string }): boolean {
  if (!data.last_maintenance_at || !data.next_maintenance_at) return true
  return data.next_maintenance_at > data.last_maintenance_at
}

assetsRouter.get('/assets', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null
  const archived = req.query.archived === '1' || req.query.archived === 'true'
  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, archived ? 'where a.deleted_at is not null' : 'where a.deleted_at is null']
    const values: unknown[] = []
    if (status && status !== 'all') { values.push(status); clauses.push(`and a.status = $${values.length}`) }
    // EPIC-2 global location filter: same site_id-in-location-subquery
    // translation used by every other list route the switcher applies to.
    if (locationId) { values.push(locationId); clauses.push(`and a.site_id in (select id from public.sites where location_id = $${values.length})`) }
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
    // asset_activity and audit_log are org-scoped only, not site-scoped — a
    // caller who knows/guesses an out-of-scope asset's id could otherwise
    // read its comments/history straight from this endpoint even though
    // GET /assets/:id itself 404s for them. Confirm the asset (which DOES
    // carry site-scoped RLS) is visible before running either query.
    const { rows: assetRows } = await c.query('select 1 from public.assets where id = $1', [req.params.id])
    if (!assetRows[0]) return null
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
  if (rows === null) return res.status(404).json({ error: 'not_found' })
  res.json(rows)
})

const commentInput = z.object({ body: z.string().min(1) })

// Any active member may log a comment/note on an asset's timeline.
assetsRouter.post('/assets/:id/activity', async (req, res) => {
  const parsed = commentInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // asset_activity's INSERT policy only checks org_id — without this,
    // a site-scoped caller could log a comment against an asset outside
    // their scope. Same fix as the GET above: confirm visibility first.
    const { rows: assetRows } = await c.query('select 1 from public.assets where id = $1', [req.params.id])
    if (!assetRows[0]) return null
    const { rows } = await c.query(
      `insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'comment', $2)
       returning *`,
      [req.params.id, parsed.data.body]
    )
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
})

assetsRouter.post('/assets', requireCap('asset:create'), async (req, res) => {
  const parsed = assetInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  if (!maintenanceDatesOrdered(parsed.data)) return res.status(400).json({ error: 'invalid_maintenance_dates' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.assets (org_id, ${columns})
       values (current_org_id(), ${placeholders})
       returning id`,
      values
    )
    const assetId = rows[0].id
    // health_score starts null (coalesced to 100 by apply_asset_health), so a
    // newly-registered asset created already below threshold gets exactly
    // the same inspection/notification/auto-WO treatment as one that decayed
    // there — registering a compressor at 20% health shouldn't need a full
    // day's cron cycle before anyone's alerted.
    if (parsed.data.health_score != null) {
      await c.query('select public.apply_asset_health($1, $2, $3)', [assetId, parsed.data.health_score, req.claims!.sub])
    }
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [assetId])
    const asset = full[0]
    await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.create', entityType: 'asset', entityId: asset.id, after: asset })
    return asset
  })
  res.status(201).json(row)
})

// Bulk CSV import. Body: { rows: [{ ain, name, category, site, status, ... }] }.
// Create-only (dedupe by AIN), per-row result, one row's failure never aborts
// the rest (savepoint per row). Maintenance dates are required per row, same
// as the create endpoint — an imported asset must decay like any other.
const importRowSchema = z.object({
  ain: z.string().min(1),
  name: z.string().min(1),
  last_maintenance_date: z.string().min(1),
  next_maintenance_date: z.string().min(1),
}).passthrough()

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

assetsRouter.post('/assets/import', requireCap('asset:create'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null
  if (!rows) return res.status(400).json({ error: 'invalid_request' })
  if (rows.length > 1000) return res.status(400).json({ error: 'too_many_rows', max: 1000 })

  const results = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cats } = await c.query('select id, name, code from public.asset_categories where org_id = current_org_id()')
    const { rows: sites } = await c.query('select id, name, code, location_id from public.sites where deleted_at is null')
    const { rows: locs } = await c.query('select id, name, code from public.locations where deleted_at is null')
    const catByKey = new Map<string, string>()
    for (const cat of cats) { if (cat.name) catByKey.set(String(cat.name).toLowerCase(), cat.id); if (cat.code) catByKey.set(String(cat.code).toLowerCase(), cat.id) }
    const locByKey = new Map<string, string>()
    for (const l of locs) { if (l.name) locByKey.set(String(l.name).toLowerCase(), l.id); if (l.code) locByKey.set(String(l.code).toLowerCase(), l.id) }
    // name/code -> a site id; and (locationId::name/code) -> site id, so a
    // `location` column disambiguates sites that share a name across locations.
    const siteByKey = new Map<string, string>()
    const siteByLocKey = new Map<string, string>()
    for (const s of sites) {
      for (const k of [s.name, s.code].filter(Boolean).map((v: string) => String(v).toLowerCase())) {
        if (!siteByKey.has(k)) siteByKey.set(k, s.id)
        if (s.location_id) siteByLocKey.set(`${s.location_id}::${k}`, s.id)
      }
    }

    const out: Array<{ ain: string; status: 'created' | 'skipped' | 'error'; message?: string }> = []
    for (const raw of rows) {
      const parsed = importRowSchema.safeParse(raw)
      if (!parsed.success) { out.push({ ain: String(raw?.ain ?? '(missing)'), status: 'error', message: 'ain, name, last_maintenance_date and next_maintenance_date are required' }); continue }
      const r = parsed.data as Record<string, any>
      if (!ISO_DATE.test(r.last_maintenance_date) || !ISO_DATE.test(r.next_maintenance_date)) {
        out.push({ ain: r.ain, status: 'error', message: 'maintenance dates must be YYYY-MM-DD' })
        continue
      }
      if (r.next_maintenance_date <= r.last_maintenance_date) {
        out.push({ ain: r.ain, status: 'error', message: 'next_maintenance_date must be after last_maintenance_date' })
        continue
      }
      const categoryId = r.category ? catByKey.get(String(r.category).toLowerCase()) ?? null : null
      const locationId = r.location ? locByKey.get(String(r.location).toLowerCase()) ?? null : null
      const siteKey = r.site ? String(r.site).toLowerCase() : null
      const siteId = siteKey
        ? (locationId && siteByLocKey.get(`${locationId}::${siteKey}`)) || siteByKey.get(siteKey) || null
        : null
      const specs: Record<string, unknown> = {}
      if (r.manufacturer) specs.manufacturer = r.manufacturer
      if (r.model) specs.model = r.model
      if (r.serial_number) specs.serial_number = r.serial_number
      if (r.install_date) specs.install_date = r.install_date
      if (r.purchase_date) specs.purchase_date = r.purchase_date
      if (r.runtime_hours != null && r.runtime_hours !== '' && !isNaN(Number(r.runtime_hours))) {
        specs.runtime_hours = Math.max(0, Math.round(Number(r.runtime_hours)))
      }
      if (r.tags) specs.tags = String(r.tags).split(',').map((t: string) => t.trim()).filter(Boolean)
      const rawStatus = r.status != null ? String(r.status).trim() : ''
      if (rawStatus && !ASSET_STATUSES.includes(rawStatus as typeof ASSET_STATUSES[number])) {
        out.push({ ain: r.ain, status: 'error', message: `unrecognized status "${rawStatus}"` })
        continue
      }
      const status = rawStatus || 'operational'
      const num = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null)
      const health = num(r.health_score) != null ? Math.max(0, Math.min(100, Math.round(num(r.health_score)!))) : null
      const value = num(r.value) != null ? Math.round(num(r.value)! * 100) : null

      await c.query('savepoint import_row')
      try {
        const { rows: ins } = await c.query(
          `insert into public.assets (org_id, ain, name, category_id, site_id, status, health_score, purchase_value_cents, specs, lat, lng, last_maintenance_at, next_maintenance_at)
           values (current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
           on conflict (org_id, ain) do nothing
           returning id`,
          [r.ain, r.name, categoryId, siteId, status, health, value, JSON.stringify(specs), num(r.lat), num(r.lng), r.last_maintenance_date, r.next_maintenance_date]
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
  if (!maintenanceDatesOrdered(parsed.data)) return res.status(400).json({ error: 'invalid_maintenance_dates' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  // health_score isn't in ALLOWED (see comment above) — a request setting
  // ONLY health_score would otherwise 400 as an empty patch.
  const hasHealthUpdate = typeof parsed.data.health_score === 'number'
  const clearsHealth = parsed.data.health_score === null
  if (!setSql && !hasHealthUpdate && !clearsHealth) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    if (setSql) {
      const { rows } = await c.query(`update public.assets set ${setSql} where id = $1 returning id`, [req.params.id, ...values])
      if (!rows[0]) return null
    } else {
      const { rows } = await c.query('select id from public.assets where id = $1', [req.params.id])
      if (!rows[0]) return null
    }
    if (hasHealthUpdate) {
      // Routes the write through the same 50%/30% crossing logic the daily
      // decay job uses, attributed to the caller (asset_activity.user_id).
      await c.query('select public.apply_asset_health($1, $2, $3)', [req.params.id, parsed.data.health_score, req.claims!.sub])
    } else if (clearsHealth) {
      await c.query('update public.assets set health_score = null where id = $1', [req.params.id])
    }
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.update', entityType: 'asset', entityId: asset.id, after: parsed.data })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

assetsRouter.post('/assets/:id/photos', requireCap('asset:update'), guardedSingle(photoUpload.single('photo')), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  if (!(await validateUploadOrCleanup(req.file.path, IMAGE_MIME_TYPES))) {
    return res.status(400).json({ error: 'unsupported_type' })
  }
  const url = `assets/${req.file.filename}`

  let result
  try {
    result = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows: cur } = await c.query('select coalesce(jsonb_array_length(photos), 0) as n from public.assets where id = $1', [req.params.id])
      if (!cur[0]) return { error: 'not_found' as const }
      if (cur[0].n >= MAX_PHOTOS) return { error: 'photo_limit' as const }
      await c.query(`update public.assets set photos = photos || $2::jsonb where id = $1`, [req.params.id, JSON.stringify([url])])
      const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
      const asset = full[0]
      await writeAuditLog(c, { orgId: asset.org_id, actorId: req.claims!.sub, action: 'asset.attachment.add', entityType: 'asset', entityId: asset.id, after: { kind: 'photo', url } })
      return { data: asset }
    })
  } catch (err) {
    await cleanupOrphanedUpload(req.file.path)
    throw err
  }
  if ('error' in result) {
    await cleanupOrphanedUpload(req.file.path)
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(400).json({ error: 'photo_limit', max: MAX_PHOTOS })
  }
  res.status(201).json(result.data)
})

assetsRouter.delete('/assets/:id/photos', requireCap('asset:update'), async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : null
  if (!url) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets
       set photos = coalesce((select jsonb_agg(p) from jsonb_array_elements(photos) p where p <> to_jsonb($2::text)), '[]'::jsonb)
       where id = $1 returning id, org_id`,
      [req.params.id, url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'asset.attachment.remove', entityType: 'asset', entityId: rows[0].id, before: { kind: 'photo', url } })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  await deleteUploadedFile(req.claims!.org_id!, url)
  res.json(row)
})

assetsRouter.post('/assets/:id/documents', requireCap('asset:update'), guardedSingle(documentUpload.single('document')), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  if (!(await validateUploadOrCleanup(req.file.path, DOCUMENT_MIME_TYPES))) {
    return res.status(400).json({ error: 'unsupported_type' })
  }
  const doc = { url: `asset-documents/${req.file.filename}`, name: req.file.originalname, size: req.file.size }

  let row
  try {
    row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query(`update public.assets set documents = documents || $2::jsonb where id = $1 returning id, org_id`, [req.params.id, JSON.stringify([doc])])
      if (!rows[0]) return null
      const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
      const asset = full[0]
      await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'asset.attachment.add', entityType: 'asset', entityId: rows[0].id, after: { kind: 'document', ...doc } })
      return asset
    })
  } catch (err) {
    await cleanupOrphanedUpload(req.file.path)
    throw err
  }
  if (!row) {
    await cleanupOrphanedUpload(req.file.path)
    return res.status(404).json({ error: 'not_found' })
  }
  res.status(201).json(row)
})

assetsRouter.delete('/assets/:id/documents', requireCap('asset:update'), async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : null
  if (!url) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets
       set documents = coalesce((select jsonb_agg(d) from jsonb_array_elements(documents) d where d->>'url' <> $2), '[]'::jsonb)
       where id = $1 returning id, org_id`,
      [req.params.id, url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'asset.attachment.remove', entityType: 'asset', entityId: rows[0].id, before: { kind: 'document', url } })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  await deleteUploadedFile(req.claims!.org_id!, url)
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
