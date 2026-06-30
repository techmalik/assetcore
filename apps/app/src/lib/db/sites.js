import { supabase } from '../supabase'
import { logAudit } from './audit'

export async function listSites() {
  const { data, error } = await supabase
    .from('sites')
    .select('*')
    .is('deleted_at', null)
    .order('name')
  if (error) throw error
  return data
}

export async function createSite(input) {
  const { data, error } = await supabase
    .from('sites')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'site.create', entityType: 'site', entityId: data.id, after: data })
  return data
}

export async function updateSite(id, patch) {
  const { data, error } = await supabase
    .from('sites')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'site.update', entityType: 'site', entityId: id, after: patch })
  return data
}

export async function softDeleteSite(id) {
  const { error } = await supabase
    .from('sites')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAudit({ action: 'site.delete', entityType: 'site', entityId: id })
}
