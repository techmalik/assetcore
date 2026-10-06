import type { Request } from 'express'
import type { PoolClient } from 'pg'
import type { Capability } from '@assetcore/rbac'
import type { ColumnType, ReportColumn, ReportData } from '../reportBuilders.js'
import type { Where } from '../http/query.js'

// What every export dataset is built from: its shape, the filters it can
// take, and the helpers its query uses.

/** Past this a spreadsheet stops being something a person opens. The file
 * says so (X-Export-Truncated) rather than silently dropping the tail. */
export const ROW_LIMIT = 100_000

export type FilterKey = 'location' | 'site' | 'date' | 'status' | 'q' | 'actor' | 'action' | 'entity_type'

export type SchemaFlags = { hasTransfers: boolean; hasSiteStatus: boolean; hasSiteShutdown: boolean }

export type CommonFilters = { location_id?: string; site_id?: string; from?: string; to?: string; status?: string }

export type BuildCtx = { c: PoolClient; req: Request; f: CommonFilters; schema: SchemaFlags }

export type Dataset = {
  key: string
  label: string
  description: string
  cap: Capability
  filters: FilterKey[] | ((s: SchemaFlags) => FilterKey[])
  /** What the date range is measured against, so the page can label it. */
  dateLabel?: string
  statuses?: readonly string[]
  available?: (s: SchemaFlags) => boolean
  /** Datasets with their own filter vocabulary (the audit log) parse the
   * query themselves; everything else gets the common filters. */
  parse?: (query: Request['query']) => Record<string, string>
  build: (ctx: BuildCtx & { raw: Record<string, string> }) => Promise<ReportData>
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const DAY = /^\d{4}-\d{2}-\d{2}$/

export const col = (header: string, key: string, type?: ColumnType, width?: number): ReportColumn => ({ header, key, type, width })

type FilterCols = { site?: string; location?: string; date?: string; status?: string }

export function applyFilters(w: Where, f: CommonFilters, cols: FilterCols) {
  if (f.location_id && cols.location) w.add(`${cols.location} = $?`, f.location_id)
  if (f.site_id && cols.site) w.add(`${cols.site} = $?`, f.site_id)
  // Compared as calendar days — every connection runs in the instance's
  // TimeZone (db.ts), so `::date` on a timestamptz is the local day, and `to` includes
  // the whole of that day for date and timestamptz columns alike.
  if (f.from && cols.date) w.add(`(${cols.date})::date >= $?::date`, f.from)
  if (f.to && cols.date) w.add(`(${cols.date})::date <= $?::date`, f.to)
  if (f.status && cols.status) w.add(`${cols.status} = $?`, f.status)
}

export const LIMIT_SQL = `limit ${ROW_LIMIT + 1}`

export async function rows(c: PoolClient, sql: string, params: unknown[]) {
  return (await c.query(sql, params)).rows as Record<string, unknown>[]
}
