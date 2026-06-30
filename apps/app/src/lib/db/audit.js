import { supabase, isConfigured } from '../supabase'
import { getSession, getOrgRole } from '../auth'

export async function listAuditLog({ limit = 50, offset = 0 } = {}) {
  const { data, error, count } = await supabase
    .from('audit_log')
    .select('*, actor:profiles!actor_id(full_name,email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return { rows: data || [], total: count || 0 }
}

// Append an immutable audit-log entry. Called by every create/update/state-change
// in the db helpers. Never throws into the caller — audit failures are logged,
// not surfaced to the user.
export async function logAudit({ action, entityType, entityId, before = null, after = null }) {
  if (!isConfigured) return
  try {
    const session = await getSession()
    if (!session) return
    const { orgId } = getOrgRole(session)
    if (!orgId) return
    await supabase.from('audit_log').insert({
      org_id: orgId,
      actor_id: session.user.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before,
      after,
    })
  } catch (err) {
    console.error('audit log failed:', err)
  }
}
