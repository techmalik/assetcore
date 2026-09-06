import cron from 'node-cron'
import { ownerPool } from './db.js'
import { logger } from './logger.js'
import { config } from './config.js'
import { recomputeAllHealthScores } from './healthService.js'

// No pg_cron dependency on the client's box — node-cron drives these instead.
// Most are `security definer` SQL functions called via the owner pool, which
// sqlJob wraps; health scoring is TypeScript (apps/api/src/health.ts) and runs
// directly. Every job is the same shape, so all are scheduled, logged and
// error-handled identically.
type Job = { name: string; schedule: string; run: () => Promise<unknown> }

const sqlJob = (sql: string) => async () => (await ownerPool.query(sql)).rows[0]

const jobs: Job[] = [
  { name: 'mark_overdue_pm_tasks', schedule: '5 0 * * *', run: sqlJob('select public.mark_overdue_pm_tasks()') },
  // Health reads overdue PM and past-SLA jobs, so it runs after the overdue
  // pass has marked them — otherwise a task that went overdue overnight would
  // not affect the score until tomorrow.
  {
    name: 'recompute_asset_health',
    schedule: '0 1 * * *',
    run: async () => ({ assets_rescored: await recomputeAllHealthScores(ownerPool) }),
  },
  // After the health pass, so a night's run leaves both derived figures on the
  // same day's basis.
  { name: 'recompute_asset_depreciation', schedule: '0 2 * * *', run: sqlJob('select public.recompute_asset_depreciation()') },
  { name: 'generate_pm_tasks', schedule: '0 6 * * *', run: sqlJob('select public.generate_pm_tasks()') },
  { name: 'check_low_stock', schedule: '30 6 * * *', run: sqlJob('select public.check_low_stock()') },
  { name: 'notify_pm_due', schedule: '30 6 * * *', run: sqlJob('select public.notify_pm_due()') },
  { name: 'check_licence_expiry', schedule: '0 7 * * *', run: sqlJob('select public.check_licence_expiry()') },
  // Last: escalations read everything the earlier jobs have just settled, so a
  // task that became overdue overnight escalates the same morning.
  { name: 'run_escalations', schedule: '15 7 * * *', run: sqlJob('select public.run_escalations()') },
]

export function startJobs(): void {
  for (const job of jobs) {
    cron.schedule(
      job.schedule,
      async () => {
        try {
          const result = await job.run()
          logger.info({ job: job.name, result }, 'cron job completed')
        } catch (err) {
          logger.error({ job: job.name, err }, 'cron job failed')
        }
      },
      { timezone: config.TZ }
    )
  }
  logger.info({ jobs: jobs.map((j) => j.name), timezone: config.TZ }, 'cron jobs scheduled')
}
