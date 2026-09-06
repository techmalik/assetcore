import { api } from '../apiClient'

// Every figure here is computed from work orders as they stand — nothing is
// stored — so a number on the analytics page can always be traced back to the
// jobs behind it.
export async function getKpis({ from, to, asset_id } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (asset_id) params.set('asset_id', asset_id)
  const qs = params.toString()
  return api.get(`/analytics/kpis${qs ? `?${qs}` : ''}`)
}

export async function getWorkOrderTrend(months = 12) {
  return api.get(`/analytics/work-order-trend?months=${months}`)
}

export async function getWorkOrderMix() {
  return api.get('/analytics/work-order-mix')
}

export async function getWorstAssets(limit = 8) {
  return api.get(`/analytics/worst-assets?limit=${limit}`)
}

// Returns the assets that can be placed plus a count of those that cannot, so
// the map can say what it is not showing.
export async function getAssetMap() {
  return api.get('/analytics/asset-map')
}

export async function getCalendar(from, to) {
  return api.get(`/analytics/calendar?from=${from}&to=${to}`)
}
