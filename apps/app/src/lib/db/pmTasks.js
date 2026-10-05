import { api, qs } from '../apiClient'

export async function listPMTasks({ statuses, dueBefore, dueAfter, asset_id, locationId, limit = 100 } = {}) {
  return api.get(`/pm-tasks${qs({ statuses, dueBefore, dueAfter, asset_id, location_id: locationId, limit })}`)
}

export async function updatePMTask(id, updates) {
  return api.patch(`/pm-tasks/${id}`, updates)
}

export async function generatePMTasks() {
  const { count } = await api.post('/pm/generate')
  return count
}

export async function uploadMaintenanceReport(id, file) {
  const form = new FormData()
  form.append('report', file)
  return api.upload(`/pm-tasks/${id}/report`, form)
}
