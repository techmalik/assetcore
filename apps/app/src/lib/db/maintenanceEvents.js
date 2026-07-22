import { api } from '../apiClient'

export async function listMaintenanceCompletions(assetId) {
  return api.get(`/assets/${assetId}/maintenance-completions`)
}

// { source, pm_task_id, work_order_id, completed_at, next_maintenance_at, notes, report }
export async function completeMaintenance(assetId, fields) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue
    form.append(k, v)
  }
  return api.upload(`/assets/${assetId}/maintenance-completions`, form)
}

export async function uploadMaintenanceCompletionReport(id, file) {
  const form = new FormData()
  form.append('report', file)
  return api.upload(`/maintenance-completions/${id}/report`, form)
}
