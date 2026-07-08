import { api } from '../apiClient'

export async function getDashboardStats() {
  return api.get('/dashboard/stats')
}

export async function getRecentWorkOrders() {
  return api.get('/dashboard/recent-work-orders')
}
