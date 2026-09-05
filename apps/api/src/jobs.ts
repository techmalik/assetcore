import cron from 'node-cron'
import { ownerPool } from './db.js'
import { logger } from './logger.js'
import { config } from './config.js'
import { recomputeAllHealthScores } from './healthService.js'

// No pg_cron dependency on the client's box — node-cron drives these instead.
// Most are `security definer` SQL functions called via the owner pool, which
// sqlJob wraps; health scoring is TypeScript (apps/api/src/health.ts) and runs
// directly. Every job is the same shape, so all of them are scheduled, logged
// and error-handled identically.
type Job = { name: string; schedule: string; run: () => Promise<unknown> }

const sqlJob = (sql: string) => async () => (await ownerPool.query(sql)).rows[0]

// Ordering within the morning matters: escalations run after PM generation and
// overdue marking, so a task that became overdue overnight can escalate the
// same morning rather than a day late.
const jobs: Job[] = [
  { name: 'mark_overdue_pm_tasks', schedule: '5 0 * * *', run: sqlJob('select public.mark_overdue_pm_tasks()') },
  { name: 'generate_pm_tasks', schedule: '0 6 * * *', run: sqlJob('select public.generate_pm_tasks()') },
  { name: 'check_low_stock', schedule: '30 6 * * *', run: sqlJob('select public.check_low_stock()') },
  { name: 'check_licence_expiry', schedule: '0 7 * * *', run: sqlJob('select public.check_licence_expiry()') },
  { name: 'run_escalations', schedule: '15 7 * * *', run: sqlJob('select public.run_escalations()') },
  {
    name: 'recompute_health_scores',
    schedule: '30 7 * * *',
    run: async () => ({ assets_rescored: await recomputeAllHealthScores(ownerPool) }),
  },
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
