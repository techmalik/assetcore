import { supabase } from '../supabase'
import { currentOrgId } from '../auth'
import { logAudit } from './audit'

const SELECT = `
  *,
  site:sites(id,name),
  asset:assets(id,ain,name),
  assignee:profiles!assignee_id(id,full_name,email),
  creator:profiles!created_by(id,full_name,email)
`

// Status transitions allowed per current status
export const WO_TRANSITIONS = {
  new:            ['assigned', 'in_progress', 'closed'],
  assigned:       ['in_progress', 'awaiting_parts', 'closed'],
  in_progress:    ['awaiting_parts', 'inspection', 'closed'],
  awaiting_parts: ['in_progress', 'closed'],
  inspection:     ['closed', 'in_progress'],
  closed:         [],
}

export const WO_STATUS_LABEL = {
  new:            'New',
  assigned:       'Assigned',
  in_progress:    'In Progress',
  awaiting_parts: 'Awaiting Parts',
  inspection:     'Inspection',
  closed:         'Closed',
}

export const WO_PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const WO_TYPE_LABEL = { corrective: 'Corrective', preventive: 'Preventive', inspection: 'Inspection', emergency: 'Emergency' }

export async function listWorkOrders({ status, priority } = {}) {
  let q = supabase
    .from('work_orders')
    .select(SELECT)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  if (priority) q = q.eq('priority', priority)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function getWorkOrder(id) {
  const { data, error } = await supabase
    .from('work_orders')
    .select(SELECT)
    .eq('id', id)
    .single()
  if (error) throw error

  const { data: activity } = await supabase
    .from('work_order_activity')
    .select('*, actor:profiles!user_id(id,full_name)')
    .eq('work_order_id', id)
    .order('created_at', { ascending: true })

  return { ...data, activity: activity || [] }
}

export async function createWorkOrder(input) {
  const org_id = await currentOrgId()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('work_orders')
    .insert({ ...input, org_id, created_by: user.id })
    .select(SELECT)
    .single()
  if (error) throw error
  await logAudit({ action: 'wo.create', entityType: 'work_order', entityId: data.id, after: data })
  return data
}

export async function updateWorkOrder(id, patch) {
  const { data, error } = await supabase
    .from('work_orders')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SELECT)
    .single()
  if (error) throw error
  await logAudit({ action: 'wo.update', entityType: 'work_order', entityId: id, after: patch })
  return data
}

export async function transitionWorkOrder(id, newStatus, comment = '') {
  const org_id = await currentOrgId()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: wo, error: fetchErr } = await supabase
    .from('work_orders').select('status').eq('id', id).single()
  if (fetchErr) throw fetchErr

  const allowed = WO_TRANSITIONS[wo.status] || []
  if (!allowed.includes(newStatus)) throw new Error(`Cannot transition from ${wo.status} to ${newStatus}`)

  const { data, error } = await supabase
    .from('work_orders')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SELECT)
    .single()
  if (error) throw error

  // Activity log entry
  await supabase.from('work_order_activity').insert({
    org_id,
    work_order_id: id,
    user_id: user.id,
    kind: 'status_change',
    body: comment || `Status changed to ${WO_STATUS_LABEL[newStatus]}`,
  })

  await logAudit({ action: 'wo.transition', entityType: 'work_order', entityId: id,
    before: { status: wo.status }, after: { status: newStatus } })
  return data
}

export async function addWorkOrderComment(workOrderId, body) {
  const org_id = await currentOrgId()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('work_order_activity')
    .insert({ org_id, work_order_id: workOrderId, user_id: user.id, kind: 'comment', body })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function softDeleteWorkOrder(id) {
  const { error } = await supabase
    .from('work_orders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAudit({ action: 'wo.delete', entityType: 'work_order', entityId: id })
}
