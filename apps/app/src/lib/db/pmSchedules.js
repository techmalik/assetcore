import { supabase } from '../supabase'
import { logAudit } from './audit'
import { getSession, getOrgRole } from '../auth'

export async function listPMSchedules({ activeOnly = true } = {}) {
  let q = supabase
    .from('pm_schedules')
    .select('*, asset:assets(ain,name), site:sites(name,code), assignee:profiles!assignee_id(full_name)')
    .is('deleted_at', null)
    .order('next_due', { ascending: true })
  if (activeOnly) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createPMSchedule(data) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { data: row, error } = await supabase
    .from('pm_schedules')
    .insert({ ...data, org_id: orgId })
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'pm_schedule.create', entityType: 'pm_schedule', entityId: row.id, after: row })
  return row
}

export async function updatePMSchedule(id, updates) {
  const { data: row, error } = await supabase
    .from('pm_schedules')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'pm_schedule.update', entityType: 'pm_schedule', entityId: id, after: row })
  return row
}

export async function softDeletePMSchedule(id) {
  const { error } = await supabase
    .from('pm_schedules')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', id)
  if (error) throw error
  await logAudit({ action: 'pm_schedule.archive', entityType: 'pm_schedule', entityId: id })
}
