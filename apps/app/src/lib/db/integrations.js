import { supabase } from '../supabase'
import { getSession, getOrgRole } from '../auth'

export async function listIntegrations() {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .order('kind')
  if (error) throw error
  return data || []
}

export async function getIntegration(kind) {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('kind', kind)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function upsertIntegration(kind, { label, config, enabled }) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { data, error } = await supabase
    .from('integrations')
    .upsert({
      org_id: orgId,
      kind,
      label,
      config,
      enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,kind' })
    .select()
    .single()
  if (error) throw error
  return data
}

// Stub: in production this would invoke an Edge Function
export async function triggerSync(kind) {
  const row = await getIntegration(kind)
  if (!row) throw new Error('Integration not configured')
  // Mark last_synced_at so the UI reflects a sync was attempted
  const { data, error } = await supabase
    .from('integrations')
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: 'ok',
      last_sync_error: null,
    })
    .eq('id', row.id)
    .select()
    .single()
  if (error) throw error
  return data
}
