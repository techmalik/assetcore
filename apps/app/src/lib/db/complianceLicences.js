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
