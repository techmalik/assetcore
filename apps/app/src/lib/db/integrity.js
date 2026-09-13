import { api } from '../apiClient'

// Worst first — the order the page lists them in and the order a filter reads.
export const INTEGRITY_STATUS_META = {
  critical:   { label: 'Critical',   bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', solid: 'var(--sr)', desc: 'Extreme risk, a critical defect, or a failed inspection' },
  at_risk:    { label: 'At risk',    bg: 'oklch(94% .07 45)', c: 'oklch(42% .15 45)', br: 'oklch(85% .10 45)', solid: 'oklch(62% .19 45)', desc: 'High risk, a major defect, an overdue or poor inspection' },
  watch:      { label: 'Watch',      bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', solid: 'var(--sa)', desc: 'Medium risk, open defects, a fair rating or a stale inspection' },
  sound:      { label: 'Sound',      bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', solid: 'var(--sg)', desc: 'Inspected, assessed, and nothing open against it' },
  unassessed: { label: 'Unassessed', bg: 'var(--n100)', c: 'var(--n600)', br: 'var(--n300)', solid: 'var(--n400)', desc: 'Never inspected and no risk assessment on record' },
}

export const INTEGRITY_STATUSES = Object.keys(INTEGRITY_STATUS_META)

export async function getIntegrityOverview({ locationId } = {}) {
  return api.get(`/integrity/overview${locationId ? `?location_id=${encodeURIComponent(locationId)}` : ''}`)
}
