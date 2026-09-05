import { api } from '../apiClient'

// [{item, result, notes}] — the shape checklist_results settled on in 0004,
// shared with PM tasks so a checklist reads the same wherever it appears.
export const CHECKLIST_RESULTS = [
  ['pass', 'Pass'],
  ['fail', 'Fail'],
  ['na', 'N/A'],
  ['pending', 'Not checked'],
]

// 1-5, the outcome an inspection owes the health score. Wording matters here:
// these are read back to whoever has to defend the number later.
export const CONDITION_RATINGS = [
  [5, 'As new', 'No defects, everything within spec'],
  [4, 'Good', 'Minor wear, fully serviceable'],
  [3, 'Fair', 'Visible wear, monitor it'],
  [2, 'Poor', 'Degraded, needs work'],
  [1, 'Failed', 'Unsafe or out of service'],
]

export const RATING_LABEL = Object.fromEntries(CONDITION_RATINGS.map(([v, l]) => [v, l]))

export async function listInspections({ statuses, limit = 100, asset_id } = {}) {
  const params = new URLSearchParams()
  if (statuses?.length) params.set('statuses', statuses.join(','))
  if (asset_id) params.set('asset_id', asset_id)
  params.set('limit', limit)
  return api.get(`/inspections?${params.toString()}`)
}

export async function getInspection(id) {
  return api.get(`/inspections/${id}`)
}

// ── Templates ────────────────────────────────────────────────────────────────
// The checklist definition behind an inspection. Picked when the inspection is
// raised and copied onto it, so editing a template later doesn't rewrite an
// inspection that has already been carried out.
export async function listInspectionTemplates({ include_inactive = false } = {}) {
  return api.get(`/inspection-templates${include_inactive ? '?include_inactive=true' : ''}`)
}

export async function createInspectionTemplate(input) {
  return api.post('/inspection-templates', input)
}

export async function updateInspectionTemplate(id, patch) {
  return api.patch(`/inspection-templates/${id}`, patch)
}

export async function retireInspectionTemplate(id) {
  await api.del(`/inspection-templates/${id}`)
}

export async function createInspection(data) {
  return api.post('/inspections', data)
}

export async function updateInspection(id, updates) {
  return api.patch(`/inspections/${id}`, updates)
}
