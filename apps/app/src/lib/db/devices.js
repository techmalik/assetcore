import { api, qs } from '../apiClient'

export async function listDevices({ statuses } = {}) {
  return api.get(`/devices${qs({ statuses })}`)
}

export async function createDevice(data) {
  return api.post('/devices', data)
}

export async function updateDevice(id, updates) {
  return api.patch(`/devices/${id}`, updates)
}
