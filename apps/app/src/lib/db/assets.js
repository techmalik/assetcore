import { api } from '../apiClient'

// Canonical data-access module — copy this shape for every other entity
// (work orders, PM, inspections, compliance). Components call these helpers;
// they never inline fetch calls.

// Any of: status, criticality, lifecycle_status, site_id, category_id, tag, q,
// archived. Empty and 'all' values are dropped rather than sent.
export async function listAssets(filters = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') params.set(k, v)
  }
  const qs = params.toString()
  return api.get(`/assets${qs ? `?${qs}` : ''}`)
}

// What a QR scan resolves against. Throws with status 404 if the tag is unknown.
export async function getAssetByAin(ain) {
  return api.get(`/assets/by-ain/${encodeURIComponent(ain)}`)
}

export async function restoreAsset(id) {
  return api.post(`/assets/${id}/restore`)
}

// rows: array of objects keyed by CSV header. mode: 'create' | 'upsert'.
export async function importAssets({ rows, mode = 'create', create_missing_categories = false }) {
  return api.post('/assets/import', { rows, mode, create_missing_categories })
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

// ── Condition score ──────────────────────────────────────────────────────────
// What the engine makes of the asset right now, component by component. Always
// computed live, even when the stored score is a manual override, so someone
// deciding whether to keep their own number can see the calculated one first.
export async function getAssetHealth(id) {
  return api.get(`/assets/${id}/health`)
}

// `claim` is the user handing a hand-entered score back to the engine — the
// only thing that replaces a manual override.
export async function recomputeAssetHealth(id, { claim = false } = {}) {
  return api.post(`/assets/${id}/health/recompute`, { claim })
}
