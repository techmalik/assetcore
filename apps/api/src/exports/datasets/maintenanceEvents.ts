import { Where } from '../../http/query.js'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const maintenanceEvents: Dataset = {
  key: 'maintenance_events',
  label: 'Maintenance completions',
  description: 'Every recorded maintenance completion, what closed it, who did it and the next due date.',
  cap: 'pm:read',
  filters: ['location', 'site', 'date'],
  dateLabel: 'Completed on',
  build: async ({ c, f }) => {
    const w = new Where()
    applyFilters(w, f, { site: 'e.site_id', location: 's.location_id', date: 'e.completed_at' })
    const data = await rows(c, `
      select e.completed_at, a.ain as asset_ain, a.name as asset_name, loc.name as location, s.name as site,
        e.source, t.title as pm_task, wo.ref as work_order_ref, u.full_name as performed_by,
        e.next_maintenance_at, e.notes, e.created_at
      from public.maintenance_events e
      left join public.assets a on a.id = e.asset_id
      left join public.sites s on s.id = e.site_id
      left join public.locations loc on loc.id = s.location_id
      left join public.pm_tasks t on t.id = e.pm_task_id
      left join public.work_orders wo on wo.id = e.work_order_id
      left join public.users u on u.id = e.performed_by
      ${w.sql}
      order by e.completed_at desc, e.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Completed On', 'completed_at', 'date', 13),
        col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
        col('Source', 'source', 'text', 12), col('PM Task', 'pm_task', 'text', 28), col('Work Order', 'work_order_ref', 'text', 14),
        col('Performed By', 'performed_by', 'text', 20), col('Next Maintenance', 'next_maintenance_at', 'date', 16),
        col('Notes', 'notes', 'text', 30), col('Recorded', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
