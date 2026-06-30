import { supabase } from '../supabase'
import { getSession, getOrgRole } from '../auth'

export async function listReports({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('reports')
    .select('*, created_by_profile:profiles!created_by(full_name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function requestReport({ title, kind, format = 'pdf', params = {} }) {
  const session = await getSession()
  const { orgId } = getOrgRole(session)
  const { data: row, error } = await supabase
    .from('reports')
    .insert({ org_id: orgId, title, kind, format, params, status: 'pending', created_by: session.user.id })
    .select()
    .single()
  if (error) throw error
  return row
}

// Simulates a report completing (in production this would be an Edge Function callback)
export async function simulateReportReady(id) {
  const { data, error } = await supabase
    .from('reports')
    .update({ status: 'ready', completed_at: new Date().toISOString(), storage_path: `reports/${id}.pdf`, file_size_bytes: Math.floor(Math.random() * 3000000 + 500000) })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
