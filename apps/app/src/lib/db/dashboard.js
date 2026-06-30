import { supabase } from '../supabase'

export async function getDashboardStats() {
  const now = new Date().toISOString()

  const [
    { data: assetRows },
    { data: woRows },
    { count: overduePM },
  ] = await Promise.all([
    supabase
      .from('assets')
      .select('status, health_score')
      .is('deleted_at', null),
    supabase
      .from('work_orders')
      .select('status, priority, sla_due')
      .is('deleted_at', null)
      .neq('status', 'closed'),
    supabase
      .from('pm_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'overdue'),
  ])

  const assets = assetRows || []
  const wos = woRows || []

  const byStatus = { operational: 0, attention: 0, critical: 0, offline: 0 }
  let healthSum = 0
  for (const a of assets) {
    if (a.status in byStatus) byStatus[a.status]++
    if (a.health_score != null) healthSum += a.health_score
  }

  return {
    assets: {
      total: assets.length,
      ...byStatus,
      avgHealth: assets.length ? Math.round(healthSum / assets.length) : 0,
    },
    wos: {
      open: wos.length,
      overdue: wos.filter(w => w.sla_due && w.sla_due < now).length,
      critical: wos.filter(w => w.priority === 'critical').length,
    },
    overduePM: overduePM || 0,
  }
}

export async function getRecentWorkOrders() {
  const SELECT = `
    ref, title, status, priority, sla_due, updated_at,
    site:sites(name),
    assignee:profiles!assignee_id(full_name)
  `
  const { data, error } = await supabase
    .from('work_orders')
    .select(SELECT)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return data || []
}
