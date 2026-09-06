import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'
import { refreshAssetHealth } from '../healthService.js'

export const risksRouter = Router()
risksRouter.use(requireAuth, requireOrg, requireActiveMembership)

export const RISK_CATEGORIES = ['safety', 'environmental', 'operational', 'financial', 'compliance', 'security'] as const
export const RISK_STATUSES = ['open', 'mitigating', 'accepted', 'closed'] as const
/** A risk that is still live and therefore still counts. */
const LIVE_STATUSES = ['open', 'mitigating', 'accepted']

const ALLOWED = [
  'asset_id', 'site_id', 'title', 'description', 'category',
  'likelihood', 'consequence', 'controls',
  'residual_likelihood', 'residual_consequence',
  'owner_id', 'review_date', 'status',
]

// inherent_score and residual_score are generated columns — they are read, never
// written, so they are deliberately absent from ALLOWED above.
const SELECT = `
  select r.*,
    public.risk_band(r.inherent_score) as inherent_band,
    public.risk_band(coalesce(r.residual_score, r.inherent_score)) as current_band,
    coalesce(r.residual_score, r.inherent_score) as current_score,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when o.id is null then null else jsonb_build_object('id', o.id, 'full_name', o.full_name) end as owner
  from public.risk_assessments r
  left join public.assets a on a.id = r.asset_id
  left join public.sites s on s.id = r.site_id
  left join public.users o on o.id = r.owner_id
`

const dateField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'expected YYYY-MM-DD' })

const cell = z.number().int().min(1).max(5)

const riskInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().nullable().optional(),
  category: z.enum(RISK_CATEGORIES).optional(),
  likelihood: cell,
  consequence: cell,
  controls: z.string().nullable().optional(),
  residual_likelihood: cell.nullable().optional(),
  residual_consequence: cell.nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  review_date: dateField,
  status: z.enum(RISK_STATUSES).optional(),
})

/** RSK-{year}-{4 digits}, matching the work order and defect ref formats. */
async function generateRiskRef(c: import('pg').PoolClient): Promise<string> {
  const year = new Date().getFullYear()
  const { rows } = await c.query('select count(*)::int as n from public.risk_assessments where ref like $1', [`RSK-${year}-%`])
  return `RSK-${year}-${String(rows[0].n + 1).padStart(4, '0')}`
}

/** A residual rating is only meaningful as a pair; half of one describes
 * nothing, and the generated column would be null anyway. */
function residualIsHalfSet(d: { residual_likelihood?: number | null; residual_consequence?: number | null }): boolean {
  const l = d.residual_likelihood
  const c = d.residual_consequence
  if (l === undefined && c === undefined) return false
  return (l == null) !== (c == null)
}

const qp = (req: { query: Record<string, unknown> }, key: string): string | null => {
  const v = req.query[key]
  return typeof v === 'string' && v !== '' && v !== 'all' ? v : null
}

risksRouter.get('/risks', requireCap('risk:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where r.deleted_at is null']
    const values: unknown[] = []
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('$?', `$${values.length}`)) }

    const status = qp(req, 'status')
    if (status) add('and r.status = $?', status)
    if (req.query.live === 'true') { values.push(LIVE_STATUSES); clauses.push(`and r.status = any($${values.length})`) }
    const category = qp(req, 'category')
    if (category) add('and r.category = $?', category)
    const assetId = qp(req, 'asset_id')
    if (assetId) add('and r.asset_id = $?', assetId)
    const band = qp(req, 'band')
    if (band) add('and public.risk_band(coalesce(r.residual_score, r.inherent_score)) = $?', band)
    if (req.query.due_review === 'true') {
      clauses.push("and r.review_date is not null and r.review_date <= current_date and r.status <> 'closed'")
    }
    const q = qp(req, 'q')
    if (q) {
      values.push(`%${q}%`)
      clauses.push(`and (r.ref ilike $${values.length} or r.title ilike $${values.length} or r.description ilike $${values.length})`)
    }

    // Worst current risk first — the register is read top-down.
    clauses.push('order by coalesce(r.residual_score, r.inherent_score) desc, r.created_at desc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

/**
 * The 5x5 grid itself: one cell per (likelihood, consequence) with the risks
 * sitting in it.
 *
 * Built here rather than in the browser so the grid and the register can never
 * disagree about which cell something is in, and so the page can render 25
 * cells from one request instead of bucketing the whole register client-side.
 */
risksRouter.get('/risks/matrix', requireCap('risk:read'), async (req, res) => {
  // Which rating the grid plots: what the risk is now (residual where it
  // exists) or what it would be with no controls at all.
  const basis = req.query.basis === 'inherent' ? 'inherent' : 'current'
  const likelihoodExpr = basis === 'inherent' ? 'r.likelihood' : 'coalesce(r.residual_likelihood, r.likelihood)'
  const consequenceExpr = basis === 'inherent' ? 'r.consequence' : 'coalesce(r.residual_consequence, r.consequence)'

  const payload = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `select ${likelihoodExpr} as likelihood, ${consequenceExpr} as consequence,
         count(*)::int as n,
         jsonb_agg(jsonb_build_object(
           'id', r.id, 'ref', r.ref, 'title', r.title, 'category', r.category, 'status', r.status
         ) order by r.ref) as risks
       from public.risk_assessments r
       where r.deleted_at is null and r.status = any($1)
       group by 1, 2`,
      [LIVE_STATUSES]
    )

    // Fill all 25 cells, so an empty grid still reads as a matrix rather than
    // as a page that failed to load.
    const cells = []
    for (let consequence = 5; consequence >= 1; consequence--) {
      for (let likelihood = 1; likelihood <= 5; likelihood++) {
        const hit = rows.find((r) => r.likelihood === likelihood && r.consequence === consequence)
        const score = likelihood * consequence
        cells.push({
          likelihood,
          consequence,
          score,
          band: score >= 16 ? 'extreme' : score >= 11 ? 'high' : score >= 6 ? 'medium' : 'low',
          count: hit?.n ?? 0,
          risks: hit?.risks ?? [],
        })
      }
    }
    return { basis, cells }
  })
  res.json(payload)
})

risksRouter.get('/risks/stats', requireCap('risk:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select
         count(*) filter (where status = any($1))::int as live,
         count(*) filter (where status = any($1)
           and public.risk_band(coalesce(residual_score, inherent_score)) = 'extreme')::int as extreme,
         count(*) filter (where status = any($1)
           and public.risk_band(coalesce(residual_score, inherent_score)) = 'high')::int    as high,
         count(*) filter (where status = 'accepted')::int as accepted,
         count(*) filter (where status <> 'closed' and review_date is not null
           and review_date <= current_date)::int          as due_review
       from public.risk_assessments where deleted_at is null`,
      [LIVE_STATUSES]
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

risksRouter.get('/risks/:id', requireCap('risk:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where r.id = $1`, [req.params.id]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

risksRouter.post('/risks', requireCap('risk:create'), async (req, res) => {
  const parsed = riskInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  if (residualIsHalfSet(parsed.data)) return res.status(422).json({ error: 'residual_incomplete' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED, 1)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const ref = await generateRiskRef(c)
    const { rows } = await c.query(
      `insert into public.risk_assessments (org_id, created_by, ref, ${columns})
       values (current_org_id(), current_user_id(), $1, ${placeholders})
       returning id, org_id, asset_id`,
      [ref, ...values]
    )
    // The health engine reads the asset's worst live risk, so a new assessment
    // moves its condition score straight away.
    await refreshAssetHealth(c, rows[0].asset_id)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'risk.create',
      entityType: 'risk_assessment', entityId: rows[0].id, after: { ref, ...parsed.data },
    })
    const { rows: full } = await c.query(`${SELECT} where r.id = $1`, [rows[0].id])
    return full[0]
  })
  res.status(201).json(row)
})

risksRouter.patch('/risks/:id', requireCap('risk:update'), async (req, res) => {
  const parsed = riskInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select * from public.risk_assessments where id = $1 and deleted_at is null',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    // Check the residual pair as the row will be, not just the fields sent.
    if (residualIsHalfSet({ ...cur[0], ...parsed.data })) return { error: 'residual_incomplete' as const }

    const { setSql, values } = buildSet(parsed.data, ALLOWED)
    if (!setSql) return { error: 'empty_patch' as const }
    const { rows } = await c.query(
      `update public.risk_assessments set ${setSql} where id = $1 returning id, org_id, asset_id`,
      [req.params.id, ...values]
    )
    await refreshAssetHealth(c, cur[0].asset_id)
    if (rows[0].asset_id !== cur[0].asset_id) await refreshAssetHealth(c, rows[0].asset_id)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'risk.update',
      entityType: 'risk_assessment', entityId: rows[0].id,
      before: { status: cur[0].status, residual_score: cur[0].residual_score }, after: parsed.data,
    })
    const { rows: full } = await c.query(`${SELECT} where r.id = $1`, [req.params.id])
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'empty_patch') return res.status(400).json({ error: 'empty_patch' })
    return res.status(422).json({ error: 'residual_incomplete' })
  }
  res.json(result.data)
})

risksRouter.delete('/risks/:id', requireCap('risk:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.risk_assessments set deleted_at = now() where id = $1 and deleted_at is null returning id, org_id, asset_id',
      [req.params.id]
    )
    if (!rows[0]) return null
    await refreshAssetHealth(c, rows[0].asset_id)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'risk.archive',
      entityType: 'risk_assessment', entityId: rows[0].id,
    })
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
