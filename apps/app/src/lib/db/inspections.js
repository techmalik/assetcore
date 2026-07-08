import { api } from '../apiClient'

export async function listInspections({ statuses, limit = 100 } = {}) {
  const params = new URLSearchParams()
  if (statuses?.length) params.set('statuses', statuses.join(','))
  params.set('limit', limit)
  return api.get(`/inspections?${params.toString()}`)
}

export async function createInspection(data) {
  return api.post('/inspections', data)
}

export async function updateInspection(id, updates) {
  return api.patch(`/inspections/${id}`, updates)
}
