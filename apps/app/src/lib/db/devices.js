import { supabase } from '../supabase'
import { getSession, getOrgRole } from '../auth'
import { logAudit } from './audit'

export async function listDevices({ statuses } = {}) {
  let q = supabase
    .from('devices')
    .select('*, asset:assets(ain,name), site:sites(name,code)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (statuses?.length) q = q.in('status', statuses)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createDevice(data) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { data: row, error } = await supabase
    .from('devices')
    .insert({ ...data, org_id: orgId })
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'device.create', entityType: 'device', entityId: row.id, after: row })
  return row
}

export async function updateDevice(id, updates) {
  const { data: row, error } = await supabase
    .from('devices')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'device.update', entityType: 'device', entityId: id, after: row })
  return row
}

export async function softDeleteDevice(id) {
  const { error } = await supabase
    .from('devices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAudit({ action: 'device.delete', entityType: 'device', entityId: id })
}

export async function getLatestReadings(deviceId, limit = 10) {
  const { data, error } = await supabase
    .from('telemetry_readings')
    .select('*')
    .eq('device_id', deviceId)
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}
