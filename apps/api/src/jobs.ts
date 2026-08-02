import cron from 'node-cron'
import { ownerPool } from './db.js'
import { logger } from './logger.js'
import { config } from './config.js'

// No pg_cron dependency on the client's box — node-cron drives these SQL
// functions instead. All three are `security definer`, called here via the
// owner pool.
const jobs = [
  { name: 'generate_pm_tasks', schedule: '0 6 * * *', sql: 'select public.generate_pm_tasks()' },
  { name: 'mark_overdue_pm_tasks', schedule: '5 0 * * *', sql: 'select public.mark_overdue_pm_tasks()' },
  { name: 'check_licence_expiry', schedule: '0 7 * * *', sql: 'select public.check_licence_expiry()' },
  { name: 'recompute_asset_health', schedule: '0 1 * * *', sql: 'select public.recompute_asset_health()' },
  // After the health pass, so a night's run leaves both derived figures on the
  // same day's basis.
  { name: 'recompute_asset_depreciation', schedule: '0 2 * * *', sql: 'select public.recompute_asset_depreciation()' },
  { name: 'notify_pm_due', schedule: '30 6 * * *', sql: 'select public.notify_pm_due()' },
]

export function startJobs(): void {
  for (const job of jobs) {
    cron.schedule(
      job.schedule,
      async () => {
        try {
          const { rows } = await ownerPool.query(job.sql)
          logger.info({ job: job.name, result: rows[0] }, 'cron job completed')
        } catch (err) {
          logger.error({ job: job.name, err }, 'cron job failed')
        }
      },
      { timezone: config.TZ }
    )
  }
  logger.info({ jobs: jobs.map((j) => j.name), timezone: config.TZ }, 'cron jobs scheduled')
}
