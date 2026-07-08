import { api } from '../apiClient'

export async function listPMTasks({ statuses, dueBefore, dueAfter, limit = 100 } = {}) {
  const params = new URLSearchParams()
  if (statuses?.length) params.set('statuses', statuses.join(','))
  if (dueBefore) params.set('dueBefore', dueBefore)
  if (dueAfter) params.set('dueAfter', dueAfter)
  params.set('limit', limit)
  return api.get(`/pm-tasks?${params.toString()}`)
}

export async function updatePMTask(id, updates) {
  return api.patch(`/pm-tasks/${id}`, updates)
}

export async function generatePMTasks() {
  const { count } = await api.post('/pm/generate')
  return count
}
