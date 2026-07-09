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
