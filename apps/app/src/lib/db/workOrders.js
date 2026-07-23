import { api } from '../apiClient'

// Status transitions allowed per current status. `draft` is where
// auto-generated WOs land (health-crossing automation) — approving one moves
// it to `new`; human-created WOs never start as draft.
export const WO_TRANSITIONS = {
  draft:          ['new', 'closed'],
  new:            ['assigned', 'in_progress', 'closed'],
  assigned:       ['in_progress', 'awaiting_parts', 'closed'],
  in_progress:    ['awaiting_parts', 'inspection', 'closed'],
  awaiting_parts: ['in_progress', 'closed'],
  inspection:     ['closed', 'in_progress'],
  closed:         [],
}

export const WO_STATUS_LABEL = {
  draft:          'Draft',
  new:            'New',
  assigned:       'Assigned',
  in_progress:    'In Progress',
  awaiting_parts: 'Awaiting Parts',
  inspection:     'Inspection',
  closed:         'Closed',
}

export const WO_PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const WO_TYPE_LABEL = { corrective: 'Corrective', preventive: 'Preventive', inspection: 'Inspection', emergency: 'Emergency' }

// Shared priority tone map — used by both the Work Orders page and the
// Dashboard's recent-WO widget so the same priority renders identically
// in both places.
export const WO_PRIORITY_STYLE = {
  critical: { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)' },
  high:     { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)' },
  medium:   { bg: 'var(--b50)',  c: 'var(--b700)', br: 'var(--b200)' },
  low:      { bg: 'var(--n100)', c: 'var(--n600)', br: 'var(--n300)' },
}

// WO status badges are intentionally neutral-blue everywhere (not
// tone-per-status) - status progression is shown by position/label, not color.
// Draft is the one exception: a system-proposed WO awaiting approval renders
// muted/neutral so it reads as "not yet real work".
export const WO_STATUS_STYLE = { bg: 'var(--b50)', c: 'var(--b700)', br: 'var(--b200)' }
export const WO_DRAFT_STYLE = { bg: 'var(--n100)', c: 'var(--n600)', br: 'var(--n300)' }

export function woStatusStyle(status) {
  return status === 'draft' ? WO_DRAFT_STYLE : WO_STATUS_STYLE
}

export async function listWorkOrders({ status, priority, asset_id, locationId } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (priority) params.set('priority', priority)
  if (asset_id) params.set('asset_id', asset_id)
  if (locationId) params.set('location_id', locationId)
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
