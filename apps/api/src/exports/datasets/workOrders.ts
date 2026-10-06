import { Where } from '../../http/query.js'
import { WO_STATUSES } from '@assetcore/domain'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const workOrders: Dataset = {
  key: 'work_orders',
  label: 'Work orders',
  description: 'Jobs with asset, assignee, schedule, hours, cost and close-out notes.',
  cap: 'wo:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Raised',
  statuses: WO_STATUSES,
  build: async ({ c, f }) => {
    const w = new Where()
    w.add('w.deleted_at is null')
    applyFilters(w, f, { site: 'w.site_id', location: 's.location_id', date: 'w.created_at', status: 'w.status' })
    const data = await rows(c, `
      select w.ref, w.title, w.type, w.status, w.priority, loc.name as location, s.name as site,
        a.ain as asset_ain, a.name as asset_name, asg.full_name as assignee, cr.full_name as created_by,
        w.sla_due, w.planned_start, w.planned_end, w.actual_start, w.actual_end,
        w.estimated_hours, w.actual_hours, w.downtime_hours, w.estimated_cost_cents, w.cost_cents,
        w.failure_mode, w.root_cause, w.corrective_actions, w.completion_notes, w.created_at, w.updated_at
      from public.work_orders w
      left join public.sites s on s.id = w.site_id
      left join public.locations loc on loc.id = s.location_id
      left join public.assets a on a.id = w.asset_id
      left join public.users asg on asg.id = w.assignee_id
      left join public.users cr on cr.id = w.created_by
      ${w.sql}
      order by w.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Ref', 'ref', 'text', 14), col('Title', 'title', 'text', 32), col('Type', 'type', 'text', 12),
        col('Status', 'status', 'text', 14), col('Priority', 'priority', 'text', 10),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
        col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('Assignee', 'assignee', 'text', 20), col('Raised By', 'created_by', 'text', 20),
        col('SLA Due', 'sla_due', 'datetime', 17), col('Planned Start', 'planned_start', 'date', 13), col('Planned End', 'planned_end', 'date', 13),
        col('Actual Start', 'actual_start', 'datetime', 17), col('Actual End', 'actual_end', 'datetime', 17),
        col('Estimated Hours', 'estimated_hours', 'number', 15), col('Actual Hours', 'actual_hours', 'number', 13),
        col('Downtime Hours', 'downtime_hours', 'number', 15),
        col('Estimated Cost (NGN)', 'estimated_cost_cents', 'money', 20), col('Cost (NGN)', 'cost_cents', 'money', 16),
        col('Failure Mode', 'failure_mode', 'text', 20), col('Root Cause', 'root_cause', 'text', 24),
        col('Corrective Actions', 'corrective_actions', 'text', 28), col('Completion Notes', 'completion_notes', 'text', 28),
        col('Created', 'created_at', 'datetime', 17), col('Updated', 'updated_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
