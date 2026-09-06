import { api } from '../apiClient'

export const DEPRECIATION_METHODS = [
  ['straight_line', 'Straight line', 'Same charge every year'],
  ['declining_balance', 'Declining balance', 'Front-loaded, on the book value'],
  ['sum_of_years_digits', "Sum of years' digits", 'Front-loaded, on the cost'],
  ['units_of_production', 'Units of production', 'Needs meter readings — not yet supported'],
]

export const METHOD_LABEL = Object.fromEntries(DEPRECIATION_METHODS.map(([k, l]) => [k, l]))

export async function listSchedules({ include_superseded = false } = {}) {
  return api.get(`/depreciation/schedules${include_superseded ? '?include_superseded=true' : ''}`)
}

export async function getDepreciationStats() {
  return api.get('/depreciation/stats')
}

export async function getForecast() {
  return api.get('/depreciation/forecast')
}

export async function getAssetSchedule(assetId) {
  return api.get(`/depreciation/assets/${assetId}`)
}

// Runs the maths without saving, so the table can be checked before committing.
export async function previewSchedule(input) {
  return api.post('/depreciation/preview', input)
}

export async function createSchedule(input) {
  return api.post('/depreciation/schedules', input)
}

export async function postSchedule(id, throughYear) {
  return api.post(`/depreciation/schedules/${id}/post`, { through_year: throughYear })
}

export async function postAllSchedules(throughYear) {
  return api.post('/depreciation/post-all', { through_year: throughYear })
}

export async function retireSchedule(id) {
  await api.del(`/depreciation/schedules/${id}`)
}
