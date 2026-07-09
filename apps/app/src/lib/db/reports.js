import { api } from '../apiClient'

export const REPORT_KINDS = {
  asset_register:      { label: 'Asset Register',      desc: 'Full asset list with category, site, status, health, and NBV' },
  wo_summary:          { label: 'Work Order Summary',  desc: 'All work orders with site, asset, type, status, priority and SLA' },
  compliance_register: { label: 'Compliance Register', desc: 'Licences and certificates with authority, site, and expiry' },
  pm_history:          { label: 'PM History',           desc: 'Preventive maintenance task history by asset and site' },
}

export async function listReports({ limit = 50 } = {}) {
  return api.get(`/reports?limit=${limit}`)
}

export async function requestReport({ title, kind, format = 'xlsx', params = {} }) {
  return api.post('/reports', { title, kind, format, params })
}

export async function generateReport(id) {
  return api.post(`/reports/${id}/generate`)
}

export async function downloadReport(report) {
  const filename = `${report.title.replace(/[^a-zA-Z0-9._-]+/g, '_')}.${report.format}`
  return api.download(`/files/${report.storage_path}`, filename)
}
