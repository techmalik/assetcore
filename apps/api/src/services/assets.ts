import type { PoolClient } from 'pg'
import { refreshAssetHealth } from '../healthService.js'

// An asset's location is derived from its site (site -> location), so the two
// always stay in sync from the single site_id the asset stores.
export const ASSET_SELECT = `
  select a.*,
    -- lat/lng travel with the site so an asset with no fix of its own can
    -- still be shown on a map at the place it lives.
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'location_id', s.location_id, 'lat', s.lat, 'lng', s.lng) end as site,
    case when loc.id is null then null else jsonb_build_object('id', loc.id, 'name', loc.name) end as location,
    case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end as category,
    case when op.id is null then null else jsonb_build_object('id', op.id, 'full_name', op.full_name) end as operator
  from public.assets a
  left join public.sites s on s.id = a.site_id
  left join public.locations loc on loc.id = s.location_id
  left join public.asset_categories c on c.id = a.category_id
  left join public.users op on op.id = a.assigned_operator_id
`

// Both derived figures, recomputed for one asset. Called after every write
// that can move them so the response the client gets back is already correct.
//
// Health now comes from the five-signal engine (apps/api/src/health.ts), which
// replaced recompute_asset_health_for()'s linear decay between the maintenance
// dates. The decay is not lost — "overdue maintenance" is one of the five
// inputs — and the score still goes through apply_asset_health(), so the 50%
// and 30% crossings keep raising inspections and drafting work orders.
//
// recompute_asset_depreciation_for() writes nulls when there's no purchase
// value or start date, and yields entirely to a posted subledger, so it needs
// no guard here.
export async function recomputeDerived(c: PoolClient, assetId: string, actorId: string): Promise<void> {
  await refreshAssetHealth(c, assetId, actorId)
  await c.query('select public.recompute_asset_depreciation_for($1)', [assetId])
}

// next must be strictly after last, or the decay denominator is <= 0 and the
// recompute job skips the asset. ISO yyyy-mm-dd strings compare lexically.
export function maintenanceDatesOrdered(data: { last_maintenance_at?: string; next_maintenance_at?: string }): boolean {
  if (!data.last_maintenance_at || !data.next_maintenance_at) return true
  return data.next_maintenance_at > data.last_maintenance_at
}
