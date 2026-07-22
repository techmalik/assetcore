import { api } from '../apiClient'

export async function listLocations() {
  return api.get('/locations')
}

// Locations the caller's own site scope reaches — backs the topbar location
// filter switcher. See the API route's comment for why this differs from
// listLocations() (an org-wide admin-management listing).
export async function listMyLocations() {
  return api.get('/locations/mine')
}

export async function createLocation(input) {
  return api.post('/locations', input)
}

export async function updateLocation(id, patch) {
  return api.patch(`/locations/${id}`, patch)
}

export async function softDeleteLocation(id) {
  await api.del(`/locations/${id}`)
}
