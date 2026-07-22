import { api } from '../apiClient'

function qsFor(locationId) {
  return locationId ? `?location_id=${encodeURIComponent(locationId)}` : ''
}

export async function getDashboardStats({ locationId } = {}) {
  return api.get(`/dashboard/stats${qsFor(locationId)}`)
}

export async function getRecentWorkOrders({ locationId } = {}) {
  return api.get(`/dashboard/recent-work-orders${qsFor(locationId)}`)
}

export async function getDashboardAlerts({ locationId } = {}) {
  return api.get(`/dashboard/alerts${qsFor(locationId)}`)
}
