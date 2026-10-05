import { api, qs } from '../apiClient'

export const MOVEMENT_KINDS = [
  ['receipt', 'Receipt', 'Stock came in'],
  ['issue', 'Issue', 'Stock went out'],
  ['return', 'Return', 'Came back unused'],
  ['adjustment', 'Adjustment', 'Correcting a count'],
]

export const MOVEMENT_LABEL = {
  receipt: 'Receipt', issue: 'Issue', return: 'Return',
  adjustment: 'Adjustment', consumption: 'Used on job',
}

export async function listSpareParts(filters = {}) {
  return api.get(`/spare-parts${qs(filters)}`)
}

export async function getSparePart(id) {
  return api.get(`/spare-parts/${id}`)
}

export async function getPartStats() {
  return api.get('/spare-parts/stats')
}

export async function listPartCategories() {
  return api.get('/spare-parts/categories')
}

export async function createSparePart(input) {
  return api.post('/spare-parts', input)
}

export async function updateSparePart(id, patch) {
  return api.patch(`/spare-parts/${id}`, patch)
}

export async function archiveSparePart(id) {
  await api.del(`/spare-parts/${id}`)
}

// `quantity` is always positive — `kind` decides which way stock moves.
export async function adjustStock(id, { kind, quantity, reason, unit_cost_cents }) {
  return api.post(`/spare-parts/${id}/adjust`, { kind, quantity, reason, unit_cost_cents })
}

export async function linkPartToAsset(partId, assetId) {
  await api.post(`/spare-parts/${partId}/assets`, { asset_id: assetId })
}

export async function unlinkPartFromAsset(partId, assetId) {
  await api.del(`/spare-parts/${partId}/assets/${assetId}`)
}
