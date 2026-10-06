import { Where } from '../../http/query.js'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const sites: Dataset = {
  key: 'sites',
  label: 'Sites',
  description: 'Sites with their location, region, coordinates and asset count.',
  cap: 'asset:read',
  // sites.status arrives with migration 0027; until then there is nothing
  // to filter on and no column to show.
  filters: (s) => (s.hasSiteStatus ? ['location', 'site', 'status'] : ['location', 'site']),
  statuses: ['active', 'shutdown'],
  build: async ({ c, f, schema }) => {
    const w = new Where()
    w.add('s.deleted_at is null')
    applyFilters(w, { ...f, status: schema.hasSiteStatus ? f.status : undefined }, {
      site: 's.id', location: 's.location_id', status: 's.status',
    })
    const data = await rows(c, `
      select s.name, s.code, loc.name as location, s.region,
        ${schema.hasSiteStatus ? 's.status,' : ''}
        ${schema.hasSiteShutdown ? 's.shutdown_at, s.shutdown_reason,' : ''}
        s.lat, s.lng,
        (select count(*) from public.assets a where a.site_id = s.id and a.deleted_at is null)::int as asset_count,
        s.created_at
      from public.sites s
      left join public.locations loc on loc.id = s.location_id
      ${w.sql}
      order by loc.name nulls last, s.name
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Site', 'name', 'text', 24), col('Code', 'code', 'text', 10), col('Location', 'location', 'text', 18),
        col('Region', 'region', 'text', 16),
        ...(schema.hasSiteStatus ? [col('Status', 'status', 'text', 12)] : []),
        ...(schema.hasSiteShutdown ? [col('Shut Down', 'shutdown_at', 'datetime', 17), col('Shutdown Reason', 'shutdown_reason', 'text', 30)] : []),
        col('Latitude', 'lat', 'number', 12), col('Longitude', 'lng', 'number', 12),
        col('Assets', 'asset_count', 'number', 9), col('Created', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
