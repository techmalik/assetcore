import { Where } from '../../http/query.js'
import { INSPECTION_STATUSES } from '@assetcore/domain'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const inspections: Dataset = {
  key: 'inspections',
  label: 'Inspections',
  description: 'Inspections with kind, inspector, schedule, condition rating and findings.',
  cap: 'inspection:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Scheduled date',
  statuses: INSPECTION_STATUSES,
  build: async ({ c, f }) => {
    const w = new Where()
    applyFilters(w, f, { site: 'i.site_id', location: 's.location_id', date: 'i.scheduled_date', status: 'i.status' })
    const data = await rows(c, `
      select i.title, i.kind, i.status, a.ain as asset_ain, a.name as asset_name, loc.name as location, s.name as site,
        u.full_name as inspector, i.scheduled_date, i.completed_date, i.condition_rating, i.findings, i.notes, i.created_at
      from public.inspections i
      left join public.assets a on a.id = i.asset_id
      left join public.sites s on s.id = i.site_id
      left join public.locations loc on loc.id = s.location_id
      left join public.users u on u.id = i.inspector_id
      ${w.sql}
      order by i.scheduled_date desc nulls last, i.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Title', 'title', 'text', 30), col('Kind', 'kind', 'text', 14), col('Status', 'status', 'text', 12),
        col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18), col('Inspector', 'inspector', 'text', 20),
        col('Scheduled', 'scheduled_date', 'date', 13), col('Completed', 'completed_date', 'date', 13),
        col('Condition Rating', 'condition_rating', 'number', 16),
        col('Findings', 'findings', 'text', 36), col('Notes', 'notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
