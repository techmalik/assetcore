/**
 * Depreciation maths. Pure functions over integer cents — no database, no
 * request context — so the numbers can be reasoned about and tested on their own.
 *
 * Periods are ANNUAL. A fixed asset register is reported by year, and keeping
 * one period per year makes every figure checkable by hand against the client's
 * existing spreadsheet, which is what wins the first review.
 */

export const DEPRECIATION_METHODS = [
  'straight_line',
  'declining_balance',
  'sum_of_years_digits',
  'units_of_production',
] as const

export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number]

export type ScheduleInput = {
  method: DepreciationMethod
  cost_cents: number
  salvage_value_cents: number
  useful_life_years: number
  start_date: string // YYYY-MM-DD
  declining_factor?: number
}

export type PeriodEntry = {
  period_year: number
  opening_cents: number
  charge_cents: number
  closing_cents: number
  accumulated_cents: number
}

export class UnsupportedMethodError extends Error {
  constructor(method: string) {
    super(`${method} needs meter readings AssetCore does not collect yet`)
    this.name = 'UnsupportedMethodError'
  }
}

/**
 * Expands a schedule into one entry per year.
 *
 * Two rules hold for every method:
 *   - book value never falls below salvage;
 *   - the final period absorbs all rounding drift, so closing lands exactly on
 *     salvage rather than a cent or two either side.
 *
 * Declining balance never reaches salvage on its own, so that second rule is
 * also what makes it terminate — the conventional final-year plug.
 */
export function buildSchedule(input: ScheduleInput): PeriodEntry[] {
  const { method, cost_cents, salvage_value_cents, useful_life_years, start_date } = input

  if (method === 'units_of_production') throw new UnsupportedMethodError(method)

  const base = cost_cents - salvage_value_cents
  if (base <= 0 || useful_life_years <= 0) return []

  const periods = Math.ceil(useful_life_years)
  const startYear = Number(start_date.slice(0, 4))
  const factor = input.declining_factor ?? 2
  // Sum of the years' digits: 5-year life → 5+4+3+2+1 = 15.
  const syd = (periods * (periods + 1)) / 2

  const entries: PeriodEntry[] = []
  let opening = cost_cents
  let accumulated = 0

  for (let i = 0; i < periods; i++) {
    let charge: number
    switch (method) {
      case 'straight_line':
        charge = base / useful_life_years
        break
      case 'declining_balance':
        charge = opening * (factor / useful_life_years)
        break
      case 'sum_of_years_digits':
        charge = (base * (periods - i)) / syd
        break
      default:
        throw new UnsupportedMethodError(method)
    }

    charge = Math.round(charge)

    const headroom = opening - salvage_value_cents
    if (charge > headroom) charge = headroom
    if (i === periods - 1) charge = headroom // final period lands exactly on salvage
    if (charge < 0) charge = 0

    const closing = opening - charge
    accumulated += charge
    entries.push({
      period_year: startYear + i,
      opening_cents: opening,
      charge_cents: charge,
      closing_cents: closing,
      accumulated_cents: accumulated,
    })
    opening = closing
  }

  return entries
}

/** Net book value implied by the entries posted so far, newest posted period wins. */
export function postedBookValue(entries: Array<Pick<PeriodEntry, 'period_year' | 'closing_cents'> & { posted: boolean }>): number | null {
  const posted = entries.filter((e) => e.posted).sort((a, b) => b.period_year - a.period_year)
  return posted.length ? posted[0].closing_cents : null
}
