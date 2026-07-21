import { api } from '../apiClient'

export async function listLocations() {
  return api.get('/locations')
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
