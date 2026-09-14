import { Router } from 'express'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { hasCap } from '../middleware/rbac.js'

export const integrityRouter = Router()
integrityRouter.use(requireAuth, requireOrg, requireActiveMembership)

// Integrity is where inspections and risk assessments meet: one asks "what
// condition is it in", the other "what happens if it fails". Neither answers
// "is this asset sound?" on its own, so this rolls both — plus the defects an
// inspection raised — into one status per asset.
//
// The status is the worst thing true about the asset, not an average. An
// asset with a failed inspection and a clean risk register is not "fair".
export const INTEGRITY_STATUSES = ['critical', 'at_risk', 'watch', 'sound', 'unassessed'] as const
type IntegrityStatus = typeof INTEGRITY_STATUSES[number]

// An inspection older than this no longer vouches for the asset.
const STALE_INSPECTION_DAYS = 365

type AssetRow = {
  id: string
  ain: string
  name: string
  status: string
  criticality: string | null
  site: { id: string; name: string; status?: string } | null
  last_inspection_date: string | null
  last_condition_rating: number | null
  next_inspection_date: string | null
  overdue_inspections: number
  max_risk_score: number | null
  open_risks: number
  open_defects: number
  critical_defects: number
  major_defects: number
}

function daysSince(date: string | null): number | null {
  if (!date) return null
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

export function integrityStatusOf(a: AssetRow, opts: { risks: boolean; inspections: boolean; defects: boolean }): { status: IntegrityStatus; reasons: string[] } {
  const reasons: string[] = []
  const score = opts.risks ? a.max_risk_score : null
  const rating = opts.inspections ? a.last_condition_rating : null
  const age = opts.inspections ? daysSince(a.last_inspection_date) : null

  const critical: string[] = []
  if (score != null && score >= 16) critical.push('Extreme risk open')
  if (opts.defects && a.critical_defects > 0) critical.push(`${a.critical_defects} critical defect${a.critical_defects === 1 ? '' : 's'} open`)
  if (rating === 1) critical.push('Last inspection rated Failed')
  if (critical.length) return { status: 'critical', reasons: critical }

  if (score != null && score >= 11) reasons.push('High risk open')
  if (opts.defects && a.major_defects > 0) reasons.push(`${a.major_defects} major defect${a.major_defects === 1 ? '' : 's'} open`)
  if (opts.inspections && a.overdue_inspections > 0) reasons.push('Inspection overdue')
  if (rating === 2) reasons.push('Last inspection rated Poor')
  if (reasons.length) return { status: 'at_risk', reasons }

  if (score != null && score >= 6) reasons.push('Medium risk open')
  if (opts.defects && a.open_defects > 0) reasons.push(`${a.open_defects} defect${a.open_defects === 1 ? '' : 's'} open`)
  if (rating === 3) reasons.push('Last inspection rated Fair')
  if (age != null && age > STALE_INSPECTION_DAYS) reasons.push('Not inspected in over a year')
  if (reasons.length) return { status: 'watch', reasons }

  // Nothing wrong has been found — but "nobody has looked" is not the same
  // claim as "somebody looked and it was fine".
  const assessed = (opts.inspections && a.last_inspection_date) || (opts.risks && a.max_risk_score != null)
  if (!assessed) return { status: 'unassessed', reasons: ['No inspection or risk assessment on record'] }
  return { status: 'sound', reasons: [] }
}

integrityRouter.get('/integrity/overview', async (req, res) => {
  const canInspections = hasCap(req, 'inspection:read')
  const canRisks = hasCap(req, 'risk:read')
  const canDefects = hasCap(req, 'defect:read')
  if (!canInspections && !canRisks && !canDefects) {
    return res.status(403).json({ error: 'forbidden', capability: 'inspection:read' })
  }

  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const locSites = 'select id from public.sites where location_id = $1'
  const params = locationId ? [locationId] : []

  const data = await withOrgContext(claimsFromReq(req), async (c) => {
    const [{ rows: assets }, { rows: insp }, { rows: risks }, { rows: defects }] = await Promise.all([
      // One row per asset, with its latest completed inspection and the
      // aggregates behind the status. Lateral joins keep each aggregate on its
      // own table, so an asset with three risks and two defects does not come
      // back as six rows.
      c.query(
        `select a.id, a.ain, a.name, a.status, a.criticality,
           case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'status', to_jsonb(s)->>'status') end as site,
           li.completed_date as last_inspection_date,
           li.condition_rating as last_condition_rating,
           ni.next_date as next_inspection_date,
           coalesce(ni.overdue, 0)::int as overdue_inspections,
           rk.max_score as max_risk_score,
           coalesce(rk.open_count, 0)::int as open_risks,
           coalesce(df.open_count, 0)::int as open_defects,
           coalesce(df.critical_count, 0)::int as critical_defects,
           coalesce(df.major_count, 0)::int as major_defects
         from public.assets a
         left join public.sites s on s.id = a.site_id
         left join lateral (
           select i.completed_date, i.condition_rating
           from public.inspections i
           where i.asset_id = a.id and i.status = 'completed'
           order by i.completed_date desc nulls last, i.updated_at desc
           limit 1
         ) li on true
         left join lateral (
           select min(i.scheduled_date) as next_date,
             count(*) filter (where i.status = 'overdue' or i.scheduled_date < current_date) as overdue
           from public.inspections i
           where i.asset_id = a.id and i.status <> 'completed'
         ) ni on true
         left join lateral (
           select max(coalesce(r.residual_score, r.inherent_score)) as max_score, count(*) as open_count
           from public.risk_assessments r
           where r.asset_id = a.id and r.deleted_at is null and r.status in ('open', 'mitigating')
         ) rk on true
         left join lateral (
           select count(*) as open_count,
             count(*) filter (where d.severity = 'critical') as critical_count,
             count(*) filter (where d.severity = 'major') as major_count
           from public.defects d
           where d.asset_id = a.id and d.deleted_at is null
             and d.status in ('open', 'acknowledged', 'in_progress', 'deferred')
         ) df on true
         where a.deleted_at is null ${locationId ? `and a.site_id in (${locSites})` : ''}
         order by a.ain`,
        params
      ),
      canInspections
        ? c.query(
            `select
               count(*) filter (where status = 'scheduled' and scheduled_date >= current_date)::int as scheduled,
               count(*) filter (where status in ('due', 'in_progress'))::int as in_progress,
               count(*) filter (where status <> 'completed' and (status = 'overdue' or scheduled_date < current_date))::int as overdue,
               count(*) filter (where status = 'completed' and completed_date >= current_date - 90)::int as completed_90d,
               round(avg(condition_rating) filter (where status = 'completed' and completed_date >= current_date - 365), 1) as avg_condition
             from public.inspections
             where true ${locationId ? `and site_id in (${locSites})` : ''}`,
            params
          )
        : Promise.resolve({ rows: [null] }),
      canRisks
        ? c.query(
            `select
               count(*) filter (where public.risk_band(coalesce(residual_score, inherent_score)) = 'extreme')::int as extreme,
               count(*) filter (where public.risk_band(coalesce(residual_score, inherent_score)) = 'high')::int as high,
               count(*) filter (where public.risk_band(coalesce(residual_score, inherent_score)) = 'medium')::int as medium,
               count(*) filter (where public.risk_band(coalesce(residual_score, inherent_score)) = 'low')::int as low,
               count(*) filter (where review_date < current_date)::int as review_overdue
             from public.risk_assessments
             where deleted_at is null and status in ('open', 'mitigating')
               ${locationId ? `and site_id in (${locSites})` : ''}`,
            params
          )
        : Promise.resolve({ rows: [null] }),
      canDefects
        ? c.query(
            `select
               count(*)::int as open,
               count(*) filter (where severity = 'critical')::int as critical,
               count(*) filter (where severity = 'major')::int as major
             from public.defects
             where deleted_at is null and status in ('open', 'acknowledged', 'in_progress', 'deferred')
               ${locationId ? `and site_id in (${locSites})` : ''}`,
            params
          )
        : Promise.resolve({ rows: [null] }),
    ])

    const opts = { risks: canRisks, inspections: canInspections, defects: canDefects }
    const counts: Record<IntegrityStatus, number> = { critical: 0, at_risk: 0, watch: 0, sound: 0, unassessed: 0 }
    const rows = (assets as AssetRow[]).map((a) => {
      const { status, reasons } = integrityStatusOf(a, opts)
      counts[status]++
      // Withhold what the caller cannot read rather than sending it and
      // trusting the page not to show it.
      return {
        ...a,
        max_risk_score: canRisks ? a.max_risk_score : null,
        open_risks: canRisks ? a.open_risks : null,
        open_defects: canDefects ? a.open_defects : null,
        critical_defects: canDefects ? a.critical_defects : null,
        major_defects: canDefects ? a.major_defects : null,
        last_inspection_date: canInspections ? a.last_inspection_date : null,
        last_condition_rating: canInspections ? a.last_condition_rating : null,
        next_inspection_date: canInspections ? a.next_inspection_date : null,
        overdue_inspections: canInspections ? a.overdue_inspections : null,
        integrity_status: status,
        reasons,
      }
    })

    return {
      counts,
      inspections: insp[0],
      risks: risks[0],
      defects: defects[0],
      assets: rows,
    }
  })
  res.json(data)
})
