import { api } from '../apiClient'

export async function listComplianceLicences({ locationId } = {}) {
  const qs = locationId ? `?location_id=${encodeURIComponent(locationId)}` : ''
  const rows = await api.get(`/compliance-licences${qs}`)
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

export async function deleteComplianceDocument(id, url) {
  return api.del(`/compliance-licences/${id}/documents?url=${encodeURIComponent(url)}`)
}

// Compliance audits (ISO / routine-maintenance attestations)
export async function listComplianceAudits() {
  return api.get('/compliance-audits')
}
export async function createComplianceAudit(data) {
  return api.post('/compliance-audits', data)
}
export async function updateComplianceAudit(id, updates) {
  return api.patch(`/compliance-audits/${id}`, updates)
}
export async function softDeleteComplianceAudit(id) {
  await api.del(`/compliance-audits/${id}`)
}
export async function uploadAuditDocument(id, file) {
  const form = new FormData()
  form.append('document', file)
  return api.upload(`/compliance-audits/${id}/document`, form)
}

export async function listAuthorities() {
  return api.get('/regulatory-authorities')
}

export async function checkLicenceExpiry() {
  const { count } = await api.post('/compliance/check-expiry')
  return count
}

// { total, completed, onTime, rate } over pm_tasks due in the window
// (defaults to the trailing 12 months) — the objective counterpart to the
// audit form's self-reported routine-maintenance Yes/No.
export async function getPmCompliance({ from, to, siteId } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (siteId) params.set('site_id', siteId)
  const qs = params.toString()
  return api.get(`/compliance/pm-compliance${qs ? `?${qs}` : ''}`)
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

// ── Audit lifecycle and findings (0024) ──────────────────────────────────────
// The ISO questionnaire above and this share one table: 0024 merged them, so
// an audit records both what was asked and how it came out.

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

export async function getComplianceAudit(id) {
  return api.get(`/compliance-audits/${id}`)
}

export async function addAuditFinding(auditId, input) {
  return api.post(`/compliance-audits/${auditId}/findings`, input)
}

export async function updateAuditFinding(auditId, findingId, patch) {
  return api.patch(`/compliance-audits/${auditId}/findings/${findingId}`, patch)
}

// Puts the finding on the defect register, where it can become a work order.
export async function raiseFindingDefect(auditId, findingId, input = {}) {
  return api.post(`/compliance-audits/${auditId}/findings/${findingId}/defect`, input)
}
