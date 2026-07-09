import { api } from '../apiClient'

export async function getLicence() {
  return api.get('/licence')
}

export function licenceDaysRemaining(expiresAt) {
  if (!expiresAt) return null
  const exp = new Date(expiresAt); exp.setHours(0, 0, 0, 0)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return Math.floor((exp - now) / 86400000)
}
