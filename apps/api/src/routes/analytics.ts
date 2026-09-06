import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { meanTimeToRepair, meanTimeBetweenFailures, bucketBacklog } from '../kpis.js'

export const analyticsRouter = Router()
analyticsRouter.use(requireAuth, requireOrg, requireActiveMembership)

// A failure is a job someone had to raise because something broke. Planned
// work is not a failure, and counting it as one flatters MTBF badly.
const FAILURE_TYPES = ['corrective', 'emergency']

const windowInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  asset_id: z.string().uuid().optional(),
})

/** Defaults to the last 90 days — long enough for most fleets to have failed
 * at least once, which is what MTBF needs to say anything at all. */
function resolveWindow(q: z.infer<typeof windowInput>): { from: string; to: string; hours: number } {
  const to = q.to ?? new Date().toISOString().slice(0, 10)
  const from = q.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const hours = Math.max(0, (Date.parse(`${to}T23:59:59Z`) - Date.parse(`${from}T00:00:00Z`)) / 3_600_000)
  return { from, to, hours }
}

/**
 * MTBF, MTTR, availability and backlog for a period.
 *
 * All of it is computed from work_orders as they stand — nothing is stored, so
 * a figure here can always be reconciled against the jobs behind it rather
 * than against a snapshot taken at some point nobody remembers.
 */
analyticsRouter.get('/analytics/kpis', requireCap('report:read'), async (req, res) => {
  const parsed = windowInput.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const w = resolveWindow(parsed.data)
  const assetId = parsed.data.asset_id ?? null

  const payload = await withOrgContext(claimsFromReq(req), async (c) => {
    const [{ rows: repairs }, { rows: failures }, { rows: backlog }, { rows: assets }] = await Promise.all([
      // Closed failure jobs in the window, for MTTR.
      c.query(
        `select actual_start, actual_end
         from public.work_orders
         where deleted_at is null and status = 'closed'
           and type = any($1)
           and actual_end::date between $2 and $3
           and ($4::uuid is null or asset_id = $4)`,
        [FAILURE_TYPES, w.from, w.to, assetId]
      ),
      // Every failure raised in the window, closed or not, plus the downtime
      // they recorded — open failures still count against MTBF.
      c.query(
        `select count(*)::int as n, coalesce(sum(downtime_hours), 0)::float as downtime
         from public.work_orders
         where deleted_at is null and type = any($1)
           and created_at::date between $2 and $3
           and ($4::uuid is null or asset_id = $4)`,
        [FAILURE_TYPES, w.from, w.to, assetId]
      ),
      c.query(
        `select created_at, priority
         from public.work_orders
         where deleted_at is null and status <> 'closed'
           and ($1::uuid is null or asset_id = $1)`,
        [assetId]
      ),
      // Only assets that were meant to be running can accrue operating hours.
      c.query(
        `select count(*)::int as n from public.assets
         where deleted_at is null and lifecycle_status in ('in_service','under_maintenance')
           and ($1::uuid is null or id = $1)`,
        [assetId]
      ),
    ])

    const assetCount = assets[0]?.n ?? 0
    const mtbf = meanTimeBetweenFailures({
      failures: failures[0]?.n ?? 0,
      calendar_hours: w.hours * assetCount,
      downtime_hours: Number(failures[0]?.downtime ?? 0),
    })

    return {
      window: { from: w.from, to: w.to, days: Math.round(w.hours / 24) },
      assets_in_service: assetCount,
      mttr: meanTimeToRepair(repairs),
      mtbf,
      backlog: bucketBacklog(backlog),
      backlog_total: backlog.length,
    }
  })
  res.json(payload)
})

/** Failures and closures per month — the shape behind the trend chart. */
analyticsRouter.get('/analytics/work-order-trend', requireCap('report:read'), async (req, res) => {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36)
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      // generate_series gives every month a row, so a quiet month shows as a
      // zero rather than vanishing and making the line lie about its shape.
      `with months as (
         select generate_series(
           date_trunc('month', current_date) - make_interval(months => $1::int - 1),
           date_trunc('month', current_date),
           interval '1 month'
         )::date as month
       )
       select m.month,
         (select count(*)::int from public.work_orders w
           where w.deleted_at is null
             and date_trunc('month', w.created_at)::date = m.month)                       as raised,
         (select count(*)::int from public.work_orders w
           where w.deleted_at is null and w.status = 'closed' and w.actual_end is not null
             and date_trunc('month', w.actual_end)::date = m.month)                       as closed,
         (select count(*)::int from public.work_orders w
           where w.deleted_at is null and w.type = any($2)
             and date_trunc('month', w.created_at)::date = m.month)                       as failures
       from months m order by m.month`,
      [months, FAILURE_TYPES]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

/** The mix charts on the analytics page: work by status, priority and type. */
analyticsRouter.get('/analytics/work-order-mix', requireCap('report:read'), async (req, res) => {
  const payload = await withOrgContext(claimsFromReq(req), async (c) => {
    const [{ rows: byStatus }, { rows: byPriority }, { rows: byType }] = await Promise.all([
      c.query(`select status as key, count(*)::int as n from public.work_orders
               where deleted_at is null and status <> 'closed' group by status order by n desc`),
      c.query(`select priority as key, count(*)::int as n from public.work_orders
               where deleted_at is null and status <> 'closed' group by priority order by n desc`),
      c.query(`select type as key, count(*)::int as n from public.work_orders
               where deleted_at is null and created_at > now() - interval '365 days'
               group by type order by n desc`),
    ])
    return { by_status: byStatus, by_priority: byPriority, by_type: byType }
  })
  res.json(payload)
})

/**
 * The assets costing the most attention.
 *
 * Ranked by failure count rather than spend: a pump that fails monthly for a
 * few thousand naira a time is a worse problem than one expensive rebuild, and
 * a cost ranking hides it.
 */
analyticsRouter.get('/analytics/worst-assets', requireCap('report:read'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 8, 50)
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select a.id, a.ain, a.name, a.health_score, a.criticality,
         count(*) filter (where w.type = any($1))::int                       as failures,
         coalesce(sum(w.downtime_hours) filter (where w.type = any($1)), 0)::float as downtime_hours,
         coalesce(sum(w.cost_cents), 0)::bigint                              as cost_cents
       from public.assets a
       join public.work_orders w on w.asset_id = a.id and w.deleted_at is null
         and w.created_at > now() - interval '365 days'
       where a.deleted_at is null
       group by a.id, a.ain, a.name, a.health_score, a.criticality
       having count(*) filter (where w.type = any($1)) > 0
       order by failures desc, downtime_hours desc
       limit $2`,
      [FAILURE_TYPES, limit]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

/**
 * Every asset that can be put on the map, with what it needs to be coloured.
 *
 * Assets with no coordinates are counted but not returned — the map says how
 * many it cannot place rather than quietly showing a partial fleet.
 */
analyticsRouter.get('/analytics/asset-map', async (req, res) => {
  const payload = await withOrgContext(claimsFromReq(req), async (c) => {
    const [{ rows: placed }, { rows: missing }] = await Promise.all([
      c.query(
        `select a.id, a.ain, a.name, a.lat, a.lng, a.status, a.criticality,
           a.health_score, a.health_score_source, a.lifecycle_status,
           case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
           (select count(*)::int from public.work_orders w
             where w.asset_id = a.id and w.deleted_at is null and w.status <> 'closed') as open_work_orders,
           (select count(*)::int from public.defects d
             where d.asset_id = a.id and d.deleted_at is null
               and d.status in ('open','acknowledged','in_progress','deferred'))         as open_defects
         from public.assets a
         left join public.sites s on s.id = a.site_id
         where a.deleted_at is null and a.lat is not null and a.lng is not null
         order by a.ain`
      ),
      c.query(
        `select count(*)::int as n from public.assets
         where deleted_at is null and (lat is null or lng is null)`
      ),
    ])
    return { assets: placed, unplaced: missing[0]?.n ?? 0 }
  })
  res.json(payload)
})

/**
 * Everything with a date in a range, for the calendar: work orders by their
 * planned start or SLA, and PM tasks by their due date.
 */
analyticsRouter.get('/analytics/calendar', async (req, res) => {
  const parsed = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { from, to } = parsed.data

  const rows = await withOrgContext(claimsFromReq(req), async (c) => {
    const [{ rows: wos }, { rows: pm }, { rows: inspections }] = await Promise.all([
      // A job's date is its planned start where one was set, its SLA otherwise
      // — planning beats the deadline when both exist.
      c.query(
        `select w.id, w.ref, w.title, w.status, w.priority, w.type,
           coalesce(w.planned_start, w.sla_due::date) as on_date,
           w.planned_start is not null as is_planned,
           case when a.id is null then null else a.ain end as asset_ain
         from public.work_orders w
         left join public.assets a on a.id = w.asset_id
         where w.deleted_at is null
           and coalesce(w.planned_start, w.sla_due::date) between $1 and $2`,
        [from, to]
      ),
      c.query(
        `select t.id, t.title, t.status, t.due_date as on_date,
           case when a.id is null then null else a.ain end as asset_ain
         from public.pm_tasks t
         left join public.assets a on a.id = t.asset_id
         where t.due_date between $1 and $2`,
        [from, to]
      ),
      c.query(
        `select i.id, i.title, i.status, i.kind,
           coalesce(i.completed_date, i.scheduled_date) as on_date,
           case when a.id is null then null else a.ain end as asset_ain
         from public.inspections i
         left join public.assets a on a.id = i.asset_id
         where coalesce(i.completed_date, i.scheduled_date) between $1 and $2`,
        [from, to]
      ),
    ])

    return [
      ...wos.map((w) => ({ ...w, entity: 'work_order' as const })),
      ...pm.map((t) => ({ ...t, entity: 'pm_task' as const })),
      ...inspections.map((i) => ({ ...i, entity: 'inspection' as const })),
    ]
  })
  res.json(rows)
})
