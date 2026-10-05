import { api, qs } from '../apiClient'
import {
  WO_TRANSITIONS, WO_STATUSES, PRIORITIES, WO_TYPES, WO_STATUS, PRIORITY, WO_TYPE, toneOf, labelOf,
} from '../domain'

// Transitions, labels and tones come from the shared lists (lib/domain.js);
// these names stay so the pages that import them need not change.
export { WO_TRANSITIONS }

export const WO_STATUS_LABEL = Object.fromEntries(WO_STATUSES.map((k) => [k, labelOf(WO_STATUS, k)]))
export const WO_PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((k) => [k, labelOf(PRIORITY, k)]))
export const WO_TYPE_LABEL = Object.fromEntries(WO_TYPES.map((k) => [k, labelOf(WO_TYPE, k)]))
export const WO_PRIORITY_STYLE = Object.fromEntries(PRIORITIES.map((k) => [k, toneOf(PRIORITY, k)]))

export function woStatusStyle(status) {
  return toneOf(WO_STATUS, status, 'blue')
}

export async function listWorkOrders({ status, priority, asset_id, locationId } = {}) {
  return api.get(`/work-orders${qs({ status, priority, asset_id, location_id: locationId })}`)
}

export async function getWorkOrder(id) {
  return api.get(`/work-orders/${id}`)
}

export async function createWorkOrder(input) {
  return api.post('/work-orders', input)
}

export async function updateWorkOrder(id, patch) {
  return api.patch(`/work-orders/${id}`, patch)
}

export async function transitionWorkOrder(id, newStatus, comment = '') {
  return api.post(`/work-orders/${id}/transition`, { status: newStatus, comment })
}

export async function addWorkOrderComment(workOrderId, body) {
  return api.post(`/work-orders/${workOrderId}/comments`, { body })
}

export async function uploadWorkOrderAttachment(id, file) {
  const form = new FormData()
  form.append('file', file)
  return api.upload(`/work-orders/${id}/attachments`, form)
}
// ── Task checklist ───────────────────────────────────────────────────────────

export async function addWorkOrderTask(id, description) {
  return api.post(`/work-orders/${id}/tasks`, { description })
}

export async function updateWorkOrderTask(id, taskId, patch) {
  return api.patch(`/work-orders/${id}/tasks/${taskId}`, patch)
}

export async function deleteWorkOrderTask(id, taskId) {
  await api.del(`/work-orders/${id}/tasks/${taskId}`)
}

// ── Parts drawn against the job ──────────────────────────────────────────────

export async function addWorkOrderPart(id, line) {
  return api.post(`/work-orders/${id}/parts`, line)
}

export async function deleteWorkOrderPart(id, lineId) {
  await api.del(`/work-orders/${id}/parts/${lineId}`)
}
