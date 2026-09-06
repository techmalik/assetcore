import { api } from '../apiClient'

export const RISK_CATEGORIES = [
  ['safety', 'Safety'],
  ['environmental', 'Environmental'],
  ['operational', 'Operational'],
  ['financial', 'Financial'],
  ['compliance', 'Compliance'],
  ['security', 'Security'],
]

export const RISK_STATUSES = [
  ['open', 'Open'],
  ['mitigating', 'Mitigating'],
  ['accepted', 'Accepted'],
  ['closed', 'Closed'],
]

export const STATUS_LABEL = Object.fromEntries(RISK_STATUSES)
export const CATEGORY_LABEL = Object.fromEntries(RISK_CATEGORIES)

// The words on the 1-5 axes. A bare number is not a scale anybody can apply
// consistently; these are what make two assessors agree.
export const LIKELIHOOD_SCALE = [
  [1, 'Rare', 'Not expected in the asset’s life'],
  [2, 'Unlikely', 'Could happen, but has not'],
  [3, 'Possible', 'Has happened in the industry'],
  [4, 'Likely', 'Has happened here before'],
  [5, 'Almost certain', 'Expected within the year'],
]

export const CONSEQUENCE_SCALE = [
  [1, 'Negligible', 'No injury, no outage'],
  [2, 'Minor', 'First aid, brief interruption'],
  [3, 'Moderate', 'Lost-time injury or a day down'],
  [4, 'Major', 'Serious injury, extended outage'],
  [5, 'Catastrophic', 'Fatality, or loss of the facility'],
]

// Mirrors risk_band() in 0005 — the boundaries live in the database, and this
// is the copy the colouring reads. Keep the two in step.
export const BAND_META = {
  low: { label: 'Low', bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', solid: 'var(--sg)' },
  medium: { label: 'Medium', bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', solid: 'var(--sa)' },
  high: { label: 'High', bg: 'oklch(94% .07 45)', c: 'oklch(42% .15 45)', br: 'oklch(85% .10 45)', solid: 'oklch(62% .19 45)' },
  extreme: { label: 'Extreme', bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', solid: 'var(--sr)' },
}

export function bandOf(score) {
  if (score == null) return null
  if (score >= 16) return 'extreme'
  if (score >= 11) return 'high'
  if (score >= 6) return 'medium'
  return 'low'
}

export async function listRisks(filters = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '' && v !== 'all' && v !== false) params.set(k, v)
  }
  const qs = params.toString()
  return api.get(`/risks${qs ? `?${qs}` : ''}`)
}

// basis: 'current' (residual where rated) or 'inherent' (before controls).
export async function getRiskMatrix(basis = 'current') {
  return api.get(`/risks/matrix?basis=${basis}`)
}

export async function getRiskStats() {
  return api.get('/risks/stats')
}

export async function getRisk(id) {
  return api.get(`/risks/${id}`)
}

export async function createRisk(input) {
  return api.post('/risks', input)
}

export async function updateRisk(id, patch) {
  return api.patch(`/risks/${id}`, patch)
}

export async function archiveRisk(id) {
  await api.del(`/risks/${id}`)
}
