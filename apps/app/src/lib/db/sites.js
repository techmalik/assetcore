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
