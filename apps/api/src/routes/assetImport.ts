import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { LIFECYCLE_STATUSES, CRITICALITIES, DEPRECIATION_METHODS } from './assets.js'

export const assetImportRouter = Router()
assetImportRouter.use(requireAuth, requireOrg, requireActiveMembership)

const MAX_ROWS = 5000

const CONDITION_STATUSES = ['operational', 'attention', 'critical', 'offline'] as const

// The client parses the CSV and posts rows as objects; we re-normalise headers
// here rather than trusting the browser to have done it.
const importBody = z.object({
  rows: z.array(z.record(z.unknown())).min(1).max(MAX_ROWS),
  // 'create' errors on a duplicate AIN; 'upsert' updates the existing asset,
  // which is what re-importing a corrected spreadsheet needs.
  mode: z.enum(['create', 'upsert']).default('create'),
  create_missing_categories: z.boolean().default(false),
})

/** 'Purchase Date', 'purchase-date' and 'purchase_date' all mean the same column. */
function normaliseKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function normaliseRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue
    const value = String(v).trim()
    if (value !== '') out[normaliseKey(k)] = value
  }
  return out
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY and DD-MM-YYYY — the three forms Nigerian
 * asset registers actually arrive in. Returns null for anything else. */
function parseDate(value: string | undefined): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const m = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** '₦1,500,000.00' and '1500000' both become 150000000 cents. */
function parseMoneyToCents(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || Number.isNaN(Number(cleaned))) return null
  return Math.round(Number(cleaned) * 100)
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseEnum<T extends readonly string[]>(value: string | undefined, allowed: T): T[number] | null {
  if (!value) return null
  const v = normaliseKey(value)
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : null
}

type RowError = { row: number; ain: string | null; message: string }

assetImportRouter.post('/assets/import', requireCap('asset:create'), async (req, res) => {
  const parsed = importBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { rows, mode, create_missing_categories } = parsed.data

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    // Resolve names → ids once, not per row. Both maps are lower-cased so
    // 'Lagos Terminal' in the sheet matches 'Lagos terminal' in the database.
    const [{ rows: sites }, { rows: categories }] = await Promise.all([
      c.query<{ id: string; name: string; code: string | null }>('select id, name, code from public.sites where deleted_at is null'),
      c.query<{ id: string; name: string; code: string | null }>('select id, name, code from public.asset_categories'),
    ])
    const siteByName = new Map<string, string>()
    for (const s of sites) {
      siteByName.set(s.name.toLowerCase(), s.id)
      if (s.code) siteByName.set(s.code.toLowerCase(), s.id)
    }
    const categoryByName = new Map<string, string>()
    for (const cat of categories) {
      categoryByName.set(cat.name.toLowerCase(), cat.id)
      if (cat.code) categoryByName.set(cat.code.toLowerCase(), cat.id)
    }

    const { rows: existing } = await c.query<{ id: string; ain: string }>(
      'select id, ain from public.assets where deleted_at is null'
    )
    const assetByAin = new Map(existing.map((a) => [a.ain.toLowerCase(), a.id]))

    const errors: RowError[] = []
    let created = 0
    let updated = 0
    const seenAins = new Set<string>()

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 1
      const r = normaliseRow(rows[i])
      const ain = r.ain ?? r.asset_id ?? r.asset_tag ?? null
      const name = r.name ?? r.asset_name ?? null

      if (!ain) { errors.push({ row: rowNo, ain: null, message: 'Missing AIN' }); continue }
      if (!name) { errors.push({ row: rowNo, ain, message: 'Missing asset name' }); continue }

      // A sheet that repeats an AIN would otherwise silently keep the last one.
      if (seenAins.has(ain.toLowerCase())) {
        errors.push({ row: rowNo, ain, message: 'Duplicate AIN within this file' })
        continue
      }
      seenAins.add(ain.toLowerCase())

      const existingId = assetByAin.get(ain.toLowerCase())
      if (existingId && mode === 'create') {
        errors.push({ row: rowNo, ain, message: 'An asset with this AIN already exists' })
        continue
      }

      let siteId: string | null = null
      const siteName = r.site ?? r.site_name ?? r.location
      if (siteName) {
        siteId = siteByName.get(siteName.toLowerCase()) ?? null
        if (!siteId) { errors.push({ row: rowNo, ain, message: `Unknown site "${siteName}"` }); continue }
      }

      let categoryId: string | null = null
      const categoryName = r.category ?? r.category_name ?? r.asset_type
      if (categoryName) {
        categoryId = categoryByName.get(categoryName.toLowerCase()) ?? null
        if (!categoryId && create_missing_categories) {
          const { rows: made } = await c.query<{ id: string }>(
            'insert into public.asset_categories (org_id, name) values (current_org_id(), $1) returning id',
            [categoryName]
          )
          categoryId = made[0].id
          categoryByName.set(categoryName.toLowerCase(), categoryId)
        }
        if (!categoryId) { errors.push({ row: rowNo, ain, message: `Unknown category "${categoryName}"` }); continue }
      }

      const healthScore = parseNumber(r.health_score)
      const values = {
        ain,
        name,
        site_id: siteId,
        category_id: categoryId,
        status: parseEnum(r.status, CONDITION_STATUSES) ?? 'operational',
        lifecycle_status: parseEnum(r.lifecycle_status, LIFECYCLE_STATUSES) ?? 'in_service',
        criticality: parseEnum(r.criticality, CRITICALITIES) ?? 'medium',
        manufacturer: r.manufacturer ?? null,
        model: r.model ?? null,
        serial_number: r.serial_number ?? r.serial ?? null,
        supplier: r.supplier ?? r.vendor ?? null,
        purchase_date: parseDate(r.purchase_date),
        commission_date: parseDate(r.commission_date ?? r.commissioning_date),
        warranty_expiry: parseDate(r.warranty_expiry ?? r.warranty_expiry_date),
        purchase_value_cents: parseMoneyToCents(r.purchase_value ?? r.purchase_cost ?? r.cost),
        salvage_value_cents: parseMoneyToCents(r.salvage_value),
        useful_life_years: parseNumber(r.useful_life_years ?? r.useful_life),
        depreciation_method: parseEnum(r.depreciation_method, DEPRECIATION_METHODS),
        health_score: healthScore === null ? null : Math.min(100, Math.max(0, Math.round(healthScore))),
        lat: parseNumber(r.lat ?? r.latitude),
        lng: parseNumber(r.lng ?? r.longitude),
        tags: r.tags ? r.tags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [],
        notes: r.notes ?? null,
      }

      const cols = Object.keys(values)
      const params = Object.values(values)

      try {
        if (existingId) {
          const setSql = cols.map((col, idx) => `${col} = $${idx + 2}`).join(', ')
          await c.query(`update public.assets set ${setSql} where id = $1`, [existingId, ...params])
          updated++
        } else {
          const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ')
          await c.query(
            `insert into public.assets (${cols.join(', ')}, org_id) values (${placeholders}, current_org_id())`,
            params
          )
          created++
        }
      } catch (err) {
        // One bad row must not roll back the whole import, but a failed statement
        // aborts the surrounding transaction — so bail out and report honestly
        // rather than silently committing a partial, arbitrary subset.
        return {
          created: 0,
          updated: 0,
          aborted: true,
          errors: [
            ...errors,
            { row: rowNo, ain, message: err instanceof Error ? err.message : 'Insert failed' },
            { row: rowNo, ain: null, message: 'Import stopped — no rows were saved. Fix this row and re-import.' },
          ],
        }
      }
    }

    if (created > 0 || updated > 0) {
      await writeAuditLog(c, {
        orgId: req.claims!.org_id!,
        actorId: req.claims!.sub,
        action: 'asset.import',
        entityType: 'asset',
        after: { created, updated, failed: errors.length, mode },
      })
    }

    return { created, updated, aborted: false, errors }
  })

  res.status(result.aborted ? 422 : 200).json(result)
})
