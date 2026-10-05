import { api, qs } from '../apiClient'

const qsFor = (locationId) => qs({ location_id: locationId })

export async function getDashboardStats({ locationId } = {}) {
  return api.get(`/dashboard/stats${qsFor(locationId)}`)
}

export async function getRecentWorkOrders({ locationId } = {}) {
  return api.get(`/dashboard/recent-work-orders${qsFor(locationId)}`)
}

export async function getDashboardAlerts({ locationId } = {}) {
  return api.get(`/dashboard/alerts${qsFor(locationId)}`)
}
