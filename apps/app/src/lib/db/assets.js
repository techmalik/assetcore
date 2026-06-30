import { supabase } from '../supabase'
import { currentOrgId } from '../auth'
import { logAudit } from './audit'

// Canonical data-access module — copy this shape for every other entity
// (work orders, PM, inspections, compliance). Components call these helpers;
// they never inline Supabase queries.

const SELECT = '*, site:sites(id,name), category:asset_categories(id,name)'

export async function listAssets({ status } = {}) {
  let q = supabase
    .from('assets')
    .select(SELECT)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (status && status !== 'all') q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function getAsset(id) {
  const { data, error } = await supabase.from('assets').select(SELECT).eq('id', id).single()
  if (error) throw error
  return data
}

export async function createAsset(input) {
  const org_id = await currentOrgId()
  const { data, error } = await supabase
    .from('assets')
    .insert({ ...input, org_id })
    .select(SELECT)
    .single()
  if (error) throw error
  await logAudit({ action: 'asset.create', entityType: 'asset', entityId: data.id, after: data })
  return data
}

export async function updateAsset(id, patch) {
  const before = await getAsset(id)
  const { data, error } = await supabase
    .from('assets')
    .update(patch)
    .eq('id', id)
    .select(SELECT)
    .single()
  if (error) throw error
  await logAudit({ action: 'asset.update', entityType: 'asset', entityId: id, before, after: data })
  return data
}

export async function softDeleteAsset(id) {
  const { error } = await supabase
    .from('assets')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  await logAudit({ action: 'asset.delete', entityType: 'asset', entityId: id })
}
