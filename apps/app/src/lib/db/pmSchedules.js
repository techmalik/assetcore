import { api } from '../apiClient'

export async function listPMSchedules({ activeOnly = true } = {}) {
  return api.get(`/pm-schedules?activeOnly=${activeOnly}`)
}

export async function createPMSchedule(data) {
  return api.post('/pm-schedules', data)
}

export async function updatePMSchedule(id, updates) {
  return api.patch(`/pm-schedules/${id}`, updates)
}

export async function softDeletePMSchedule(id) {
  await api.del(`/pm-schedules/${id}`)
}
