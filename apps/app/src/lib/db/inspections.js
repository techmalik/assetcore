import { api } from '../apiClient'

export async function listInspections({ statuses, asset_id, limit = 100 } = {}) {
  const params = new URLSearchParams()
  if (statuses?.length) params.set('statuses', statuses.join(','))
  if (asset_id) params.set('asset_id', asset_id)
  params.set('limit', limit)
  return api.get(`/inspections?${params.toString()}`)
}

export async function createInspection(data) {
  return api.post('/inspections', data)
}

export async function updateInspection(id, updates) {
  return api.patch(`/inspections/${id}`, updates)
}
