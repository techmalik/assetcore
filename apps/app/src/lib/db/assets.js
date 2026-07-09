import { api } from '../apiClient'

// Canonical data-access module — copy this shape for every other entity
// (work orders, PM, inspections, compliance). Components call these helpers;
// they never inline fetch calls.

export async function listAssets({ status } = {}) {
  const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : ''
  return api.get(`/assets${qs}`)
}

export async function getAsset(id) {
  return api.get(`/assets/${id}`)
}

export async function createAsset(input) {
  return api.post('/assets', input)
}

export async function updateAsset(id, patch) {
  return api.patch(`/assets/${id}`, patch)
}

export async function softDeleteAsset(id) {
  await api.del(`/assets/${id}`)
}

export async function uploadAssetPhoto(id, file) {
  const form = new FormData()
  form.append('photo', file)
  return api.upload(`/assets/${id}/photos`, form)
}
