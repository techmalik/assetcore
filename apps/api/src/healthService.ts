/**
 * The database half of health scoring: gathering an asset's signals, scoring
 * them, and handing the result to apply_asset_health() so the crossings still
 * fire. The maths itself lives in health.ts, which stays free of any database.
 *
 * This is where two implementations were reconciled, and it is worth being
 * explicit about what changed and why.
 *
 * Before, health was a linear decay: 100 at last_maintenance_at falling to 0
 * at next_maintenance_at (recompute_asset_health_for, 0016). That is a
 * service-due countdown rather than a condition score — it says nothing about
 * what an inspection found, what defects are open, or how the asset has been
 * assessed for risk. Its one real virtue was everything built on top of it:
 * apply_asset_health() raises a real inspection at the 50% crossing, drafts a
 * work order at 30%, and notifies through the preference-aware helpers.
 *
 * So the score comes from health.ts now, and the automation is untouched. The
 * decay's signal is not lost — "overdue maintenance" is one of the five
 * weighted inputs, which is what the decay was approximating all along.
 *
 * One behaviour deliberately changed. Completing maintenance used to call
 * apply_asset_health(asset, 100) — a flat reset. An asset with three open
 * critical defects does not become perfect because someone greased it, so
 * those call sites now recompute instead. The score still rises, because the
 * overdue signal clears; it rises by the amount the evidence supports.
 */
import type { PoolClient, Pool } from 'pg'
import { computeHealth, type HealthSignals, type HealthResult } from './health.js'

type Queryable = Pick<PoolClient | Pool, 'query'>

/**
 * One row per asset, carrying everything computeHealth needs.
 *
 * Useful life falls back to the asset's category default (0021), because an
 * organisation that set its category defaults once should not have to repeat
 * the figure on every pump.
 */
const SIGNALS_SQL = `
  select
    a.id,
    a.org_id,
    a.criticality,
    a.health_score,
    coalesce(a.useful_life_years, cat.useful_life_years)   as useful_life_years,
    coalesce(a.install_date, a.purchase_date)              as in_service_date,
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
          and w.status not in ('closed','draft')
          and w.sla_due is not null and w.sla_due < now())                   as overdue_work_orders
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
  /** What the asset currently carries, before this recompute is applied. */
  stored_score: number | null
}

/** Works out what the engine makes of this asset, writing nothing. */
export async function previewAssetHealth(c: Queryable, assetId: string): Promise<AssetHealth | null> {
  const { rows } = await c.query<SignalRow>(`${SIGNALS_SQL} where a.id = $1 and a.deleted_at is null`, [assetId])
  if (!rows[0]) return null
  return {
    ...computeHealth(toSignals(rows[0])),
    asset_id: rows[0].id,
    stored_score: rows[0].health_score,
  }
}

/**
 * Stores the breakdown and hands the score to apply_asset_health().
 *
 * The score goes through that function rather than straight into the column
 * because everything downstream hangs off it: the 50% crossing raises an
 * inspection, the 30% crossing drafts a work order, and both notify. Writing
 * health_score directly would set the number and silently skip all of it.
 */
async function applyScore(
  c: Queryable,
  assetId: string,
  result: HealthResult,
  actorId: string | null
): Promise<void> {
  await c.query(
    'update public.assets set health_score_components = $2::jsonb, health_score_computed_at = now() where id = $1',
    [assetId, JSON.stringify({ components: result.components, weight_applied: result.weight_applied })]
  )
  // A null score means no signal had any evidence at all. Leave the existing
  // number alone rather than crossing every threshold on the way to zero.
  if (result.score == null) return
  await c.query('select public.apply_asset_health($1, $2, $3)', [assetId, result.score, actorId])
}

/** Recomputes one asset, stores the breakdown, and lets the crossings fire. */
export async function recomputeAssetHealth(
  c: Queryable,
  assetId: string,
  actorId: string | null = null
): Promise<AssetHealth | null> {
  const preview = await previewAssetHealth(c, assetId)
  if (!preview) return null
  await applyScore(c, assetId, preview, actorId)
  return preview
}

/**
 * Nightly sweep, replacing the SQL decay loop.
 *
 * Returns how many assets were rescored. Called from jobs.ts on the owner
 * pool, which is why this takes a Queryable rather than a request client.
 */
export async function recomputeAllHealthScores(c: Queryable, orgId?: string): Promise<number> {
  const values: unknown[] = []
  let where = 'where a.deleted_at is null'
  if (orgId) {
    values.push(orgId)
    where += ` and a.org_id = $${values.length}`
  }

  const { rows } = await c.query<SignalRow>(`${SIGNALS_SQL} ${where}`, values)
  let updated = 0
  for (const row of rows) {
    await applyScore(c, row.id, computeHealth(toSignals(row)), null)
    updated++
  }
  return updated
}

/**
 * Rescores an asset after something happened to it — an inspection completed,
 * a defect raised or resolved, a job closed, maintenance done.
 *
 * Deliberately not error-swallowing: the caller passes its own transaction
 * client, and a failed query aborts that transaction anyway, so catching here
 * would only hide the cause of a rollback the caller cannot avoid. A null
 * asset id (a site-wide inspection, an unassigned job) is a no-op.
 */
export async function refreshAssetHealth(
  c: Queryable,
  assetId: string | null | undefined,
  actorId: string | null = null
): Promise<void> {
  if (!assetId) return
  await recomputeAssetHealth(c, assetId, actorId)
}
