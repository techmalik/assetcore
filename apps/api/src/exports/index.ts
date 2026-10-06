import type { Request } from 'express'
import type { PoolClient } from 'pg'
import { UUID, DAY, type Dataset, type SchemaFlags, type FilterKey, type CommonFilters } from './common.js'
import { assets } from './datasets/assets.js'
import { workOrders } from './datasets/workOrders.js'
import { pmHistory } from './datasets/pmHistory.js'
import { maintenanceEvents } from './datasets/maintenanceEvents.js'
import { inspections } from './datasets/inspections.js'
import { defects } from './datasets/defects.js'
import { risks } from './datasets/risks.js'
import { complianceLicences } from './datasets/complianceLicences.js'
import { sites } from './datasets/sites.js'
import { assetTransfers } from './datasets/assetTransfers.js'
import { auditLog } from './datasets/auditLog.js'

// Every register a role can export, in the order the Export page lists them.
export const DATASETS: Dataset[] = [
  assets,
  workOrders,
  pmHistory,
  maintenanceEvents,
  inspections,
  defects,
  risks,
  complianceLicences,
  sites,
  assetTransfers,
  auditLog,
]

/** Tables and columns other migrations are still landing (0027). Checked per
 * request so the module works on either side of that migration. */
export async function schemaFlags(c: PoolClient): Promise<SchemaFlags> {
  const { rows: r } = await c.query(`
    select to_regclass('public.asset_transfers') is not null as has_transfers,
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sites' and column_name = 'status') as has_site_status,
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sites' and column_name = 'shutdown_at') as has_site_shutdown`)
  return { hasTransfers: r[0].has_transfers, hasSiteStatus: r[0].has_site_status, hasSiteShutdown: r[0].has_site_shutdown }
}

export function filtersFor(ds: Dataset, schema: SchemaFlags): FilterKey[] {
  return typeof ds.filters === 'function' ? ds.filters(schema) : ds.filters
}

/** Common filters, keeping only the ones this dataset supports and values
 * that could match. Anything else is ignored rather than 400'd, like the
 * audit log's own filter bar. */
export function parseCommon(ds: Dataset, schema: SchemaFlags, q: Request['query']): CommonFilters {
  const allowed = filtersFor(ds, schema)
  const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).trim() : '')
  const f: CommonFilters = {}
  if (allowed.includes('location') && UUID.test(str('location_id'))) f.location_id = str('location_id')
  if (allowed.includes('site') && UUID.test(str('site_id'))) f.site_id = str('site_id')
  if (allowed.includes('date')) {
    if (DAY.test(str('from'))) f.from = str('from')
    if (DAY.test(str('to'))) f.to = str('to')
  }
  if (allowed.includes('status') && ds.statuses?.includes(str('status'))) f.status = str('status')
  return f
}
