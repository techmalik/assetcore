import { api } from '../apiClient'

// { source, pm_task_id, work_order_id, completed_at, next_maintenance_at, notes, report }
export async function completeMaintenance(assetId, fields) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue
    form.append(k, v)
  }
  return api.upload(`/assets/${assetId}/maintenance-completions`, form)
}
