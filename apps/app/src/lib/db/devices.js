import { api } from '../apiClient'

export async function listDevices({ statuses } = {}) {
  const qs = statuses?.length ? `?statuses=${statuses.join(',')}` : ''
  return api.get(`/devices${qs}`)
}

export async function createDevice(data) {
  return api.post('/devices', data)
}

export async function updateDevice(id, updates) {
  return api.patch(`/devices/${id}`, updates)
}

export async function softDeleteDevice(id) {
  await api.del(`/devices/${id}`)
}

export async function getLatestReadings(deviceId, limit = 10) {
  return api.get(`/devices/${deviceId}/readings?limit=${limit}`)
}
