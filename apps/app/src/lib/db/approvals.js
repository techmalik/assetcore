import { api } from '../apiClient'

export const APPROVAL_ENTITY_TYPES = [
  ['work_order', 'Work order'],
  ['defect', 'Defect'],
  ['compliance_licence', 'Licence'],
  ['pm_task', 'PM task'],
  ['inspection', 'Inspection'],
  ['maintenance_event', 'Maintenance record'],
]

export const ENTITY_LABEL = Object.fromEntries(APPROVAL_ENTITY_TYPES)

// Which kinds belong to which entity — the rule form uses this so it can't
// offer "licence renewal" for a work order.
export const APPROVAL_KINDS = {
  work_order: [
    ['wo_closure', 'Closure sign-off', 'Confirming a job is genuinely finished'],
    ['wo_cost', 'Spend authorisation', 'Cost on a job above a threshold'],
    ['wo_approval', 'Approval to proceed', 'Letting a drafted job go ahead'],
  ],
  defect: [['defect_deferral', 'Deferral', 'Accepting a defect rather than fixing it']],
  compliance_licence: [['licence_renewal', 'Renewal', 'Authorising a licence renewal']],
  pm_task: [
    ['pm_signoff', 'PM sign-off', 'Confirming scheduled maintenance was done'],
    // The Maintenance page lists PM tasks, not maintenance_events rows, so a
    // report raised from there is keyed to the task it completed.
    ['maintenance_report', 'Maintenance report', 'A completed maintenance report for review'],
  ],
  inspection: [['inspection_report', 'Inspection report', 'A completed inspection report for review']],
  maintenance_event: [['maintenance_report', 'Maintenance report', 'A completed maintenance report for review']],
}

export const KIND_LABEL = Object.fromEntries(
  Object.values(APPROVAL_KINDS).flat().map(([k, l]) => [k, l])
)

// A direct request is "accepted" by the person it was sent to. The matrix's
// "approved" reads wrong for a report, which is received rather than
// authorised, so the label depends on the route.
export const APPROVAL_STATUS_META = {
  pending: { label: 'Pending', cls: 'badge-a' },
  approved: { label: 'Approved', cls: 'badge-g' },
  rejected: { label: 'Rejected', cls: 'badge-r' },
  recalled: { label: 'Recalled', cls: 'badge-n' },
  returned: { label: 'Returned', cls: 'badge-a' },
  discarded: { label: 'Discarded', cls: 'badge-n' },
}

export function approvalStatusMeta(approval) {
  if (approval?.route === 'direct' && approval.status === 'approved') return { label: 'Accepted', cls: 'badge-g' }
  return APPROVAL_STATUS_META[approval?.status] || APPROVAL_STATUS_META.pending
}

export const EVENT_LABEL = {
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
  recalled: 'recalled',
  forwarded: 'forwarded',
  returned: 'returned',
  discarded: 'discarded',
  resubmitted: 'resubmitted',
}

// Codes the person-routed actions answer with, in words. Merged into each
// screen's own map so one sentence covers every place a request is acted on.
export const DIRECT_ERROR_TEXT = {
  invalid_assignee: 'That person cannot receive approvals. They must be an active member who can decide requests, and not the one sending it.',
  not_assignee: 'This request is not with you, so only the person it was sent to can act on it.',
  not_returned: 'Only a request that was returned to you can be resubmitted.',
  not_direct: 'That action only applies to a request sent to a named person.',
  notes_required: 'Say why. The requester sees this note.',
  cannot_forward_to_requester: 'You cannot forward a request back to the person who sent it. Return it instead.',
  cannot_forward_to_self: 'This request is already with you.',
  wrong_route: 'This request goes through the approval matrix, so approve or reject it rather than returning or discarding it.',
  invalid_manager: 'A line manager has to be another active member of this organisation.',
  manager_cycle: 'Those two people would each be the other’s line manager. Pick someone else.',
}

// ── Sent to a person ─────────────────────────────────────────────────────────
// Everyone who can decide approvals, other than the caller, with the caller's
// line manager flagged (`is_line_manager`) so a picker can preselect them.
export async function listApprovers() {
  return api.get('/approvals/approvers')
}

export async function forwardRequest(id, toUserId, notes) {
  return api.post(`/approvals/${id}/forward`, { to_user_id: toUserId, notes: notes || null })
}

// Return and discard both require a note: the requester has to be told why.
export async function returnRequest(id, notes) {
  return api.post(`/approvals/${id}/return`, { notes })
}

export async function discardRequest(id, notes) {
  return api.post(`/approvals/${id}/discard`, { notes })
}

export async function resubmitRequest(id, assigneeId, notes) {
  return api.post(`/approvals/${id}/resubmit`, { assignee_id: assigneeId, notes: notes || null })
}

// ── The matrix ───────────────────────────────────────────────────────────────
export async function listApprovalRules() {
  return api.get('/approval-rules')
}

export async function createApprovalRule(input) {
  return api.post('/approval-rules', input)
}

export async function updateApprovalRule(id, patch) {
  return api.patch(`/approval-rules/${id}`, patch)
}

export async function retireApprovalRule(id) {
  await api.del(`/approval-rules/${id}`)
}

// ── Requests ─────────────────────────────────────────────────────────────────
// scope: 'inbox' (waiting on me), 'mine' (I submitted), 'all'.
export async function listApprovals(filters = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') params.set(k, v)
  }
  const qs = params.toString()
  return api.get(`/approvals${qs ? `?${qs}` : ''}`)
}

export async function getApprovalStats() {
  return api.get('/approvals/stats')
}

export async function getApproval(id) {
  return api.get(`/approvals/${id}`)
}

export async function submitApproval(input) {
  return api.post('/approvals', input)
}

export async function approveRequest(id, notes) {
  return api.post(`/approvals/${id}/approve`, { notes: notes || null })
}

export async function rejectRequest(id, notes) {
  return api.post(`/approvals/${id}/reject`, { notes: notes || null })
}

export async function recallRequest(id, notes) {
  return api.post(`/approvals/${id}/recall`, { notes: notes || null })
}
