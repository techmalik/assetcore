import type { PoolClient } from 'pg'
import { z } from 'zod'
import { ASSET_STATUSES } from '@assetcore/domain'
import { writeAuditLog } from '../audit.js'
import { recomputeDerived } from './assets.js'

// Bulk CSV import: rows of { ain, name, category, site, status, ... }.
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

type ImportRowResult = { ain: string; status: 'created' | 'skipped' | 'error'; message?: string }

/** Imports the rows in the caller's transaction and says what happened to
 * each. Categories, locations and sites are matched by name or code. */
export async function importAssets(
  c: PoolClient, rows: Array<Record<string, unknown>>, actor: { userId: string; orgId: string }
): Promise<ImportRowResult[]> {
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

  const out: ImportRowResult[] = []
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
    // install_date/purchase_date are real date columns as of 0015 — they
    // used to land in `specs` as unvalidated free text, which is why the
    // format check below exists now.
    for (const key of ['install_date', 'purchase_date']) {
      if (r[key] && !ISO_DATE.test(String(r[key]))) {
        r[key] = null
      }
    }
    const specs: Record<string, unknown> = {}
    if (r.manufacturer) specs.manufacturer = r.manufacturer
    if (r.model) specs.model = r.model
    if (r.serial_number) specs.serial_number = r.serial_number
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
    const value = num(r.value) != null ? Math.round(num(r.value)! * 100) : null

    await c.query('savepoint import_row')
    try {
      const { rows: ins } = await c.query(
        // Same rule as the create endpoint: a row landing on a shut-down
        // site arrives inactive, remembering the status the file gave it.
        `insert into public.assets (org_id, ain, name, category_id, site_id, status, status_before_shutdown, purchase_value_cents, specs, lat, lng, last_maintenance_at, next_maintenance_at, install_date, purchase_date)
         select current_org_id(), $1, $2, $3, $4,
                case when shut then 'inactive' else $5 end,
                case when shut then nullif($5, 'inactive') end,
                $6, $7::jsonb, $8, $9, $10, $11, $12, $13
         from (select exists (select 1 from public.sites where id = $4 and status = 'shutdown') as shut) s
         on conflict (org_id, ain) do nothing
         returning id`,
        [r.ain, r.name, categoryId, siteId, status, value, JSON.stringify(specs), num(r.lat), num(r.lng), r.last_maintenance_date, r.next_maintenance_date, r.install_date || null, r.purchase_date || null]
      )
      if (ins[0]) {
        // Previously the import wrote health_score straight into the INSERT,
        // so an imported asset already below threshold raised no inspection
        // and no auto-WO until the next nightly run. Both derived figures
        // now go through the same path as a UI-created asset.
        await recomputeDerived(c, ins[0].id, actor.userId)
        await writeAuditLog(c, { orgId: actor.orgId, actorId: actor.userId, action: 'asset.import', entityType: 'asset', entityId: ins[0].id })
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
}

export function importSummary(results: ImportRowResult[]) {
  return {
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    errors: results.filter((r) => r.status === 'error').length,
  }
}
