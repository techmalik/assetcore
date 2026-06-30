import { supabase } from '../supabase'
import { logAudit } from './audit'

export async function listPMTasks({ statuses, dueBefore, dueAfter, limit = 100 } = {}) {
  let q = supabase
    .from('pm_tasks')
    .select('*, asset:assets(ain,name), site:sites(name,code), assignee:profiles!assignee_id(full_name), schedule:pm_schedules(title,frequency)')
    .order('due_date', { ascending: true })
    .limit(limit)
  if (statuses?.length) q = q.in('status', statuses)
  if (dueBefore) q = q.lte('due_date', dueBefore)
  if (dueAfter)  q = q.gte('due_date', dueAfter)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function updatePMTask(id, updates) {
  const payload = { ...updates }
  if (updates.status === 'completed' && !updates.completed_at) {
    payload.completed_at = new Date().toISOString()
  }
  const { data: row, error } = await supabase
    .from('pm_tasks')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  if (updates.status === 'completed') {
    await logAudit({ action: 'pm_task.complete', entityType: 'pm_task', entityId: id, after: row })
  }
  return row
}

export async function generatePMTasks() {
  const { data, error } = await supabase.rpc('generate_pm_tasks')
  if (error) throw error
  return data
}
