import { api } from '../apiClient'

export async function listSites() {
  return api.get('/sites')
}

export async function createSite(input) {
  return api.post('/sites', input)
}

export async function updateSite(id, patch) {
  return api.patch(`/sites/${id}`, patch)
}

export async function softDeleteSite(id) {
  await api.del(`/sites/${id}`)
}

// Shutting a site down marks its assets Inactive and refuses new work there;
// reopening gives each asset back the status it had. Both answer with the site
// and how many assets moved.
export async function shutdownSite(id, reason) {
  return api.post(`/sites/${id}/shutdown`, { reason })
}

export async function reopenSite(id) {
  return api.post(`/sites/${id}/reopen`)
}
