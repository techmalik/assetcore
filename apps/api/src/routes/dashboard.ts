import { Router } from 'express'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'

export const dashboardRouter = Router()
dashboardRouter.use(requireAuth, requireOrg, requireActiveMembership)

dashboardRouter.get('/dashboard/stats', async (req, res) => {
  const stats = await withOrgContext(claimsFromReq(req), async (c) => {
    const now = new Date().toISOString()
    const [{ rows: assets }, { rows: wos }, { rows: pm }] = await Promise.all([
      c.query('select status, health_score from public.assets where deleted_at is null'),
      c.query("select status, priority, sla_due from public.work_orders where deleted_at is null and status <> 'closed'"),
      c.query("select count(*)::int as count from public.pm_tasks where status = 'overdue'"),
    ])

    const byStatus: Record<string, number> = { operational: 0, attention: 0, critical: 0, offline: 0 }
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
        overdue: wos.filter((w) => w.sla_due && w.sla_due < now).length,
        critical: wos.filter((w) => w.priority === 'critical').length,
      },
      overduePM: pm[0]?.count ?? 0,
    }
  })
  res.json(stats)
})

// Merges four real signals into one feed: overdue PM tasks, licences expiring
// within 30 days, critical open work orders, and offline devices. Replaces
// the "Alerts coming in Phase 2" stub — every row here traces to a live query.
dashboardRouter.get('/dashboard/alerts', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), async (c) => {
    const [{ rows: pm }, { rows: lic }, { rows: wo }, { rows: dev }] = await Promise.all([
      c.query(
        `select t.id, t.title, t.due_date,
           case when a.id is null then null else a.name end as asset_name
         from public.pm_tasks t
         left join public.assets a on a.id = t.asset_id
         where t.status = 'overdue'
         order by t.due_date asc limit 10`
      ),
      c.query(
        `select cl.id, cl.name, cl.expiry_date
         from public.compliance_licences cl
         where cl.deleted_at is null and cl.expiry_date <= current_date + interval '30 days'
         order by cl.expiry_date asc limit 10`
      ),
      c.query(
        `select w.id, w.ref, w.title, w.sla_due
         from public.work_orders w
         where w.deleted_at is null and w.status <> 'closed' and w.priority = 'critical'
         order by w.created_at desc limit 10`
      ),
      c.query(
        `select d.id, d.name, d.last_seen_at
         from public.devices d
         where d.deleted_at is null and d.status = 'offline'
         order by d.last_seen_at asc nulls first limit 10`
      ),
    ])

    const alerts = [
      ...pm.map((t) => ({
        id: `pm-${t.id}`, severity: 'high', kind: 'pm_overdue',
        title: `PM overdue: ${t.title}`, subtitle: t.asset_name || null, at: t.due_date,
      })),
      ...lic.map((l) => {
        const expired = new Date(l.expiry_date) < new Date(new Date().toISOString().slice(0, 10))
        return {
          id: `lic-${l.id}`, severity: expired ? 'high' : 'medium', kind: expired ? 'licence_expired' : 'licence_expiring',
          title: `${expired ? 'Licence expired' : 'Licence expiring'}: ${l.name}`, subtitle: null, at: l.expiry_date,
        }
      }),
      ...wo.map((w) => ({
        id: `wo-${w.id}`, severity: 'critical', kind: 'wo_critical',
        title: `Critical WO: ${w.title}`, subtitle: w.ref, at: w.sla_due,
      })),
      ...dev.map((d) => ({
        id: `dev-${d.id}`, severity: 'medium', kind: 'device_offline',
        title: `Device offline: ${d.name}`, subtitle: null, at: d.last_seen_at,
      })),
    ]

    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity])
    return alerts
  })
  res.json(rows)
})

dashboardRouter.get('/dashboard/recent-work-orders', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select w.ref, w.title, w.status, w.priority, w.sla_due, w.updated_at,
         case when s.id is null then null else jsonb_build_object('name', s.name) end as site,
         case when u.id is null then null else jsonb_build_object('full_name', u.full_name) end as assignee
       from public.work_orders w
       left join public.sites s on s.id = w.site_id
       left join public.users u on u.id = w.assignee_id
       where w.deleted_at is null
       order by w.updated_at desc
       limit 5`
    ).then((r) => r.rows)
  )
  res.json(rows)
})
