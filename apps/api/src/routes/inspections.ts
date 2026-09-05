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

export const inspectionsRouter = Router()
inspectionsRouter.use(requireAuth, requireOrg, requireActiveMembership)

export const INSPECTION_KINDS = ['safety', 'condition', 'integrity', 'regulatory', 'environmental'] as const
export const CHECKLIST_RESULTS = ['pass', 'fail', 'na', 'pending'] as const

const ALLOWED = [
  'asset_id', 'site_id', 'title', 'kind', 'status', 'inspector_id',
  'scheduled_date', 'completed_date', 'findings', 'notes', 'checklist_results',
  // Phase 3 (0004) — the checklist behind the results, and the outcome the
  // health score reads.
  'template_id', 'condition_rating',
]

const SELECT = `
  select i.*,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code) end as site,
    case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as inspector,
    case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name) end as template,
    (select count(*)::int from public.defects d where d.inspection_id = i.id and d.deleted_at is null) as defect_count
  from public.inspections i
  left join public.assets a on a.id = i.asset_id
  left join public.sites s on s.id = i.site_id
  left join public.users u on u.id = i.inspector_id
  left join public.inspection_templates t on t.id = i.template_id
`

// [{item, result, notes}] — the same shape generate_pm_tasks() stamps onto a
// PM task, so a checklist reads identically wherever it appears.
const checklistItem = z.object({
  item: z.string().min(1).max(300),
  result: z.enum(CHECKLIST_RESULTS).default('pending'),
  notes: z.string().max(500).nullable().optional(),
})

const inspectionInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  kind: z.enum(INSPECTION_KINDS).optional(),
  status: z.enum(['scheduled', 'due', 'in_progress', 'completed', 'overdue']).optional(),
  inspector_id: z.string().uuid().nullable().optional(),
  scheduled_date: z.string(),
  completed_date: z.string().nullable().optional(),
  findings: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  checklist_results: z.array(checklistItem).nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  condition_rating: z.number().int().min(1).max(5).nullable().optional(),
})

// ── Templates ────────────────────────────────────────────────────────────────
// The checklist definition inspections never had. Kept as its own record
// rather than typed out per inspection, so two safety inspections a month
// apart are comparable.

const templateInput = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(INSPECTION_KINDS).optional(),
  description: z.string().nullable().optional(),
  items: z.array(z.string().min(1).max(300)).max(100),
  active: z.boolean().optional(),
})

const TEMPLATE_ALLOWED = ['name', 'kind', 'description', 'items', 'active']

inspectionsRouter.get('/inspection-templates', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = ['select * from public.inspection_templates where deleted_at is null']
    if (req.query.include_inactive !== 'true') clauses.push('and active')
    clauses.push('order by kind, name')
    return c.query(clauses.join(' ')).then((r) => r.rows)
  })
  res.json(rows)
})

inspectionsRouter.post('/inspection-templates', requireCap('inspection:update'), async (req, res) => {
  const parsed = templateInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.inspection_templates (org_id, created_by, name, kind, description, items, active)
       values (current_org_id(), current_user_id(), $1, $2, $3, $4::jsonb, $5)
       returning *`,
      [parsed.data.name, parsed.data.kind ?? 'condition', parsed.data.description ?? null,
       JSON.stringify(parsed.data.items), parsed.data.active ?? true]
    )
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'inspection.template.create',
      entityType: 'inspection_template', entityId: rows[0].id, after: parsed.data,
    })
    return rows[0]
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message.includes('inspection_templates_org_id_name_key')) return 'duplicate' as const
    throw err
  })

  if (result === 'duplicate') return res.status(409).json({ error: 'duplicate_name' })
  res.status(201).json(result)
})

inspectionsRouter.patch('/inspection-templates/:id', requireCap('inspection:update'), async (req, res) => {
  const parsed = templateInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.items) patch.items = JSON.stringify(parsed.data.items)
  const { setSql, values } = buildSet(patch, TEMPLATE_ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `update public.inspection_templates set ${setSql} where id = $1 and deleted_at is null returning *`,
      [req.params.id, ...values]
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

inspectionsRouter.delete('/inspection-templates/:id', requireCap('inspection:update'), async (req, res) => {
  // Soft delete: inspections raised from this template keep pointing at it, so
  // "which checklist was this?" stays answerable.
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      'update public.inspection_templates set deleted_at = now(), active = false where id = $1 and deleted_at is null returning id',
      [req.params.id]
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// ── Inspections ──────────────────────────────────────────────────────────────

inspectionsRouter.get('/inspections', async (req, res) => {
  const { statuses, limit } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    if (typeof statuses === 'string' && statuses) {
      values.push(statuses.split(','))
      clauses.push(`and i.status = any($${values.length})`)
    }
    const assetId = typeof req.query.asset_id === 'string' && req.query.asset_id ? req.query.asset_id : null
    if (assetId) { values.push(assetId); clauses.push(`and i.asset_id = $${values.length}`) }
    clauses.push('order by i.scheduled_date desc')
    values.push(typeof limit === 'string' ? Number(limit) || 100 : 100)
    clauses.push(`limit $${values.length}`)
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

inspectionsRouter.get('/inspections/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
    if (!rows[0]) return null
    const { rows: defects } = await c.query(
      `select d.id, d.ref, d.title, d.severity, d.status, d.work_order_id,
         case when w.id is null then null else jsonb_build_object('id', w.id, 'ref', w.ref, 'status', w.status) end as work_order
       from public.defects d
       left join public.work_orders w on w.id = d.work_order_id
       where d.inspection_id = $1 and d.deleted_at is null
       order by d.identified_date desc`,
      [req.params.id]
    )
    return { ...rows[0], defects }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

inspectionsRouter.post('/inspections', requireCap('inspection:create'), async (req, res) => {
  const parsed = inspectionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const data: Record<string, unknown> = { ...parsed.data }

    // A template is expanded onto the inspection at creation, exactly as
    // generate_pm_tasks() does for a PM schedule: the inspection carries its
    // own copy, so editing the template later doesn't rewrite history.
    if (parsed.data.template_id && !parsed.data.checklist_results) {
      const { rows: tpl } = await c.query(
        'select items from public.inspection_templates where id = $1 and deleted_at is null',
        [parsed.data.template_id]
      )
      if (!tpl[0]) return { error: 'template_not_found' as const }
      data.checklist_results = (tpl[0].items as string[]).map((item) => ({ item, result: 'pending', notes: null }))
    }
    if (data.checklist_results) data.checklist_results = JSON.stringify(data.checklist_results)

    const { columns, placeholders, values } = buildInsert(data, ALLOWED)
    const { rows } = await c.query(
      `insert into public.inspections (org_id, ${columns}) values (current_org_id(), ${placeholders}) returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [rows[0].id])
    const inspection = full[0]
    await writeAuditLog(c, {
      orgId: inspection.org_id, actorId: req.claims!.sub, action: 'inspection.create',
      entityType: 'inspection', entityId: inspection.id, after: inspection,
    })
    return { data: inspection }
  })

  if ('error' in row) return res.status(404).json({ error: 'template_not_found' })
  res.status(201).json(row.data)
})

/**
 * An inspection is completed by recording what was found, not by flipping a
 * status. A completed inspection owes two things: results against every
 * checklist item it was raised with, and an overall 1-5 condition rating —
 * which is the signal the health score reads. Refusing to complete without
 * the rating is what stops the score falling back to guesswork.
 */
inspectionsRouter.patch('/inspections/:id', requireCap('inspection:update'), async (req, res) => {
  const parsed = inspectionInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch: Record<string, unknown> = { ...parsed.data }

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select id, org_id, status, asset_id, condition_rating from public.inspections where id = $1',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }

    const completing = patch.status === 'completed'
    if (completing) {
      const rating = parsed.data.condition_rating ?? cur[0].condition_rating
      if (rating == null) return { error: 'condition_rating_required' as const }
      if (!patch.completed_date) patch.completed_date = new Date().toISOString().slice(0, 10)
    }
    if (parsed.data.checklist_results) patch.checklist_results = JSON.stringify(parsed.data.checklist_results)

    const { setSql, values } = buildSet(patch, ALLOWED)
    if (!setSql) return { error: 'empty_patch' as const }

    const { rows } = await c.query(
      `update public.inspections set ${setSql} where id = $1 returning id, org_id, asset_id`,
      [req.params.id, ...values]
    )
    // A fresh condition rating moves the asset's health score straight away.
    await refreshAssetHealth(c, rows[0].asset_id)
    if (rows[0].asset_id !== cur[0].asset_id) await refreshAssetHealth(c, cur[0].asset_id)

    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
    await writeAuditLog(c, {
      orgId: full[0].org_id, actorId: req.claims!.sub, action: 'inspection.update',
      entityType: 'inspection', entityId: full[0].id,
      before: { status: cur[0].status }, after: parsed.data,
    })
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'empty_patch') return res.status(400).json({ error: 'empty_patch' })
    return res.status(422).json({ error: 'condition_rating_required' })
  }
  res.json(result.data)
})
