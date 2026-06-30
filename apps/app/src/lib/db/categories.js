import { supabase } from '../supabase'
import { logAudit } from './audit'

export async function listCategories() {
  const { data, error } = await supabase
    .from('asset_categories')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export async function createCategory(input) {
  const { data, error } = await supabase
    .from('asset_categories')
    .insert(input)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'category.create', entityType: 'asset_category', entityId: data.id, after: data })
  return data
}

export async function updateCategory(id, patch) {
  const { data, error } = await supabase
    .from('asset_categories')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  await logAudit({ action: 'category.update', entityType: 'asset_category', entityId: id, after: patch })
  return data
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('asset_categories').delete().eq('id', id)
  if (error) throw error
  await logAudit({ action: 'category.delete', entityType: 'asset_category', entityId: id })
}
