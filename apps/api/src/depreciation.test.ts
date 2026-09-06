import { describe, it, expect } from 'vitest'
import { buildSchedule, postedBookValue, UnsupportedMethodError, type ScheduleInput } from './depreciation.js'

/**
 * The two rules the module promises for every method:
 *   - book value never falls below salvage;
 *   - the final period absorbs all rounding drift, so closing lands exactly
 *     on salvage rather than a cent or two either side.
 *
 * Those are what these tests are for. A fixed asset register that lands a cent
 * off salvage is the kind of thing a client's auditor finds and we don't, so
 * the assertions are on exact integers throughout — no tolerances.
 */

const basis = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  method: 'straight_line',
  cost_cents: 45_000_00,
  salvage_value_cents: 5_000_00,
  useful_life_years: 10,
  start_date: '2023-04-01',
  ...over,
})

const METHODS = ['straight_line', 'declining_balance', 'sum_of_years_digits'] as const

/**
 * Two bases per method, and the second one matters more.
 *
 * A base that divides evenly into its life never produces rounding drift, so
 * it never exercises the final-period plug at all — a suite built only on
 * round numbers passes just as happily with the plug deleted. `awkward` is
 * chosen so base/life recurs (1,000,000 / 3 = 333,333.33), which is the only
 * way the promise "lands exactly on salvage" is actually put to the test.
 */
const BASES = [
  ['round', basis()],
  ['awkward', basis({ cost_cents: 10_000_00, salvage_value_cents: 0, useful_life_years: 3 })],
  ['awkward with salvage', basis({ cost_cents: 7_777_77, salvage_value_cents: 1_111_11, useful_life_years: 7 })],
] as const

describe('buildSchedule', () => {
  describe.each(
    METHODS.flatMap((method) => BASES.map(([name, b]) => [`${method} / ${name}`, { ...b, method }] as const))
  )('%s', (_name, input) => {
    const entries = buildSchedule(input)

    it('lands exactly on salvage in the final period', () => {
      expect(entries.at(-1)!.closing_cents).toBe(input.salvage_value_cents)
    })

    it('leaves no rounding drift unaccounted for', () => {
      // Every cent of the base is either charged or still in the closing
      // balance — the invariant the final-period plug exists to hold.
      const charged = entries.reduce((sum, e) => sum + e.charge_cents, 0)
      expect(input.cost_cents - charged).toBe(input.salvage_value_cents)
    })

    it('never dips below salvage in any period', () => {
      for (const e of entries) expect(e.closing_cents).toBeGreaterThanOrEqual(input.salvage_value_cents)
    })

    it('charges the depreciable base in total, no more and no less', () => {
      const charged = entries.reduce((sum, e) => sum + e.charge_cents, 0)
      expect(charged).toBe(input.cost_cents - input.salvage_value_cents)
      expect(entries.at(-1)!.accumulated_cents).toBe(charged)
    })

    it('chains opening to the previous closing', () => {
      expect(entries[0].opening_cents).toBe(input.cost_cents)
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].opening_cents).toBe(entries[i - 1].closing_cents)
      }
    })

    it('keeps every figure in whole cents', () => {
      for (const e of entries) {
        expect(Number.isInteger(e.charge_cents)).toBe(true)
        expect(Number.isInteger(e.closing_cents)).toBe(true)
        expect(Number.isInteger(e.accumulated_cents)).toBe(true)
      }
    })

    it('never charges a negative amount', () => {
      for (const e of entries) expect(e.charge_cents).toBeGreaterThanOrEqual(0)
    })
  })

  it('runs one period per year of life, numbered from the start date', () => {
    const entries = buildSchedule(basis({ useful_life_years: 10, start_date: '2023-04-01' }))
    expect(entries).toHaveLength(10)
    expect(entries[0].period_year).toBe(2023)
    expect(entries.at(-1)!.period_year).toBe(2032)
  })

  it('rounds a part-year life up to a whole final period', () => {
    // 7.5 years cannot be eight equal charges; the eighth exists to absorb
    // what is left, which is what keeps the total exact.
    const entries = buildSchedule(basis({ useful_life_years: 7.5 }))
    expect(entries).toHaveLength(8)
    expect(entries.at(-1)!.closing_cents).toBe(5_000_00)
  })

  it('charges straight line evenly until the plug', () => {
    const entries = buildSchedule(basis({ cost_cents: 10_000_00, salvage_value_cents: 0, useful_life_years: 4 }))
    expect(entries.map((e) => e.charge_cents)).toEqual([250_000, 250_000, 250_000, 250_000])
  })

  it('front-loads declining balance and still terminates on salvage', () => {
    const entries = buildSchedule(basis({ method: 'declining_balance', declining_factor: 2 }))
    // Declining balance never reaches salvage on its own — the final-period
    // plug is what makes it terminate, and it must not go backwards.
    expect(entries[0].charge_cents).toBeGreaterThan(entries[1].charge_cents)
    expect(entries.at(-1)!.closing_cents).toBe(5_000_00)
  })

  it('front-loads sum-of-years by a falling fraction of the base', () => {
    const entries = buildSchedule(basis({
      method: 'sum_of_years_digits', cost_cents: 15_000_00, salvage_value_cents: 0, useful_life_years: 5,
    }))
    // 5+4+3+2+1 = 15, so the first year takes 5/15 of 1,500,000 cents.
    expect(entries[0].charge_cents).toBe(500_000)
    expect(entries.at(-1)!.closing_cents).toBe(0)
  })

  it('refuses units of production, and says why', () => {
    expect(() => buildSchedule(basis({ method: 'units_of_production' }))).toThrow(UnsupportedMethodError)
    // The reason matters: the route turns it into a 422 the user reads.
    expect(() => buildSchedule(basis({ method: 'units_of_production' })))
      .toThrow(/meter readings/)
  })

  it('returns nothing when there is nothing to depreciate', () => {
    // Salvage at or above cost, and a zero life, are both "no schedule" rather
    // than a schedule of zeroes that looks like it did something.
    expect(buildSchedule(basis({ salvage_value_cents: 45_000_00 }))).toEqual([])
    expect(buildSchedule(basis({ salvage_value_cents: 50_000_00 }))).toEqual([])
    expect(buildSchedule(basis({ useful_life_years: 0 }))).toEqual([])
  })

  it('handles a salvage value larger than one period of charge', () => {
    // Regression guard: a big salvage on a short life is where a naive
    // implementation overshoots and then corrects with a negative charge.
    const entries = buildSchedule(basis({
      method: 'declining_balance', cost_cents: 10_000_00, salvage_value_cents: 9_000_00, useful_life_years: 3,
    }))
    expect(entries.at(-1)!.closing_cents).toBe(9_000_00)
    for (const e of entries) expect(e.charge_cents).toBeGreaterThanOrEqual(0)
  })
})

describe('postedBookValue', () => {
  const entries = [
    { period_year: 2023, closing_cents: 40_000_00, posted: true },
    { period_year: 2024, closing_cents: 36_000_00, posted: true },
    { period_year: 2025, closing_cents: 32_000_00, posted: false },
  ]

  it('takes the newest posted period, not the newest period', () => {
    expect(postedBookValue(entries)).toBe(36_000_00)
  })

  it('is null when nothing has been posted', () => {
    // Null means "the schedule does not own this asset's NBV yet", which is
    // what keeps a manually entered figure in place.
    expect(postedBookValue(entries.map((e) => ({ ...e, posted: false })))).toBeNull()
    expect(postedBookValue([])).toBeNull()
  })

  it('does not assume the entries arrive in order', () => {
    expect(postedBookValue([...entries].reverse())).toBe(36_000_00)
  })
})
