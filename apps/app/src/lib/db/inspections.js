import { supabase } from '../supabase'
import { logAudit } from './audit'
import { getSession, getOrgRole } from '../auth'

export async function listInspections({ statuses, limit = 100 } = {}) {
  let q = supabase
    .from('inspections')
    .select('*, asset:assets(ain,name), site:sites(name,code), inspector:profiles!inspector_id(full_name)')
    .order('scheduled_date', { ascending: false })
    .limit(limit)
  if (statuses?.length) q = q.in('status', statuses)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createInspection(data) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { data: row, error } = await supabase
    .from('inspections')
    .insert({ ...data, org_id: orgId })
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'inspection.create', entityType: 'inspection', entityId: row.id, after: row })
  return row
}

export async function updateInspection(id, updates) {
  const payload = { ...updates }
  if (updates.status === 'completed' && !updates.completed_date) {
    payload.completed_date = new Date().toISOString().slice(0, 10)
  }
  const { data: row, error } = await supabase
    .from('inspections')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'inspection.update', entityType: 'inspection', entityId: id, after: row })
  return row
}
