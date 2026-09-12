import { api } from '../apiClient'

export async function listAuditLog({ limit = 50, offset = 0, filters = {} } = {}) {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  // Only send filters that are actually set — an empty `action=` would be sent
  // as a real value and match nothing.
  for (const [k, v] of Object.entries(filters)) {
    if (v) qs.set(k, v)
  }
  return api.get(`/audit-log?${qs.toString()}`)
}

/** Actors, actions and entity types present in this org's log, for the filter
 * bar — offering only values that can actually return a row. */
export async function auditFacets() {
  return api.get('/audit-log/facets')
}

// Audit entries are now written server-side, atomically with each mutation
// (apps/api/src/audit.ts, called from every route handler) — there is no
// longer a client-side logAudit() to call after the fact.
