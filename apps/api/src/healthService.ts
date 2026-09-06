/**
 * The database half of health scoring: gathering an asset's signals and
 * writing the result back. The maths itself lives in health.ts, which stays
 * free of any database at all.
 *
 * Two callers, one code path: the routes recompute a single asset after
 * something happens to it (an inspection completed, a defect raised, a job
 * closed), and the nightly cron recomputes the lot.
 */
import type { PoolClient, Pool } from 'pg'
import { computeHealth, type HealthSignals, type HealthResult } from './health.js'

type Queryable = Pick<PoolClient | Pool, 'query'>

/**
 * One row per asset, carrying everything computeHealth needs.
 *
 * Useful life falls back to the asset's category default (0002), because an
 * organisation that set its category defaults once should not have to repeat
 * the figure on every pump.
 */
const SIGNALS_SQL = `
  select
    a.id,
    a.org_id,
    a.criticality,
    a.health_score,
    a.health_score_source,
    coalesce(a.useful_life_years, cat.useful_life_years)   as useful_life_years,
    coalesce(a.commission_date, a.purchase_date)           as in_service_date,
    insp.condition_rating,
    insp.rated_on,
    coalesce(def.counts, '{}'::jsonb)                      as open_defects,
    coalesce(od.overdue_pm, 0)                             as overdue_pm,
    coalesce(od.overdue_work_orders, 0)                    as overdue_work_orders,
    risk.worst_risk_score,
    risk.worst_risk_ref
  from public.assets a
  left join public.asset_categories cat on cat.id = a.category_id
  -- Latest completed inspection that actually recorded a rating. An inspection
  -- closed without one tells us nothing about condition, so it is skipped
  -- rather than treated as the current word on the asset.
  left join lateral (
    select i.condition_rating, coalesce(i.completed_date, i.scheduled_date) as rated_on
    from public.inspections i
    where i.asset_id = a.id and i.status = 'completed' and i.condition_rating is not null
    order by coalesce(i.completed_date, i.scheduled_date) desc, i.created_at desc
    limit 1
  ) insp on true
  -- Deferred defects still count: accepting a defect does not repair it.
  left join lateral (
    select jsonb_object_agg(d.severity, d.n) as counts
    from (
      select severity, count(*)::int as n
      from public.defects
      where asset_id = a.id and deleted_at is null
        and status in ('open','acknowledged','in_progress','deferred')
      group by severity
    ) d
  ) def on true
  left join lateral (
    select
      (select count(*)::int from public.pm_tasks t
        where t.asset_id = a.id and t.status = 'overdue')                    as overdue_pm,
      (select count(*)::int from public.work_orders w
        where w.asset_id = a.id and w.deleted_at is null
          and w.status <> 'closed' and w.sla_due is not null and w.sla_due < now()) as overdue_work_orders
  ) od on true
  -- The worst live risk against the asset, residual where it has been rated.
  -- An accepted risk still counts: accepting it does not make it smaller.
  left join lateral (
    select coalesce(r.residual_score, r.inherent_score) as worst_risk_score, r.ref as worst_risk_ref
    from public.risk_assessments r
    where r.asset_id = a.id and r.deleted_at is null
      and r.status in ('open','mitigating','accepted')
    order by coalesce(r.residual_score, r.inherent_score) desc, r.created_at desc
    limit 1
  ) risk on true
`

type SignalRow = {
  id: string
  org_id: string
  criticality: string | null
  health_score: number | null
  health_score_source: string
  useful_life_years: string | number | null
  in_service_date: string | null
  condition_rating: number | null
  rated_on: string | null
  open_defects: Record<string, number>
  overdue_pm: number
  overdue_work_orders: number
  worst_risk_score: number | null
  worst_risk_ref: string | null
}

function toSignals(row: SignalRow): HealthSignals {
  return {
    condition_rating: row.condition_rating,
    condition_rated_on: row.rated_on,
    open_defects: row.open_defects ?? {},
    overdue_pm: Number(row.overdue_pm),
    overdue_work_orders: Number(row.overdue_work_orders),
    criticality: row.criticality,
    worst_risk_score: row.worst_risk_score == null ? null : Number(row.worst_risk_score),
    worst_risk_ref: row.worst_risk_ref,
    in_service_date: row.in_service_date,
    useful_life_years: row.useful_life_years == null ? null : Number(row.useful_life_years),
  }
}

export type AssetHealth = HealthResult & {
  asset_id: string
  /** What the asset currently carries, which may be a manual override. */
  stored_score: number | null
  source: string
}

/** Works out what the engine would score this asset, writing nothing. */
export async function previewAssetHealth(c: Queryable, assetId: string): Promise<AssetHealth | null> {
  const { rows } = await c.query<SignalRow>(`${SIGNALS_SQL} where a.id = $1 and a.deleted_at is null`, [assetId])
  if (!rows[0]) return null
  return {
    ...computeHealth(toSignals(rows[0])),
    asset_id: rows[0].id,
    stored_score: rows[0].health_score,
    source: rows[0].health_score_source,
  }
}

async function writeScore(c: Queryable, assetId: string, result: HealthResult): Promise<void> {
  await c.query(
    `update public.assets
        set health_score = $2,
            health_score_components = $3::jsonb,
            health_score_computed_at = now(),
            health_score_source = 'computed'
      where id = $1`,
    [assetId, result.score, JSON.stringify({ components: result.components, weight_applied: result.weight_applied })]
  )
}

/**
 * Recomputes one asset and stores the result.
 *
 * An asset whose score is a deliberate manual override is left alone unless
 * `claim` is set — that flag is the user pressing "let AssetCore work this
 * out", and it is the only thing that takes a hand-entered number away.
 */
export async function recomputeAssetHealth(
  c: Queryable,
  assetId: string,
  { claim = false }: { claim?: boolean } = {}
): Promise<AssetHealth | null> {
  const preview = await previewAssetHealth(c, assetId)
  if (!preview) return null
  if (preview.source === 'manual' && !claim) return preview

  await writeScore(c, assetId, preview)
  return { ...preview, stored_score: preview.score, source: 'computed' }
}

/**
 * Nightly sweep. Only touches assets the engine already owns, so a manual
 * override set at 4pm is still there in the morning.
 *
 * Returns how many assets were rescored. Called from jobs.ts on the owner
 * pool, which is why this takes a Queryable rather than a request client.
 */
export async function recomputeAllHealthScores(c: Queryable, orgId?: string): Promise<number> {
  const values: unknown[] = []
  let where = `where a.deleted_at is null and a.health_score_source = 'computed'`
  if (orgId) {
    values.push(orgId)
    where += ` and a.org_id = $${values.length}`
  }

  const { rows } = await c.query<SignalRow>(`${SIGNALS_SQL} ${where}`, values)
  let updated = 0
  for (const row of rows) {
    await writeScore(c, row.id, computeHealth(toSignals(row)))
    updated++
  }
  return updated
}

/**
 * Rescores an asset after something happened to it — an inspection completed,
 * a defect raised or resolved, a job closed.
 *
 * Deliberately not error-swallowing: the caller passes its own transaction
 * client, and a failed query aborts that transaction anyway, so catching here
 * would only hide the cause of a rollback the caller cannot avoid. A null
 * asset id (a site-wide inspection, an unassigned job) is a no-op, not a
 * failure.
 */
export async function refreshAssetHealth(c: Queryable, assetId: string | null | undefined): Promise<void> {
  if (!assetId) return
  await recomputeAssetHealth(c, assetId)
}
