import { api } from '../apiClient'

export async function getOrg() {
  return api.get('/org')
}

// PATCH replaces the settings jsonb wholesale — callers must merge before saving
// so unrelated keys (e.g. { onboarded: true }) are preserved.
export async function updateOrg(patch) {
  return api.patch('/org', patch)
}

// Settings-only, capability-gated (org:manage) rather than owner-role-only
// like updateOrg() above — use this for anything that only touches
// `settings` (e.g. the health inspection threshold) so non-owner org:manage
// holders (ops_manager) can actually save it.
export async function updateOrgSettings(settings) {
  return api.patch('/org/settings', { settings })
}
