import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSchedule, UnsupportedMethodError, DEPRECIATION_METHODS } from '../depreciation.js'

export const depreciationRouter = Router()
depreciationRouter.use(requireAuth, requireOrg, requireActiveMembership)

const SELECT = `
  select d.*,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name, 'nbv_cents', a.nbv_cents) end as asset,
    (select count(*)::int from public.depreciation_entries e where e.schedule_id = d.id) as entry_count,
    (select count(*)::int from public.depreciation_entries e where e.schedule_id = d.id and e.posted) as posted_count
  from public.depreciation_schedules d
  left join public.assets a on a.id = d.asset_id
`

const scheduleInput = z.object({
  asset_id: z.string().uuid(),
  // Everything below is optional: omitted values fall back to what the asset
  // already carries from Phase 1, which is the point of having captured them.
  method: z.enum(DEPRECIATION_METHODS).optional(),
  cost_cents: z.number().int().nonnegative().optional(),
  salvage_value_cents: z.number().int().nonnegative().optional(),
  useful_life_years: z.number().positive().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  declining_factor: z.number().min(1).max(3).optional(),
})

type Resolved = {
  method: (typeof DEPRECIATION_METHODS)[number]
  cost_cents: number
  salvage_value_cents: number
  useful_life_years: number
  start_date: string
  declining_factor: number
}

/** Fills the gaps in a request from the asset's own record. Returns the reason
 * it can't be done rather than throwing, so the caller can say which field is
 * missing instead of a generic 400. */
function resolveBasis(
  input: z.infer<typeof scheduleInput>,
  asset: {
    purchase_value_cents: string | number | null
    salvage_value_cents: string | number | null
    useful_life_years: string | number | null
    depreciation_method: string | null
    install_date: string | null
    purchase_date: string | null
  }
): Resolved | { missing: string } {
  const cost = input.cost_cents ?? (asset.purchase_value_cents == null ? null : Number(asset.purchase_value_cents))
  if (cost == null) return { missing: 'purchase value' }

  const life = input.useful_life_years ?? (asset.useful_life_years == null ? null : Number(asset.useful_life_years))
  if (life == null || life <= 0) return { missing: 'useful life in years' }

  const start = input.start_date ?? asset.install_date ?? asset.purchase_date
  if (!start) return { missing: 'an install or purchase date' }

  const method = input.method ?? (asset.depreciation_method as Resolved['method'] | null) ?? 'straight_line'

  return {
    method,
    cost_cents: cost,
    salvage_value_cents: input.salvage_value_cents ?? (asset.salvage_value_cents == null ? 0 : Number(asset.salvage_value_cents)),
    useful_life_years: life,
    start_date: start,
    declining_factor: input.declining_factor ?? 2,
  }
}

// install_date, not commission_date: migration 0021 records that the two
// branches named the same field differently and that install_date won. This
// list still asked for the losing name, so every basis lookup threw
// "column commission_date does not exist" and the preview 500'd.
const ASSET_BASIS_COLUMNS = `purchase_value_cents, salvage_value_cents, useful_life_years,
  depreciation_method, install_date, purchase_date`

depreciationRouter.get('/depreciation/schedules', requireCap('depreciation:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, req.query.include_superseded === 'true' ? 'where true' : 'where d.active']
    clauses.push('order by d.created_at desc')
    return c.query(clauses.join(' ')).then((r) => r.rows)
  })
  res.json(rows)
})

depreciationRouter.get('/depreciation/stats', requireCap('depreciation:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select
         (select count(*)::int from public.depreciation_schedules where active) as schedules,
         (select count(*)::int from public.assets
            where deleted_at is null and purchase_value_cents is not null
              and not exists (select 1 from public.depreciation_schedules d where d.asset_id = assets.id and d.active)
         ) as assets_without_schedule,
         (select coalesce(sum(cost_cents), 0)::bigint from public.depreciation_schedules where active) as gross_cost_cents,
         (select coalesce(sum(charge_cents), 0)::bigint from public.depreciation_entries
            where posted and period_year = extract(year from current_date)::int) as charge_this_year_cents,
         (select coalesce(sum(charge_cents), 0)::bigint from public.depreciation_entries where posted) as accumulated_cents,
         (select count(*)::int from public.depreciation_entries
            where not posted and period_year <= extract(year from current_date)::int) as unposted_due`
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

/** Yearly totals across every active schedule — the register's headline table. */
depreciationRouter.get('/depreciation/forecast', requireCap('depreciation:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select e.period_year,
              sum(e.charge_cents)::bigint       as charge_cents,
              sum(e.closing_cents)::bigint      as closing_cents,
              sum(e.accumulated_cents)::bigint  as accumulated_cents,
              count(*)::int                     as asset_count,
              count(*) filter (where e.posted)::int as posted_count
       from public.depreciation_entries e
       join public.depreciation_schedules d on d.id = e.schedule_id and d.active
       group by e.period_year order by e.period_year`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

depreciationRouter.get('/depreciation/assets/:assetId', requireCap('depreciation:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${SELECT} where d.asset_id = $1 and d.active`, [req.params.assetId])
    if (!rows[0]) return null
    const { rows: entries } = await c.query(
      'select * from public.depreciation_entries where schedule_id = $1 order by period_year',
      [rows[0].id]
    )
    return { ...rows[0], entries }
  })
  if (!row) return res.status(404).json({ error: 'no_schedule' })
  res.json(row)
})

/** Runs the maths and returns the table without writing anything, so the form
 * can show the client their own numbers before they commit to them. */
depreciationRouter.post('/depreciation/preview', requireCap('depreciation:read'), async (req, res) => {
  const parsed = scheduleInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `select ${ASSET_BASIS_COLUMNS} from public.assets where id = $1 and deleted_at is null`,
      [parsed.data.asset_id]
    )
    if (!rows[0]) return { error: 'not_found' as const }
    const basis = resolveBasis(parsed.data, rows[0])
    if ('missing' in basis) return { error: 'incomplete_basis' as const, missing: basis.missing }
    try {
      return { data: { basis, entries: buildSchedule(basis) } }
    } catch (err) {
      if (err instanceof UnsupportedMethodError) return { error: 'unsupported_method' as const, message: err.message }
      throw err
    }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'unsupported_method') return res.status(422).json({ error: 'unsupported_method', message: result.message })
    return res.status(422).json({ error: 'incomplete_basis', missing: result.missing })
  }
  res.json(result.data)
})

depreciationRouter.post('/depreciation/schedules', requireCap('depreciation:manage'), async (req, res) => {
  const parsed = scheduleInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: assetRows } = await c.query(
      `select id, org_id, ${ASSET_BASIS_COLUMNS} from public.assets where id = $1 and deleted_at is null`,
      [parsed.data.asset_id]
    )
    if (!assetRows[0]) return { error: 'not_found' as const }

    const basis = resolveBasis(parsed.data, assetRows[0])
    if ('missing' in basis) return { error: 'incomplete_basis' as const, missing: basis.missing }

    let entries
    try {
      entries = buildSchedule(basis)
    } catch (err) {
      if (err instanceof UnsupportedMethodError) return { error: 'unsupported_method' as const, message: err.message }
      throw err
    }
    if (entries.length === 0) return { error: 'nothing_to_depreciate' as const }

    // Replacing a schedule supersedes the old one rather than deleting it —
    // posted history has to stay auditable.
    await c.query(
      'update public.depreciation_schedules set active = false where asset_id = $1 and active',
      [parsed.data.asset_id]
    )

    const { rows } = await c.query(
      `insert into public.depreciation_schedules
         (org_id, asset_id, method, cost_cents, salvage_value_cents, useful_life_years, start_date, declining_factor, created_by)
       values (current_org_id(), $1, $2, $3, $4, $5, $6, $7, current_user_id())
       returning id, org_id`,
      [parsed.data.asset_id, basis.method, basis.cost_cents, basis.salvage_value_cents,
       basis.useful_life_years, basis.start_date, basis.declining_factor]
    )
    const schedule = rows[0]

    for (const e of entries) {
      await c.query(
        `insert into public.depreciation_entries
           (org_id, schedule_id, asset_id, period_year, opening_cents, charge_cents, closing_cents, accumulated_cents)
         values (current_org_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [schedule.id, parsed.data.asset_id, e.period_year, e.opening_cents, e.charge_cents, e.closing_cents, e.accumulated_cents]
      )
    }

    await writeAuditLog(c, {
      orgId: schedule.org_id, actorId: req.claims!.sub, action: 'depreciation.schedule.create',
      entityType: 'depreciation_schedule', entityId: schedule.id,
      after: { ...basis, periods: entries.length },
    })

    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [schedule.id])
    const { rows: saved } = await c.query(
      'select * from public.depreciation_entries where schedule_id = $1 order by period_year',
      [schedule.id]
    )
    return { data: { ...full[0], entries: saved } }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'unsupported_method') return res.status(422).json({ error: 'unsupported_method', message: result.message })
    if (result.error === 'nothing_to_depreciate') return res.status(422).json({ error: 'nothing_to_depreciate' })
    return res.status(422).json({ error: 'incomplete_basis', missing: result.missing })
  }
  res.status(201).json(result.data)
})

/** Posting is what makes an entry real: it fixes the charge for the period and
 * hands net book value over to the schedule, so the asset stops carrying a
 * hand-typed NBV. */
async function postThrough(
  c: import('pg').PoolClient,
  scheduleId: string,
  throughYear: number,
  actorId: string | null
): Promise<{ posted: number; nbv: number | null; assetId: string } | null> {
  const { rows: sched } = await c.query(
    'select id, org_id, asset_id from public.depreciation_schedules where id = $1 and active',
    [scheduleId]
  )
  if (!sched[0]) return null

  const { rows: posted } = await c.query(
    `update public.depreciation_entries
        set posted = true, posted_at = now(), posted_by = $3
      where schedule_id = $1 and period_year <= $2 and not posted
      returning period_year, closing_cents`,
    [scheduleId, throughYear, actorId]
  )

  // Newest posted period owns the book value — not just the ones posted now,
  // since an earlier call may already have gone further.
  const { rows: latest } = await c.query(
    `select closing_cents from public.depreciation_entries
      where schedule_id = $1 and posted order by period_year desc limit 1`,
    [scheduleId]
  )
  const nbv = latest[0] ? Number(latest[0].closing_cents) : null
  if (nbv != null) {
    await c.query(
      "update public.assets set nbv_cents = $2, nbv_source = 'schedule' where id = $1",
      [sched[0].asset_id, nbv]
    )
  }
  return { posted: posted.length, nbv, assetId: sched[0].asset_id }
}

depreciationRouter.post('/depreciation/schedules/:id/post', requireCap('depreciation:manage'), async (req, res) => {
  const parsed = z.object({ through_year: z.number().int().min(1900).max(2200).optional() }).safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const throughYear = parsed.data.through_year ?? new Date().getFullYear()
  const scheduleId = String(req.params.id)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const outcome = await postThrough(c, scheduleId, throughYear, req.claims!.sub)
    if (!outcome) return null
    await writeAuditLog(c, {
      orgId: req.claims!.org_id!, actorId: req.claims!.sub, action: 'depreciation.post',
      entityType: 'depreciation_schedule', entityId: scheduleId,
      after: { through_year: throughYear, entries_posted: outcome.posted, nbv_cents: outcome.nbv },
    })
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [req.params.id])
    const { rows: entries } = await c.query(
      'select * from public.depreciation_entries where schedule_id = $1 order by period_year',
      [req.params.id]
    )
    return { ...full[0], entries, entries_posted: outcome.posted }
  })
  if (!result) return res.status(404).json({ error: 'not_found' })
  res.json(result)
})

/** Runs the year end across every active schedule at once. */
depreciationRouter.post('/depreciation/post-all', requireCap('depreciation:manage'), async (req, res) => {
  const parsed = z.object({ through_year: z.number().int().min(1900).max(2200).optional() }).safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const throughYear = parsed.data.through_year ?? new Date().getFullYear()

  const summary = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: schedules } = await c.query('select id from public.depreciation_schedules where active')
    let entriesPosted = 0
    for (const s of schedules) {
      const outcome = await postThrough(c, s.id, throughYear, req.claims!.sub)
      entriesPosted += outcome?.posted ?? 0
    }
    await writeAuditLog(c, {
      orgId: req.claims!.org_id!, actorId: req.claims!.sub, action: 'depreciation.post_all',
      entityType: 'depreciation_schedule',
      after: { through_year: throughYear, schedules: schedules.length, entries_posted: entriesPosted },
    })
    return { schedules: schedules.length, entries_posted: entriesPosted, through_year: throughYear }
  })
  res.json(summary)
})

depreciationRouter.delete('/depreciation/schedules/:id', requireCap('depreciation:manage'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.depreciation_schedules set active = false where id = $1 and active returning id, org_id, asset_id',
      [req.params.id]
    )
    if (!rows[0]) return null
    // Hand net book value back to manual entry — nothing owns it now.
    await c.query("update public.assets set nbv_source = 'manual' where id = $1", [rows[0].asset_id])
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'depreciation.schedule.retire',
      entityType: 'depreciation_schedule', entityId: rows[0].id,
    })
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
