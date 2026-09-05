import { api } from '../apiClient'

// Severity is about the finding, priority is about the response — the server
// maps between them when a defect becomes a work order. The hints below are
// what the form shows so the two are not confused at the point of entry.
export const DEFECT_SEVERITIES = [
  ['minor', 'Minor', 'Cosmetic or negligible effect'],
  ['moderate', 'Moderate', 'Degraded, still serviceable'],
  ['major', 'Major', 'Function impaired'],
  ['critical', 'Critical', 'Unsafe or out of service'],
]

export const SEVERITY_LABEL = Object.fromEntries(DEFECT_SEVERITIES.map(([k, l]) => [k, l]))

export const DEFECT_STATUSES = [
  ['open', 'Open'],
  ['acknowledged', 'Acknowledged'],
  ['in_progress', 'In progress'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
  ['deferred', 'Deferred'],
]

export const STATUS_LABEL = Object.fromEntries(DEFECT_STATUSES)

export const OPEN_STATUSES = ['open', 'acknowledged', 'in_progress', 'deferred']

// Any of: status, severity, asset_id, inspection_id, open, overdue, q.
export async function listDefects(filters = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '' && v !== 'all' && v !== false) params.set(k, v)
  }
  const qs = params.toString()
  return api.get(`/defects${qs ? `?${qs}` : ''}`)
}

export async function getDefectStats() {
  return api.get('/defects/stats')
}

export async function getDefect(id) {
  return api.get(`/defects/${id}`)
}

export async function createDefect(input) {
  return api.post('/defects', input)
}

export async function updateDefect(id, patch) {
  return api.patch(`/defects/${id}`, patch)
}

export async function archiveDefect(id) {
  await api.del(`/defects/${id}`)
}

// Raises the job that clears the defect and links the two. Everything is
// optional — omitted fields are taken from the defect itself.
export async function raiseWorkOrder(id, input = {}) {
  return api.post(`/defects/${id}/work-order`, input)
}
