import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { ownerClient, ORG_A, SITE_A1 } from './fixtures.js'
import { buildSchedule } from '../src/depreciation.js'

// Book value is computed by two engines: buildSchedule (depreciation.ts) for
// a schedule's annual table, and recompute_asset_depreciation_for() (SQL) for
// the register's nbv_cents every night. They are built differently: the SQL
// counts whole months from the start date to today, the schedule charges one
// full period per year. They should still land on the same figure whenever
// a whole number of years has passed, so each case starts exactly N years
// before today and compares the SQL value with the schedule's closing value
// after N periods.

let db: pg.Client

beforeAll(async () => {
  db = ownerClient()
  await db.connect()
})

afterAll(async () => {
  await db.end()
})

/** Today's date N years ago, in the instance's timezone, as YYYY-MM-DD. */
function yearsAgo(n: number) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
  const [y, m, d] = today.split('-').map(Number)
  // 29 February has no anniversary in most years; the 28th keeps it whole.
  const day = m === 2 && d === 29 ? 28 : d
  return `${y - n}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function sqlBookValue(asset: {
  method: string; cost: number; salvage: number; life: number; rate?: number; start: string
}) {
  const id = randomUUID()
  await db.query(
    `insert into public.assets
       (id, org_id, site_id, ain, name, status, purchase_value_cents, install_date,
        depreciation_method, useful_life_years, salvage_value_cents, declining_rate_pct)
     values ($1, $2, $3, $4, 'Depreciation parity', 'operational', $5, $6, $7, $8, $9, $10)`,
    [id, ORG_A, SITE_A1, `PARITY-${id.slice(0, 8)}`, asset.cost, asset.start, asset.method,
     asset.life, asset.salvage, asset.rate ?? null]
  )
  await db.query('select public.recompute_asset_depreciation_for($1)', [id])
  const { rows } = await db.query('select nbv_cents from public.assets where id = $1', [id])
  await db.query('delete from public.assets where id = $1', [id])
  return Number(rows[0].nbv_cents)
}

const cases = [
  // 180,000 a year for five years.
  { method: 'straight_line', cost: 1_000_000, salvage: 100_000, life: 5, years: 2 },
  { method: 'straight_line', cost: 1_000_000, salvage: 100_000, life: 5, years: 4 },
  // Weights 5,4,3,2,1 over 15 on a 900,000 base.
  { method: 'sum_of_years_digits', cost: 1_000_000, salvage: 100_000, life: 5, years: 1 },
  { method: 'sum_of_years_digits', cost: 1_000_000, salvage: 100_000, life: 5, years: 3 },
  // 20% a year: the SQL's rate, the schedule's factor of 1 over a 5-year life.
  { method: 'declining_balance', cost: 1_000_000, salvage: 100_000, life: 5, rate: 20, years: 1 },
  { method: 'declining_balance', cost: 1_000_000, salvage: 100_000, life: 5, rate: 20, years: 3 },
] as const

describe('the schedule and the nightly register agree on book value', () => {
  for (const c of cases) {
    it(`${c.method}, ${c.years} year${c.years === 1 ? '' : 's'} in`, async () => {
      const start = yearsAgo(c.years)
      const schedule = buildSchedule({
        method: c.method,
        cost_cents: c.cost,
        salvage_value_cents: c.salvage,
        useful_life_years: c.life,
        start_date: start,
        declining_factor: 'rate' in c ? (c.rate / 100) * c.life : undefined,
      })
      const scheduled = schedule[c.years - 1].closing_cents
      const register = await sqlBookValue({ ...c, start })
      expect(Math.abs(register - scheduled), `register ${register}, schedule ${scheduled}`).toBeLessThanOrEqual(1)
    })
  }
})
