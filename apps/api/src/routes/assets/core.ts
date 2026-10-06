import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { auditFromReq } from '../../audit.js'
import { refreshAssetHealth, previewAssetHealth } from '../../healthService.js'
import { buildSet, buildInsert } from '../../sqlUtil.js'
import { isSiteShutdown, SITE_SHUTDOWN_ERROR } from '../../siteShutdown.js'
import { ASSET_STATUSES, ASSET_DEPRECIATION_METHODS, LIFECYCLE_STATUSES, CRITICALITIES } from '@assetcore/domain'
import { ASSET_SELECT, recomputeDerived, maintenanceDatesOrdered } from '../../services/assets.js'
import { importAssets, importSummary } from '../../services/assetImport.js'
import { transferAssets } from '../../services/assetTransfer.js'
import { parseOr400 } from '../../http/validate.js'

export const coreRouter = Router()

// operational/maintenance/standby/offline is the current model (TASK-4.2);
// attention/critical are legacy values kept legal so existing rows stay
// valid and editable (0012_asset_status_expansion.sql keeps both sets in
// the DB check constraint) — new writes aren't steered away from them here,
// the UI picker does that (Assets.jsx's STATUS_PICKER_KEYS).
//
// 'inactive' (0027) is what an asset at a shut-down site is. It is set by the
// shutdown and cleared by a reopen or a transfer out; the UI never offers it.

// photos/documents are intentionally NOT in this list — they may only change
// via the dedicated upload/remove endpoints below, which validate file
// content and enforce the photo cap server-side. Accepting them here would
// let a client PATCH in arbitrary URLs, bypassing both checks entirely.
//
// health_score, nbv_cents and accumulated_depreciation_cents are excluded
// because they are DERIVED, not entered. Health is the interval-proportional
// decay between last_maintenance_at and next_maintenance_at, written only by
// apply_asset_health(); book value is written only by
// recompute_asset_depreciation_for(). Both are recomputed here on write (see
// recomputeDerived below) so a create or a date/valuation edit produces a
// correct figure in the same request rather than at the next cron run.
const ALLOWED = [
  'site_id', 'ain', 'name', 'category_id', 'status', 'lat', 'lng',
  'specs', 'purchase_value_cents', 'parent_asset_id',
  'assigned_operator_id', 'last_maintenance_at', 'next_maintenance_at',
  'purchase_date', 'install_date',
  'depreciation_method', 'useful_life_years', 'salvage_value_cents', 'declining_rate_pct',
  // Nameplate and lifecycle (0021). lifecycle_status is where the asset is in
  // its life; `status` above is its condition. Separate axes — an asset can be
  // in_service and critical at once, which one column cannot express.
  'lifecycle_status', 'criticality', 'manufacturer', 'model', 'serial_number',
  'supplier', 'warranty_expiry', 'tags', 'notes',
]

// 0022 widened the column's check to admit sum-of-years' digits, which the
// posted subledger supports.

// Columns whose change invalidates the stored book value.
const DEPRECIATION_INPUTS = [
  'purchase_value_cents', 'purchase_date', 'install_date',
  'depreciation_method', 'useful_life_years', 'salvage_value_cents', 'declining_rate_pct',
]

const assetInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  ain: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().uuid().nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  specs: z.record(z.unknown()).optional(),
  purchase_value_cents: z.number().int().nullable().optional(),
  parent_asset_id: z.string().uuid().nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  install_date: z.string().nullable().optional(),
  // Per-asset depreciation overrides. null means "inherit the organisation
  // default" (organizations.settings->'depreciation'), matching how the SQL
  // resolves them.
  depreciation_method: z.enum(ASSET_DEPRECIATION_METHODS).nullable().optional(),
  useful_life_years: z.number().positive().nullable().optional(),
  salvage_value_cents: z.number().int().min(0).nullable().optional(),
  declining_rate_pct: z.number().gt(0).lt(100).nullable().optional(),
  assigned_operator_id: z.string().uuid().nullable().optional(),

  // Nameplate and lifecycle (0021).
  lifecycle_status: z.enum(LIFECYCLE_STATUSES).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  warranty_expiry: z.string().nullable().optional(),
  tags: z.array(z.string().min(1)).optional(),
  notes: z.string().nullable().optional(),

  // Required on create (and never clearable via PATCH). They came in for the
  // linear-decay health pass, since retired; maintenance completion still
  // moves this window forward, and the register shows it.
  last_maintenance_at: z.string().min(1),
  next_maintenance_at: z.string().min(1),
// strict() so a body still carrying a derived field — health_score, nbv_cents,
// accumulated_depreciation_cents — is rejected outright rather than silently
// stripped. An old client that thinks it can set health should be told it
// can't, not left believing the write landed.
}).strict()

coreRouter.get('/assets', requireCap('asset:read'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null
  const archived = req.query.archived === '1' || req.query.archived === 'true'
  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [ASSET_SELECT, archived ? 'where a.deleted_at is not null' : 'where a.deleted_at is null']
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

// Asset tag lookup — what a QR scan resolves against. AIN is unique per org
// and RLS scopes the query, so no org filter is needed here. Declared before
// /assets/:id so the literal segment is not swallowed by the parameter.
coreRouter.get('/assets/by-ain/:ain', requireCap('asset:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${ASSET_SELECT} where upper(a.ain) = upper($1) and a.deleted_at is null`, [req.params.ain])
      .then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

/**
 * The condition score, taken apart.
 *
 * Read-only: the score is derived and there is no manual override to offer.
 * This exists so the asset panel can show the working — five weighted signals,
 * each with its own sub-score and a sentence saying what it was read from —
 * rather than restating a number nobody can interrogate.
 */
coreRouter.get('/assets/:id/health', requireCap('asset:read'), async (req, res) => {
  const health = await withOrgContext(claimsFromReq(req), (c) => previewAssetHealth(c, String(req.params.id)))
  if (!health) return res.status(404).json({ error: 'not_found' })
  res.json(health)
})

coreRouter.get('/assets/:id', requireCap('asset:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// Merged, newest-first per-asset activity feed: human events from asset_activity
// (comments, alerts) UNION system events from audit_log (create/update/archive).
coreRouter.get('/assets/:id/activity', requireCap('asset:read'), async (req, res) => {
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
         null as entity_label,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
       from public.asset_activity aa
       left join public.users u on u.id = aa.user_id
       where aa.asset_id = $1`,
      [req.params.id]
    )
    const { rows: audits } = await c.query(
      `select al.id, al.action as kind, null as body, '[]'::jsonb as attachments, al.created_at, 'audit' as source,
         al.entity_label,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
       from public.audit_log al
       left join public.users u on u.id = al.actor_id
       where al.entity_type = 'asset' and al.entity_id = $1`,
      [req.params.id]
    )
    // Transfers read as a sentence ("Moved from A to B"), not as the bare
    // asset.transfer audit row beside them, so they get their own source.
    const { rows: moves } = await c.query(
      `select t.id, 'transfer' as kind,
         'Moved from ' || coalesce(fs.name, 'no site') || ' to ' || ts.name
           || coalesce(' — ' || nullif(t.reason, ''), '') as body,
         '[]'::jsonb as attachments, t.created_at, 'transfer' as source,
         null as entity_label,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor
       from public.asset_transfers t
       left join public.sites fs on fs.id = t.from_site_id
       left join public.sites ts on ts.id = t.to_site_id
       left join public.users u on u.id = t.transferred_by
       where t.asset_id = $1`,
      [req.params.id]
    )
    return [...acts, ...audits, ...moves].sort(
      (x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
    )
  })
  if (rows === null) return res.status(404).json({ error: 'not_found' })
  res.json(rows)
})

// Where an asset has been. Same visibility check as the activity feed:
// asset_transfers is org-scoped, the asset is site-scoped.
coreRouter.get('/assets/:id/transfers', requireCap('asset:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: assetRows } = await c.query('select 1 from public.assets where id = $1', [req.params.id])
    if (!assetRows[0]) return null
    const { rows } = await c.query(
      `select t.id, t.asset_id, t.from_site_id, t.to_site_id, t.reason, t.transferred_at, t.created_at,
         case when fs.id is null then null else jsonb_build_object('id', fs.id, 'name', fs.name) end as from_site,
         jsonb_build_object('id', ts.id, 'name', ts.name) as to_site,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as transferred_by_user
       from public.asset_transfers t
       left join public.sites fs on fs.id = t.from_site_id
       left join public.sites ts on ts.id = t.to_site_id
       left join public.users u on u.id = t.transferred_by
       where t.asset_id = $1
       order by t.transferred_at desc, t.created_at desc`,
      [req.params.id]
    )
    return rows
  })
  if (rows === null) return res.status(404).json({ error: 'not_found' })
  res.json(rows)
})

const commentInput = z.object({ body: z.string().min(1) })

// Any active member may log a comment/note on an asset's timeline.
coreRouter.post('/assets/:id/activity', async (req, res) => {
  const input = parseOr400(commentInput, req.body, res)
  if (!input) return
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
      [req.params.id, input.body]
    )
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
})

coreRouter.post('/assets', requireCap('asset:create'), async (req, res) => {
  const input = parseOr400(assetInput, req.body, res)
  if (!input) return
  if (!maintenanceDatesOrdered(input)) return res.status(400).json({ error: 'invalid_maintenance_dates' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Registering an asset at a shut-down site is allowed — equipment left on
    // a closed site still belongs on the register — but it arrives Inactive,
    // like everything else there. The status asked for is kept so reopening
    // the site gives it that, not a default.
    const data: Record<string, unknown> = { ...input }
    if (await isSiteShutdown(c, input.site_id, null)) {
      data.status_before_shutdown = input.status && input.status !== 'inactive' ? input.status : 'operational'
      data.status = 'inactive'
    }
    const { columns, placeholders, values } = buildInsert(data, [...ALLOWED, 'status_before_shutdown'])
    const { rows } = await c.query(
      `insert into public.assets (org_id, ${columns})
       values (current_org_id(), ${placeholders})
       returning id`,
      values
    )
    const assetId = rows[0].id
    // Seed both derived figures immediately. Health is a function of the two
    // maintenance dates the caller just supplied, so an asset registered
    // already below threshold gets its inspection/notification/auto-WO in this
    // request rather than after a full cron cycle — registering a compressor
    // whose next service is overdue shouldn't stay silently at null health
    // until 01:00 tomorrow.
    await recomputeDerived(c, assetId, req.claims!.sub)
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [assetId])
    const asset = full[0]
    await auditFromReq(c, req, { action: 'asset.create', entityType: 'asset', entityId: asset.id, after: asset })
    return asset
  })
  res.status(201).json(row)
})

coreRouter.post('/assets/import', requireCap('asset:create'), async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null
  if (!rows) return res.status(400).json({ error: 'invalid_request' })
  if (rows.length > 1000) return res.status(400).json({ error: 'too_many_rows', max: 1000 })

  const results = await withOrgContext(claimsFromReq(req), (c) =>
    importAssets(c, rows, { userId: req.claims!.sub, orgId: req.claims!.org_id!, ip: req.ip ?? null })
  )
  res.json({ summary: importSummary(results), results })
})

coreRouter.patch('/assets/:id', requireCap('asset:update'), async (req, res) => {
  const input = parseOr400(assetInput.partial(), req.body, res)
  if (!input) return
  if (!maintenanceDatesOrdered(input)) return res.status(400).json({ error: 'invalid_maintenance_dates' })
  const { setSql, values } = buildSet(input, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  // Only recompute what the patch could actually have moved: health follows
  // the maintenance window, book value follows the valuation inputs.
  const touchesHealth = 'last_maintenance_at' in input || 'next_maintenance_at' in input
  const touchesDepreciation = DEPRECIATION_INPUTS.some((k) => k in input)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    // An asset at a shut-down site stays inactive until the site reopens or
    // the asset is transferred out. Checked against the site the asset will be
    // on after this patch, so moving one onto a closed site with a live status
    // is refused too. Resubmitting 'inactive' (the edit form does) is fine.
    if ('status' in input || 'site_id' in input) {
      const { rows: cur } = await c.query('select site_id, status from public.assets where id = $1', [req.params.id])
      if (!cur[0]) return null
      const siteAfter = 'site_id' in input ? input.site_id : cur[0].site_id
      const statusAfter = input.status ?? cur[0].status
      if (statusAfter !== 'inactive' && (await isSiteShutdown(c, siteAfter, null))) {
        return { error: 'site_shutdown' as const }
      }
    }
    const { rows } = await c.query(`update public.assets set ${setSql} where id = $1 returning id`, [req.params.id, ...values])
    if (!rows[0]) return null
    if (touchesHealth) {
      // The five-signal engine, not recompute_asset_health_for(). The legacy
      // SQL decay writes health_score from the maintenance window alone and
      // leaves health_score_components and health_score_computed_at untouched,
      // so every asset edit — the form always submits both maintenance dates —
      // overwrote the headline with a number the stored breakdown does not
      // explain. "Show the working" then reconciled to a different total than
      // the score printed above it.
      //
      // Attributed to the caller, so the resulting asset_activity alert names
      // whoever moved the dates rather than looking like a cron event.
      await refreshAssetHealth(c, req.params.id as string, req.claims!.sub)
    }
    if (touchesDepreciation) {
      await c.query('select public.recompute_asset_depreciation_for($1)', [req.params.id])
    }
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await auditFromReq(c, req, { action: 'asset.update', entityType: 'asset', entityId: asset.id, after: input })
    return { data: asset }
  })
  if (!result) return res.status(404).json({ error: 'not_found' })
  if ('error' in result) return res.status(422).json(SITE_SHUTDOWN_ERROR)
  res.json(result.data)
})

const transferInput = z.object({
  asset_ids: z.array(z.string().uuid()).min(1).max(500),
  to_site_id: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
  transferred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// What a transfer moves with the asset: services/assetTransfer.ts.
coreRouter.post('/assets/transfer', requireCap('asset:update'), async (req, res) => {
  const input = parseOr400(transferInput, req.body, res)
  if (!input) return
  const { to_site_id: toSiteId, reason, transferred_at: transferredAt } = input
  const assetIds = [...new Set(input.asset_ids)]

  const result = await withOrgContext(claimsFromReq(req), (c) =>
    transferAssets(c, { assetIds, toSiteId, reason, transferredAt }, req.claims!.sub, req.ip ?? null)
  )

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'site_shutdown') return res.status(422).json(SITE_SHUTDOWN_ERROR)
    return res.status(403).json({ error: 'forbidden' })
  }
  res.json(result.data)
})

// Archive (soft delete) — record kept, hidden from the default registry.
coreRouter.delete('/assets/:id', requireCap('asset:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.assets set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const asset = rows[0]
    if (asset) await auditFromReq(c, req, { action: 'asset.archive', entityType: 'asset', entityId: asset.id })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// Restore an archived asset.
coreRouter.post('/assets/:id/restore', requireCap('asset:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.assets set deleted_at = null where id = $1 returning id, org_id',
      [req.params.id]
    )
    if (!rows[0]) return null
    await auditFromReq(c, req, { action: 'asset.restore', entityType: 'asset', entityId: rows[0].id })
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})
