import { api } from '../apiClient'

export const APPROVAL_ENTITY_TYPES = [
  ['work_order', 'Work order'],
  ['defect', 'Defect'],
  ['compliance_licence', 'Licence'],
  ['pm_task', 'PM task'],
]

export const ENTITY_LABEL = Object.fromEntries(APPROVAL_ENTITY_TYPES)

// Which kinds belong to which entity — the rule form uses this so it can't
// offer "licence renewal" for a work order.
export const APPROVAL_KINDS = {
  work_order: [
    ['wo_closure', 'Closure sign-off', 'Confirming a job is genuinely finished'],
    ['wo_cost', 'Spend authorisation', 'Cost on a job above a threshold'],
  ],
  defect: [['defect_deferral', 'Deferral', 'Accepting a defect rather than fixing it']],
  compliance_licence: [['licence_renewal', 'Renewal', 'Authorising a licence renewal']],
  pm_task: [['pm_signoff', 'PM sign-off', 'Confirming scheduled maintenance was done']],
}

export const KIND_LABEL = Object.fromEntries(
  Object.values(APPROVAL_KINDS).flat().map(([k, l]) => [k, l])
)

export const APPROVAL_STATUS_META = {
  pending: { label: 'Pending', cls: 'badge-a' },
  approved: { label: 'Approved', cls: 'badge-g' },
  rejected: { label: 'Rejected', cls: 'badge-r' },
  recalled: { label: 'Recalled', cls: 'badge-n' },
}

export const EVENT_LABEL = {
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'rejected',
  recalled: 'recalled',
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
