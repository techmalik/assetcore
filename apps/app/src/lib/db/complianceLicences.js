import { api } from '../apiClient'

export async function listComplianceLicences() {
  const rows = await api.get('/compliance-licences')
  return (rows || []).map(row => ({
    ...row,
    status: licenceStatus(row.expiry_date),
  }))
}

export async function getComplianceLicenceCounts() {
  return api.get('/compliance-licences/counts')
}

export async function createComplianceLicence(data) {
  return api.post('/compliance-licences', data)
}

export async function updateComplianceLicence(id, updates) {
  return api.patch(`/compliance-licences/${id}`, updates)
}

export async function softDeleteComplianceLicence(id) {
  await api.del(`/compliance-licences/${id}`)
}

export async function uploadComplianceDocument(id, file) {
  const form = new FormData()
  form.append('document', file)
  return api.upload(`/compliance-licences/${id}/document`, form)
}

export async function listAuthorities() {
  return api.get('/regulatory-authorities')
}

export async function checkLicenceExpiry() {
  const { count } = await api.post('/compliance/check-expiry')
  return count
}

// Client-side status helper (mirrors the DB function)
export function licenceStatus(expiryDate) {
  const exp = new Date(expiryDate); exp.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  const diff = Math.floor((exp - now) / 86400000)
  if (diff < 0)  return 'expired'
  if (diff < 30) return 'expiring'
  if (diff < 90) return 'due_soon'
  return 'active'
}

export function daysUntilExpiry(expiryDate) {
  const exp = new Date(expiryDate); exp.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  return Math.floor((exp - now) / 86400000)
}

// ── Audits ───────────────────────────────────────────────────────────────────
// Licences are documents with an expiry date; an audit is someone coming to
// check. An audit without an outcome is a diary entry, so the API refuses to
// complete one without it.

export const AUDIT_KINDS = [
  ['internal', 'Internal'],
  ['external', 'External'],
  ['regulatory', 'Regulatory'],
  ['certification', 'Certification'],
]

export const AUDIT_OUTCOMES = [
  ['pass', 'Pass', 'badge-g'],
  ['pass_with_findings', 'Pass with findings', 'badge-a'],
  ['fail', 'Fail', 'badge-r'],
  ['not_applicable', 'Not applicable', 'badge-n'],
]

export const OUTCOME_LABEL = Object.fromEntries(AUDIT_OUTCOMES.map(([k, l]) => [k, l]))
export const OUTCOME_CLASS = Object.fromEntries(AUDIT_OUTCOMES.map(([k, , c]) => [k, c]))

export const FINDING_SEVERITIES = [
  ['observation', 'Observation'],
  ['minor', 'Minor'],
  ['major', 'Major'],
  ['critical', 'Critical'],
]

export const FINDING_CLASS = {
  observation: 'badge-n', minor: 'badge-b', major: 'badge-a', critical: 'badge-r',
}

export async function listAudits(filters = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== '' && v !== 'all' && v !== false) params.set(k, v)
  }
  const qs = params.toString()
  return api.get(`/compliance-audits${qs ? `?${qs}` : ''}`)
}

export async function getAuditStats() {
  return api.get('/compliance-audits/stats')
}

export async function getAudit(id) {
  return api.get(`/compliance-audits/${id}`)
}

export async function createAudit(input) {
  return api.post('/compliance-audits', input)
}

export async function updateAudit(id, patch) {
  return api.patch(`/compliance-audits/${id}`, patch)
}

export async function archiveAudit(id) {
  await api.del(`/compliance-audits/${id}`)
}

export async function addFinding(auditId, input) {
  return api.post(`/compliance-audits/${auditId}/findings`, input)
}

export async function updateFinding(auditId, findingId, patch) {
  return api.patch(`/compliance-audits/${auditId}/findings/${findingId}`, patch)
}

// Puts the finding on the defect register, where it can become a work order.
export async function raiseFindingDefect(auditId, findingId, input = {}) {
  return api.post(`/compliance-audits/${auditId}/findings/${findingId}/defect`, input)
}
