import { Where } from '../../http/query.js'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const assetTransfers: Dataset = {
  key: 'asset_transfers',
  label: 'Asset transfers',
  description: 'Assets moved between sites: from where, to where, why and by whom.',
  cap: 'asset:read',
  filters: ['location', 'site', 'date'],
  dateLabel: 'Transferred',
  available: (s) => s.hasTransfers,
  build: async ({ c, f }) => {
    const w = new Where()
    // A transfer belongs to both ends — filtering by a site or location
    // should show assets that left it as well as those that arrived.
    if (f.site_id) w.add('(t.from_site_id = $? or t.to_site_id = $?)', f.site_id, f.site_id)
    if (f.location_id) w.add('(fs.location_id = $? or ts.location_id = $?)', f.location_id, f.location_id)
    applyFilters(w, { from: f.from, to: f.to }, { date: 't.transferred_at' })
    const data = await rows(c, `
      select t.transferred_at, a.ain as asset_ain, a.name as asset_name,
        fs.name as from_site, fl.name as from_location, ts.name as to_site, tl.name as to_location,
        t.reason, u.full_name as transferred_by, t.created_at
      from public.asset_transfers t
      left join public.assets a on a.id = t.asset_id
      left join public.sites fs on fs.id = t.from_site_id
      left join public.locations fl on fl.id = fs.location_id
      left join public.sites ts on ts.id = t.to_site_id
      left join public.locations tl on tl.id = ts.location_id
      left join public.users u on u.id = t.transferred_by
      ${w.sql}
      order by t.transferred_at desc, t.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Transferred', 'transferred_at', 'datetime', 17),
        col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('From Site', 'from_site', 'text', 18), col('From Location', 'from_location', 'text', 18),
        col('To Site', 'to_site', 'text', 18), col('To Location', 'to_location', 'text', 18),
        col('Reason', 'reason', 'text', 32), col('Transferred By', 'transferred_by', 'text', 20),
        col('Recorded', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
