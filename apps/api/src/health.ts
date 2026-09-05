/**
 * Asset health scoring. Pure functions over a bag of signals — no database, no
 * request context — so a score can be reasoned about, tested, and above all
 * explained back to the person looking at it.
 *
 * Until now `assets.health_score` was a 0-100 integer somebody typed into a
 * form, and the UI said so. This is what replaces it: five weighted signals,
 * each with its own sub-score and a sentence saying where it came from.
 *
 * Weights (100 total):
 *   inspection   25   the last recorded condition rating
 *   defects      25   open defects, weighted by severity
 *   maintenance  20   overdue PM tasks and work orders past SLA
 *   risk         15   consequence of failure (asset criticality)
 *   age          15   elapsed life against useful life
 *
 * A signal with no evidence behind it is not scored zero — it is left out and
 * the remaining weights are renormalised. An asset that has never been
 * inspected is not thereby in poor condition; we simply do not know, and
 * saying so is the whole point of the exercise.
 */

export const HEALTH_WEIGHTS = {
  inspection: 25,
  defects: 25,
  maintenance: 20,
  risk: 15,
  age: 15,
} as const

export type HealthComponentKey = keyof typeof HEALTH_WEIGHTS

/** Points knocked off the defect sub-score per open defect, by severity. Four
 * critical defects, or ten major ones, take that signal to zero. */
export const DEFECT_PENALTY: Record<string, number> = {
  minor: 4,
  moderate: 10,
  major: 20,
  critical: 40,
}

/** Consequence of failure, read from the asset's criticality. Phase 4's 5x5
 * risk matrix will supersede this input; the component itself stays. */
const RISK_SCORE: Record<string, number> = {
  low: 100,
  medium: 80,
  high: 50,
  critical: 25,
}

/** Points per overdue item, PM tasks and past-SLA work orders alike. */
const OVERDUE_PENALTY = 20

export type HealthSignals = {
  /** 1-5 from the most recent completed inspection, or null if never rated. */
  condition_rating: number | null
  /** When that rating was given (YYYY-MM-DD), for the explanation line. */
  condition_rated_on: string | null
  /** Open defects on the asset, counted by severity. */
  open_defects: Record<string, number>
  overdue_pm: number
  overdue_work_orders: number
  criticality: string | null
  /** Commission date, else purchase date (YYYY-MM-DD). */
  in_service_date: string | null
  /** From the asset, else its category default. */
  useful_life_years: number | null
  /** Defaults to today; injectable so tests don't drift. */
  as_of?: string
}

export type HealthComponent = {
  key: HealthComponentKey
  label: string
  weight: number
  /** 0-100, or null when there is no evidence for this signal. */
  score: number | null
  /** Weighted contribution to the total, or null when unscored. */
  points: number | null
  /** One sentence: what this score was read from. */
  detail: string
}

export type HealthResult = {
  /** 0-100, or null when no signal had any evidence at all. */
  score: number | null
  components: HealthComponent[]
  /** Sum of the weights that actually counted, out of 100. */
  weight_applied: number
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Whole years between two YYYY-MM-DD dates, to one decimal. */
function yearsBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return (b - a) / (365.25 * 24 * 60 * 60 * 1000)
}

function inspectionComponent(s: HealthSignals): HealthComponent {
  const base = { key: 'inspection' as const, label: 'Inspection condition', weight: HEALTH_WEIGHTS.inspection }
  if (s.condition_rating == null) {
    return { ...base, score: null, points: null, detail: 'No completed inspection has recorded a condition rating.' }
  }
  // 1 = failed, 5 = as-new, so the range maps onto 0-100 rather than 20-100.
  const score = clamp(((s.condition_rating - 1) / 4) * 100)
  const when = s.condition_rated_on ? ` on ${fmtDate(s.condition_rated_on)}` : ''
  return { ...base, score, points: (score * base.weight) / 100, detail: `Rated ${s.condition_rating} of 5${when}.` }
}

function defectComponent(s: HealthSignals): HealthComponent {
  const base = { key: 'defects' as const, label: 'Open defects', weight: HEALTH_WEIGHTS.defects }
  const entries = Object.entries(s.open_defects).filter(([, n]) => n > 0)
  const total = entries.reduce((sum, [, n]) => sum + n, 0)

  // No open defects is evidence, not a gap: this signal always scores.
  if (total === 0) return { ...base, score: 100, points: base.weight, detail: 'No open defects.' }

  const penalty = entries.reduce((sum, [severity, n]) => sum + (DEFECT_PENALTY[severity] ?? 0) * n, 0)
  const score = clamp(100 - penalty)
  const breakdown = entries.map(([severity, n]) => `${n} ${severity}`).join(', ')
  return { ...base, score, points: (score * base.weight) / 100, detail: `${plural(total, 'open defect')} (${breakdown}).` }
}

function maintenanceComponent(s: HealthSignals): HealthComponent {
  const base = { key: 'maintenance' as const, label: 'Overdue maintenance', weight: HEALTH_WEIGHTS.maintenance }
  const overdue = s.overdue_pm + s.overdue_work_orders
  if (overdue === 0) return { ...base, score: 100, points: base.weight, detail: 'Nothing overdue.' }

  const score = clamp(100 - OVERDUE_PENALTY * overdue)
  const parts = [
    s.overdue_pm > 0 ? plural(s.overdue_pm, 'overdue PM task') : null,
    s.overdue_work_orders > 0 ? `${plural(s.overdue_work_orders, 'work order')} past SLA` : null,
  ].filter(Boolean)
  return { ...base, score, points: (score * base.weight) / 100, detail: `${parts.join(', ')}.` }
}

function riskComponent(s: HealthSignals): HealthComponent {
  const base = { key: 'risk' as const, label: 'Risk level', weight: HEALTH_WEIGHTS.risk }
  const score = s.criticality ? RISK_SCORE[s.criticality] : undefined
  if (score == null) {
    return { ...base, score: null, points: null, detail: 'No criticality recorded for this asset.' }
  }
  return {
    ...base,
    score,
    points: (score * base.weight) / 100,
    detail: `Criticality is ${s.criticality} — the consequence if this asset fails.`,
  }
}

function ageComponent(s: HealthSignals): HealthComponent {
  const base = { key: 'age' as const, label: 'Age against useful life', weight: HEALTH_WEIGHTS.age }
  const life = s.useful_life_years
  if (!s.in_service_date || life == null || life <= 0) {
    const missing = !s.in_service_date ? 'a commission or purchase date' : 'a useful life'
    return { ...base, score: null, points: null, detail: `Needs ${missing} on the asset or its category.` }
  }
  const elapsed = yearsBetween(s.in_service_date, s.as_of ?? new Date().toISOString().slice(0, 10))
  if (elapsed == null) return { ...base, score: null, points: null, detail: 'In-service date could not be read.' }

  // Straight-line: brand new scores 100, fully consumed scores 0, and an asset
  // run past its useful life stays at 0 rather than going negative.
  const score = clamp(Math.round(100 * (1 - elapsed / life)))
  const used = Math.max(0, elapsed)
  return {
    ...base,
    score,
    points: (score * base.weight) / 100,
    detail: `${used.toFixed(1)} of ${life} years of useful life used.`,
  }
}

/**
 * Scores an asset from its signals.
 *
 * The total is the weighted mean over the components that had evidence, so a
 * sparsely-populated asset gets a fair score out of the signals it does have
 * rather than being punished for the ones it doesn't. `weight_applied` says
 * how much of the 100 was actually available, which is what lets the UI show
 * "based on 4 of the 5 signals" instead of implying a fuller picture than
 * exists.
 */
export function computeHealth(signals: HealthSignals): HealthResult {
  const components = [
    inspectionComponent(signals),
    defectComponent(signals),
    maintenanceComponent(signals),
    riskComponent(signals),
    ageComponent(signals),
  ]

  const scored = components.filter((c) => c.score != null)
  const weightApplied = scored.reduce((sum, c) => sum + c.weight, 0)
  const score = weightApplied === 0
    ? null
    : Math.round(scored.reduce((sum, c) => sum + (c.points as number), 0) * (100 / weightApplied))

  return { score, components, weight_applied: weightApplied }
}
