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

export async function transitionWorkOrder(id, newStatus, comment = '') {
  return api.post(`/work-orders/${id}/transition`, { status: newStatus, comment })
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
