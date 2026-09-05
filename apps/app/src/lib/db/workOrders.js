import { api } from '../apiClient'

// Status transitions allowed per current status
export const WO_TRANSITIONS = {
  new:            ['assigned', 'in_progress', 'closed'],
  assigned:       ['in_progress', 'awaiting_parts', 'closed'],
  in_progress:    ['awaiting_parts', 'inspection', 'closed'],
  awaiting_parts: ['in_progress', 'closed'],
  inspection:     ['closed', 'in_progress'],
  closed:         [],
}

export const WO_STATUS_LABEL = {
  new:            'New',
  assigned:       'Assigned',
  in_progress:    'In Progress',
  awaiting_parts: 'Awaiting Parts',
  inspection:     'Inspection',
  closed:         'Closed',
}

export const WO_PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const WO_TYPE_LABEL = { corrective: 'Corrective', preventive: 'Preventive', inspection: 'Inspection', emergency: 'Emergency' }

export async function listWorkOrders({ status, priority } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (priority) params.set('priority', priority)
  const qs = params.toString()
  return api.get(`/work-orders${qs ? `?${qs}` : ''}`)
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

// `report` is only read when closing: the completion fields the technician
// filled in. Closing also draws the job's reserved parts out of stock, and
// fails with { error: 'insufficient_stock', shortfalls } if any part is short.
export async function transitionWorkOrder(id, newStatus, comment = '', report = undefined) {
  return api.post(`/work-orders/${id}/transition`, { status: newStatus, comment, report })
}

// ── Task checklist ───────────────────────────────────────────────────────────
export async function listWorkOrderTasks(id) {
  return api.get(`/work-orders/${id}/tasks`)
}

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
export async function listWorkOrderParts(id) {
  return api.get(`/work-orders/${id}/parts`)
}

export async function addWorkOrderPart(id, line) {
  return api.post(`/work-orders/${id}/parts`, line)
}

export async function updateWorkOrderPart(id, lineId, patch) {
  return api.patch(`/work-orders/${id}/parts/${lineId}`, patch)
}

export async function deleteWorkOrderPart(id, lineId) {
  await api.del(`/work-orders/${id}/parts/${lineId}`)
}

export async function addWorkOrderComment(workOrderId, body) {
  return api.post(`/work-orders/${workOrderId}/comments`, { body })
}

export async function softDeleteWorkOrder(id) {
  await api.del(`/work-orders/${id}`)
}

export async function uploadWorkOrderAttachment(id, file) {
  const form = new FormData()
  form.append('file', file)
  return api.upload(`/work-orders/${id}/attachments`, form)
}
