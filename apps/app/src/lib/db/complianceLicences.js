import { supabase } from '../supabase'
import { logAudit } from './audit'
import { getSession, getOrgRole } from '../auth'

export async function listComplianceLicences() {
  const { data, error } = await supabase
    .from('compliance_licences')
    .select('*, authority:regulatory_authorities(name,code), site:sites(name,code), asset:assets(ain,name)')
    .is('deleted_at', null)
    .order('expiry_date', { ascending: true })
  if (error) throw error
  return (data || []).map(row => ({
    ...row,
    status: licenceStatus(row.expiry_date),
  }))
}

export async function getComplianceLicenceCounts() {
  const { data, error } = await supabase
    .from('compliance_licences')
    .select('expiry_date')
    .is('deleted_at', null)
  if (error) throw error
  const today = new Date(); today.setHours(0,0,0,0)
  const d30 = new Date(today); d30.setDate(today.getDate()+30)
  const d90 = new Date(today); d90.setDate(today.getDate()+90)
  let active=0, dueSoon=0, expiring=0, expired=0
  for (const row of data || []) {
    const exp = new Date(row.expiry_date)
    if (exp < today) expired++
    else if (exp < d30) expiring++
    else if (exp < d90) dueSoon++
    else active++
  }
  return { active, dueSoon, expiring, expired, total: (data||[]).length }
}

export async function createComplianceLicence(data) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { data: row, error } = await supabase
    .from('compliance_licences')
    .insert({ ...data, org_id: orgId, created_by: session.user.id })
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'compliance_licence.create', entityType: 'compliance_licence', entityId: row.id, after: row })
  return row
}

export async function updateComplianceLicence(id, updates) {
  const { data: row, error } = await supabase
    .from('compliance_licences')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'compliance_licence.update', entityType: 'compliance_licence', entityId: id, after: row })
  return row
}

export async function softDeleteComplianceLicence(id) {
  const { error } = await supabase
    .from('compliance_licences')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAudit({ action: 'compliance_licence.archive', entityType: 'compliance_licence', entityId: id })
}

export async function listAuthorities() {
  const { data, error } = await supabase
    .from('regulatory_authorities')
    .select('id,name,code')
    .order('code')
  if (error) throw error
  return data || []
}

export async function checkLicenceExpiry() {
  const { data, error } = await supabase.rpc('check_licence_expiry')
  if (error) throw error
  return data
}

// Client-side status helper (mirrors the DB function)
export function licenceStatus(expiryDate) {
  const exp = new Date(expiryDate); exp.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  const diff = Math.floor((exp - now) / 86400000)
  if (diff < 0)  return 'expired'
  if (diff < 30) return 'expiring'
  if (diff < 90) return 'due_soon'
  return 'active'
}

export function daysUntilExpiry(expiryDate) {
  const exp = new Date(expiryDate); exp.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  return Math.floor((exp - now) / 86400000)
}
