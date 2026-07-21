import { api } from '../apiClient'

export async function getOrg() {
  return api.get('/org')
}

// PATCH replaces the settings jsonb wholesale — callers must merge before saving
// so unrelated keys (e.g. { onboarded: true }) are preserved.
export async function updateOrg(patch) {
  return api.patch('/org', patch)
}
