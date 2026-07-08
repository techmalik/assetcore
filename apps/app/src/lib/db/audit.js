import { api } from '../apiClient'

export async function listAuditLog({ limit = 50, offset = 0 } = {}) {
  return api.get(`/audit-log?limit=${limit}&offset=${offset}`)
}

// Audit entries are now written server-side, atomically with each mutation
// (apps/api/src/audit.ts, called from every route handler) — there is no
// longer a client-side logAudit() to call after the fact.
