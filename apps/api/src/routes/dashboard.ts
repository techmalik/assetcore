import { Router } from 'express'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { hasCap } from '../middleware/rbac.js'

export const dashboardRouter = Router()
dashboardRouter.use(requireAuth, requireOrg, requireActiveMembership)

dashboardRouter.get('/dashboard/stats', async (req, res) => {
  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const stats = await withOrgContext(claimsFromReq(req), async (c) => {
    const now = new Date().toISOString()
    // EPIC-2 global location filter: same site_id-in-location-subquery
    // translation the list pages use, applied identically across all three
    // queries so every KPI/donut/alert stays consistent with one active
    // location instead of some cards silently ignoring it.
    const locClause = locationId ? 'and site_id in (select id from public.sites where location_id = $1)' : ''
    const locParams = locationId ? [locationId] : []
    // Each module's card is withheld (null) when the caller cannot read that
    // module, so the dashboard never shows a count the linked page would 403.
    const canDefects = hasCap(req, 'defect:read')
    const canRisks = hasCap(req, 'risk:read')
    const canCompliance = hasCap(req, 'compliance:read')
    const canBookValue = hasCap(req, 'depreciation:read')
    const skip = Promise.resolve({ rows: [] as Record<string, unknown>[] })

    const [{ rows: assets }, { rows: wos }, { rows: pm }, { rows: mine }, { rows: defects }, { rows: risks }, { rows: licences }] = await Promise.all([
      // Geotagged follows the map's rule (analytics.ts position_source): an
      // asset with no fix of its own is still placed at its site's.
      // End of life is start date + useful life, resolved asset → category →
      // org policy → 10 years, the same fallback chain the depreciation
      // engine uses (0022), so the two pages agree on how long an asset lasts.
      c.query(
        `select a.status, a.health_score, a.purchase_value_cents, a.nbv_cents,
           (coalesce(a.lat, s.lat) is not null and coalesce(a.lng, s.lng) is not null) as geotagged,
           case when coalesce(a.install_date, a.purchase_date) is null then null
             else (coalesce(a.install_date, a.purchase_date)
                   + make_interval(months => round(12 * coalesce(a.useful_life_years, cat.useful_life_years,
                       nullif(o.settings->'depreciation'->>'usefulLifeYears', '')::numeric, 10))::int))::date
           end as end_of_life,
           a.lifecycle_status
         from public.assets a
         join public.organizations o on o.id = a.org_id
         left join public.sites s on s.id = a.site_id
         left join public.asset_categories cat on cat.id = a.category_id
         where a.deleted_at is null ${locationId ? 'and a.site_id in (select id from public.sites where location_id = $1)' : ''}`,
        locParams
      ),
      c.query(`select status, priority, sla_due from public.work_orders where deleted_at is null and status <> 'closed' ${locClause}`, locParams),
      c.query(`select count(*)::int as count from public.pm_tasks where status = 'overdue' ${locClause}`, locParams),
      // "My Open Work" — everything currently assigned to the caller across
      // all three activity types, regardless of the location filter above
      // (it's the caller's own work, not a location-scoped aggregate).
      c.query(`
        select
          (select count(*)::int from public.work_orders
           where deleted_at is null and assignee_id = current_user_id() and status not in ('draft','closed')) as wos,
          (select count(*)::int from public.pm_tasks
           where assignee_id = current_user_id() and status in ('pending','in_progress','overdue')) as pm_tasks,
          (select count(*)::int from public.inspections
           where inspector_id = current_user_id() and status in ('scheduled','due','in_progress')) as inspections
      `),
      canDefects
        ? c.query(
            `select count(*)::int as open, count(*) filter (where severity = 'critical')::int as critical
             from public.defects
             where deleted_at is null and status in ('open','acknowledged','in_progress','deferred') ${locClause}`,
            locParams
          )
        : skip,
      // "High risk" is the current band — residual when controls have been
      // rated, inherent otherwise — matching the Risk page's own stats.
      canRisks
        ? c.query(
            `select count(distinct asset_id)::int as assets, count(*)::int as risks
             from public.risk_assessments
             where deleted_at is null and status in ('open','mitigating')
               and coalesce(residual_score, inherent_score) >= 11 ${locClause}`,
            locParams
          )
        : skip,
      // Same buckets as /compliance-licences/counts: anything not yet expired
      // is in force; expiring inside 30 days is an alert.
      canCompliance
        ? c.query(
            `select count(*) filter (where expiry_date >= current_date)::int as active,
               count(*) filter (where expiry_date < current_date + 30)::int as alerts
             from public.compliance_licences
             where deleted_at is null ${locationId ? 'and (site_id is null or site_id in (select id from public.sites where location_id = $1))' : ''}`,
            locParams
          )
        : skip,
    ])

    const byStatus: Record<string, number> = { operational: 0, attention: 0, critical: 0, offline: 0, inactive: 0 }
    const today = new Date(new Date().toISOString().slice(0, 10))
    const eolHorizon = new Date(today); eolHorizon.setFullYear(today.getFullYear() + 2)
    let geotagged = 0, valueCents = 0, nbvCents = 0, nbvKnown = 0, nearingEol = 0, pastEol = 0
    // Health-band counts for the dashboard's health donut/legend, per the
    // >50 good / 31-50 attention / <=30 critical spec (apps/app/src/lib/health.js
    // is the canonical source of these thresholds - kept in lockstep here).
    // Offline assets get their own bucket regardless of health_score, same as
    // the asset list's own status display; every other asset lands in
    // exactly one of the three health bands, so the four counts sum to total.
    // A null health_score counts as 0 (critical), matching how the asset
    // list and detail panel already render a missing score everywhere else.
    const healthBands = { good: 0, attention: 0, critical: 0, offline: 0 }
    let healthSum = 0
    for (const a of assets) {
      if (a.status in byStatus) byStatus[a.status]++
      if (a.health_score != null) healthSum += a.health_score
      if (a.geotagged) geotagged++
      if (a.purchase_value_cents != null) valueCents += Number(a.purchase_value_cents)
      if (a.nbv_cents != null) { nbvCents += Number(a.nbv_cents); nbvKnown++ }
      // A disposed asset has already reached the end of its life by other
      // means; counting it as "nearing" would never clear.
      if (a.end_of_life && a.lifecycle_status !== 'disposed') {
        const eol = new Date(a.end_of_life)
        if (eol < today) pastEol++
        else if (eol <= eolHorizon) nearingEol++
      }
      // An asset at a shut-down site is inactive, not unhealthy — it sits with
      // offline outside the health bands rather than dragging "critical" up.
      if (a.status === 'offline' || a.status === 'inactive') {
        healthBands.offline++
      } else {
        const h = a.health_score ?? 0
        if (h > 50) healthBands.good++
        else if (h > 30) healthBands.attention++
        else healthBands.critical++
      }
    }

    return {
      assets: {
        total: assets.length,
        ...byStatus,
        active: assets.length - byStatus.offline - byStatus.inactive,
        geotagged,
        healthBands,
        avgHealth: assets.length ? Math.round(healthSum / assets.length) : 0,
        nearingEol,
        pastEol,
      },
      portfolio: {
        valueCents,
        // Null, not zero, when book value is not the caller's to see or no
        // asset has one — "₦0 book value" would be a confident, wrong claim.
        nbvCents: canBookValue && nbvKnown > 0 ? nbvCents : null,
      },
      defects: canDefects ? defects[0] : null,
      risks: canRisks ? { highAssets: risks[0]?.assets ?? 0, highRisks: risks[0]?.risks ?? 0 } : null,
      licences: canCompliance ? licences[0] : null,
      wos: {
        open: wos.length,
        overdue: wos.filter((w) => w.sla_due && w.sla_due < now).length,
        critical: wos.filter((w) => w.priority === 'critical').length,
      },
      overduePM: pm[0]?.count ?? 0,
      myWork: (mine[0]?.wos ?? 0) + (mine[0]?.pm_tasks ?? 0) + (mine[0]?.inspections ?? 0),
    }
  })
  res.json(stats)
})

// Merges four real signals into one feed: overdue PM tasks, licences expiring
// within 30 days, critical open work orders, and offline devices. Replaces
// the "Alerts coming in Phase 2" stub — every row here traces to a live query.
dashboardRouter.get('/dashboard/alerts', async (req, res) => {
  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const rows = await withOrgContext(claimsFromReq(req), async (c) => {
    const locSites = 'select id from public.sites where location_id = $1'
    const [{ rows: pm }, { rows: lic }, { rows: wo }, { rows: dev }] = await Promise.all([
      c.query(
        `select t.id, t.title, t.due_date,
           case when a.id is null then null else a.name end as asset_name
         from public.pm_tasks t
         left join public.assets a on a.id = t.asset_id
         where t.status = 'overdue' ${locationId ? `and t.site_id in (${locSites})` : ''}
         order by t.due_date asc limit 10`,
        locationId ? [locationId] : []
      ),
      c.query(
        `select cl.id, cl.name, cl.expiry_date
         from public.compliance_licences cl
         where cl.deleted_at is null and cl.expiry_date <= current_date + interval '30 days'
           ${locationId ? `and (cl.site_id is null or cl.site_id in (${locSites}))` : ''}
         order by cl.expiry_date asc limit 10`,
        locationId ? [locationId] : []
      ),
      c.query(
        `select w.id, w.ref, w.title, w.sla_due
         from public.work_orders w
         where w.deleted_at is null and w.status <> 'closed' and w.priority = 'critical'
           ${locationId ? `and w.site_id in (${locSites})` : ''}
         order by w.created_at desc limit 10`,
        locationId ? [locationId] : []
      ),
      c.query(
        `select d.id, d.name, d.last_seen_at
         from public.devices d
         where d.deleted_at is null and d.status = 'offline'
           ${locationId ? `and d.site_id in (${locSites})` : ''}
         order by d.last_seen_at asc nulls first limit 10`,
        locationId ? [locationId] : []
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
  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const locClause = locationId ? 'and w.site_id in (select id from public.sites where location_id = $1)' : ''
  const locParams = locationId ? [locationId] : []
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select w.ref, w.title, w.status, w.priority, w.sla_due, w.updated_at,
         case when s.id is null then null else jsonb_build_object('name', s.name) end as site,
         case when u.id is null then null else jsonb_build_object('full_name', u.full_name) end as assignee
       from public.work_orders w
       left join public.sites s on s.id = w.site_id
       left join public.users u on u.id = w.assignee_id
       where w.deleted_at is null ${locClause}
       order by w.updated_at desc
       limit 5`,
      locParams
    ).then((r) => r.rows)
  )
  res.json(rows)
})
