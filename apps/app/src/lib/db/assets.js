import { api } from '../apiClient'

// Canonical data-access module — copy this shape for every other entity
// (work orders, PM, inspections, compliance). Components call these helpers;
// they never inline fetch calls.

export async function listAssets({ status, archived } = {}) {
  const qs = new URLSearchParams()
  if (status && status !== 'all') qs.set('status', status)
  if (archived) qs.set('archived', '1')
  const s = qs.toString()
  return api.get(`/assets${s ? `?${s}` : ''}`)
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

export async function restoreAsset(id) {
  return api.post(`/assets/${id}/restore`)
}

export async function importAssets(rows) {
  return api.post('/assets/import', { rows })
}

export async function uploadAssetPhoto(id, file) {
  const form = new FormData()
  form.append('photo', file)
  return api.upload(`/assets/${id}/photos`, form)
}

export async function uploadAssetDocument(id, file) {
  const form = new FormData()
  form.append('document', file)
  return api.upload(`/assets/${id}/documents`, form)
}

export async function deleteAssetDocument(id, url) {
  return api.del(`/assets/${id}/documents?url=${encodeURIComponent(url)}`)
}

export async function listAssetActivity(id) {
  return api.get(`/assets/${id}/activity`)
}

export async function addAssetComment(id, body) {
  return api.post(`/assets/${id}/activity`, { body })
}
