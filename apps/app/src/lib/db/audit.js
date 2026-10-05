import { api, qs } from '../apiClient'

export async function listAuditLog({ limit = 50, offset = 0, filters = {} } = {}) {
  // qs() leaves out blank filters: an empty `action=` would match nothing.
  return api.get(`/audit-log${qs({ limit, offset, ...filters })}`)
}

/** Actors, actions and entity types present in this org's log, for the filter
 * bar — offering only values that can actually return a row. */
export async function auditFacets() {
  return api.get('/audit-log/facets')
}

// Audit entries are now written server-side, atomically with each mutation
// (apps/api/src/audit.ts, called from every route handler) — there is no
// longer a client-side logAudit() to call after the fact.
