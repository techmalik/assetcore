import { Router } from 'express'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { hasCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { localDateStamp, renderCsv, renderXlsx } from '../reportBuilders.js'
import { DATASETS, schemaFlags, filtersFor, parseCommon } from '../exports/index.js'
import { ROW_LIMIT } from '../exports/common.js'

// Export module: every register a role can read, as CSV or Excel, built in
// memory and streamed straight back. Unlike /reports nothing is stored — an
// export is a snapshot of what the caller can see right now, and a stored
// copy would outlive the access that produced it.
//
// Scoping is RLS's job (withOrgContext sets org + site scope), so a
// site-scoped user's file only ever holds their sites. Capability gating is
// done here per dataset, because one router serves registers with different
// read capabilities.

export const exportsRouter = Router()

exportsRouter.get('/exports', async (req, res) => {
  const schema = await withOrgContext(claimsFromReq(req), schemaFlags)
  const list = DATASETS
    .filter((ds) => hasCap(req, ds.cap) && (!ds.available || ds.available(schema)))
    .map((ds) => {
      const filters = filtersFor(ds, schema)
      return {
        key: ds.key,
        label: ds.label,
        description: ds.description,
        filters,
        ...(filters.includes('date') && ds.dateLabel ? { date_label: ds.dateLabel } : {}),
        ...(filters.includes('status') && ds.statuses ? { statuses: ds.statuses } : {}),
      }
    })
  res.json(list)
})

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

exportsRouter.get('/exports/:dataset', async (req, res) => {
  const ds = DATASETS.find((d) => d.key === req.params.dataset)
  if (!ds) return res.status(404).json({ error: 'unknown_dataset' })
  if (!hasCap(req, ds.cap)) return res.status(403).json({ error: 'forbidden', capability: ds.cap })

  const rawFormat = req.query.format ?? 'xlsx'
  if (rawFormat !== 'csv' && rawFormat !== 'xlsx') return res.status(400).json({ error: 'invalid_format' })
  const format: 'csv' | 'xlsx' = rawFormat

  const out = await withOrgContext(claimsFromReq(req), async (c) => {
    const schema = await schemaFlags(c)
    if (ds.available && !ds.available(schema)) return null

    const f = ds.parse ? {} : parseCommon(ds, schema, req.query)
    const raw = ds.parse ? ds.parse(req.query) : {}
    const data = await ds.build({ c, req, f, schema, raw })

    const truncated = data.rows.length > ROW_LIMIT
    if (truncated) data.rows = data.rows.slice(0, ROW_LIMIT)

    // Rendered before the audit row commits, so a render failure can't leave
    // the log claiming a download that never happened.
    const body = format === 'xlsx' ? await renderXlsx(data, ds.label) : Buffer.from(renderCsv(data), 'utf8')

    await writeAuditLog(c, {
      orgId: req.claims!.org_id!,
      actorId: req.claims!.sub,
      action: 'export.download',
      entityType: 'export',
      // `title` is what resolve_audit_label reads for a row with no entity_id,
      // so the log's Entity column says which register left the building.
      after: { title: ds.label, dataset: ds.key, format, filters: ds.parse ? raw : f, row_count: data.rows.length, truncated },
      ip: req.ip ?? null,
    })
    return { body, rowCount: data.rows.length, truncated }
  })

  if (!out) return res.status(404).json({ error: 'unknown_dataset' })

  const filename = `assetcore-${ds.key}-${localDateStamp()}.${format}`
  res.setHeader('Content-Type', CONTENT_TYPES[format])
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length', String(out.body.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Export-Row-Count', String(out.rowCount))
  res.setHeader('X-Export-Truncated', String(out.truncated))
  // A split-host dev setup (VITE_API_URL) can't read these cross-origin otherwise.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Row-Count, X-Export-Truncated')
  res.end(out.body)
})
