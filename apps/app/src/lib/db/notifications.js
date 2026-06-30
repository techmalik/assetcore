import { supabase } from '../supabase'
import { getSession, getOrgRole } from '../auth'

export async function listNotifications({ limit = 60 } = {}) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function countUnread() {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('read', false)
  if (error) throw error
  return count || 0
}

export async function markRead(id) {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
  if (error) throw error
}

export async function markAllRead() {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('read', false)
  if (error) throw error
}

export async function getPreferences() {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
  if (error) throw error
  return data || []
}

export async function upsertPreference({ kind, in_app, email }) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(
      { org_id: orgId, user_id: session.user.id, kind, in_app, email },
      { onConflict: 'org_id,user_id,kind' }
    )
  if (error) throw error
}
