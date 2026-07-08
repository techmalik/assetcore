import { api } from '../apiClient'

export async function listReports({ limit = 50 } = {}) {
  return api.get(`/reports?limit=${limit}`)
}

export async function requestReport({ title, kind, format = 'xlsx', params = {} }) {
  return api.post('/reports', { title, kind, format, params })
}

// Simulates a report completing — real generation (exceljs, CSV/XLSX) lands in Phase 6.
export async function simulateReportReady(id) {
  return api.post(`/reports/${id}/simulate-ready`)
}
