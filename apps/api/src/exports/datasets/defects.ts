import { Where } from '../../http/query.js'
import { DEFECT_STATUSES } from '@assetcore/domain'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const defects: Dataset = {
  key: 'defects',
  label: 'Defects',
  description: 'Raised defects with severity, status, owner, due date and resolution.',
  cap: 'defect:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Identified',
  statuses: DEFECT_STATUSES,
  build: async ({ c, f }) => {
    const w = new Where()
    w.add('d.deleted_at is null')
    applyFilters(w, f, { site: 'd.site_id', location: 's.location_id', date: 'd.identified_date', status: 'd.status' })
    const data = await rows(c, `
      select d.ref, d.title, d.severity, d.status, d.category, a.ain as asset_ain, a.name as asset_name,
        loc.name as location, s.name as site, rep.full_name as reported_by, asg.full_name as assigned_to,
        d.identified_date, d.due_date, d.resolved_at, wo.ref as work_order_ref, d.description, d.resolution_notes, d.created_at
      from public.defects d
      left join public.assets a on a.id = d.asset_id
      left join public.sites s on s.id = d.site_id
      left join public.locations loc on loc.id = s.location_id
      left join public.users rep on rep.id = d.reported_by
      left join public.users asg on asg.id = d.assigned_to
      left join public.work_orders wo on wo.id = d.work_order_id
      ${w.sql}
      order by d.identified_date desc nulls last, d.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Ref', 'ref', 'text', 14), col('Title', 'title', 'text', 30), col('Severity', 'severity', 'text', 11),
        col('Status', 'status', 'text', 13), col('Category', 'category', 'text', 14),
        col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
        col('Reported By', 'reported_by', 'text', 20), col('Assigned To', 'assigned_to', 'text', 20),
        col('Identified', 'identified_date', 'date', 13), col('Due', 'due_date', 'date', 13), col('Resolved', 'resolved_at', 'datetime', 17),
        col('Work Order', 'work_order_ref', 'text', 14), col('Description', 'description', 'text', 36),
        col('Resolution Notes', 'resolution_notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
