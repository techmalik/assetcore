import { api } from '../apiClient'

export async function listInspections({ statuses, asset_id, locationId, limit = 100 } = {}) {
  const params = new URLSearchParams()
  if (statuses?.length) params.set('statuses', statuses.join(','))
  if (asset_id) params.set('asset_id', asset_id)
  if (locationId) params.set('location_id', locationId)
  params.set('limit', limit)
  return api.get(`/inspections?${params.toString()}`)
}

export async function createInspection(data) {
  return api.post('/inspections', data)
}

export async function updateInspection(id, updates) {
  return api.patch(`/inspections/${id}`, updates)
}

export async function uploadInspectionReport(id, file) {
  const form = new FormData()
  form.append('report', file)
  return api.upload(`/inspections/${id}/report`, form)
}

// ── Checklists and the condition rating (0023) ───────────────────────────────

// [{item, result, notes}] — the shape checklist_results settled on, shared
// with PM tasks so a checklist reads the same wherever it appears.
export const CHECKLIST_RESULTS = [
  ['pass', 'Pass'],
  ['fail', 'Fail'],
  ['na', 'N/A'],
  ['pending', 'Not checked'],
]

// 1-5, the outcome a completed inspection owes the condition score. The
// wording matters: these are read back to whoever has to defend the number.
export const CONDITION_RATINGS = [
  [5, 'As new', 'No defects, everything within spec'],
  [4, 'Good', 'Minor wear, fully serviceable'],
  [3, 'Fair', 'Visible wear, monitor it'],
  [2, 'Poor', 'Degraded, needs work'],
  [1, 'Failed', 'Unsafe or out of service'],
]

export const RATING_LABEL = Object.fromEntries(CONDITION_RATINGS.map(([v, l]) => [v, l]))

export async function getInspection(id) {
  return api.get(`/inspections/${id}`)
}

// The checklist definition behind an inspection. Picked when the inspection is
// raised and copied onto it, so editing a template later never rewrites an
// inspection already carried out.
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
