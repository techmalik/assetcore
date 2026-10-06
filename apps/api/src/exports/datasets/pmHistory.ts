import { Where } from '../../http/query.js'
import { PM_TASK_STATUSES } from '@assetcore/domain'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const pmHistory: Dataset = {
  key: 'pm_history',
  label: 'PM history',
  description: 'Preventive maintenance tasks by asset and site, with due and completion dates.',
  cap: 'pm:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Due date',
  statuses: PM_TASK_STATUSES,
  build: async ({ c, f }) => {
    const w = new Where()
    applyFilters(w, f, { site: 't.site_id', location: 's.location_id', date: 't.due_date', status: 't.status' })
    const data = await rows(c, `
      select t.title, sch.frequency, a.ain as asset_ain, a.name as asset_name, loc.name as location, s.name as site,
        t.status, asg.full_name as assignee, t.due_date, t.completed_at, t.notes, t.created_at
      from public.pm_tasks t
      left join public.pm_schedules sch on sch.id = t.schedule_id
      left join public.assets a on a.id = t.asset_id
      left join public.sites s on s.id = t.site_id
      left join public.locations loc on loc.id = s.location_id
      left join public.users asg on asg.id = t.assignee_id
      ${w.sql}
      order by t.due_date desc nulls last, t.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Task', 'title', 'text', 32), col('Frequency', 'frequency', 'text', 12),
        col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
        col('Status', 'status', 'text', 12), col('Assignee', 'assignee', 'text', 20),
        col('Due Date', 'due_date', 'date', 13), col('Completed', 'completed_at', 'datetime', 17),
        col('Notes', 'notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
