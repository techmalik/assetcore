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
import { uploadTo } from '../files.js'

export const inspectionsRouter = Router()
inspectionsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const reportUpload = uploadTo('inspection-reports')

const ALLOWED = [
  'asset_id', 'site_id', 'title', 'kind', 'status', 'inspector_id',
  'scheduled_date', 'completed_date', 'findings', 'notes', 'checklist_results', 'report_url',
]

const SELECT = `
  select i.*,
    case when a.id is null then null else jsonb_build_object('ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('name', s.name, 'code', s.code) end as site,
    case when u.id is null then null else jsonb_build_object('full_name', u.full_name) end as inspector
  from public.inspections i
  left join public.assets a on a.id = i.asset_id
  left join public.sites s on s.id = i.site_id
  left join public.users u on u.id = i.inspector_id
`

const inspectionInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  kind: z.enum(['safety', 'condition', 'integrity', 'regulatory', 'environmental']).optional(),
  status: z.enum(['scheduled', 'due', 'in_progress', 'completed', 'overdue']).optional(),
  inspector_id: z.string().uuid().nullable().optional(),
  scheduled_date: z.string(),
  completed_date: z.string().nullable().optional(),
  findings: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  checklist_results: z.record(z.unknown()).nullable().optional(),
  report_url: z.string().nullable().optional(),
})

inspectionsRouter.get('/inspections', async (req, res) => {
  const { statuses, limit, asset_id } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    if (typeof statuses === 'string' && statuses) {
      values.push(statuses.split(','))
      clauses.push(`and i.status = any($${values.length})`)
    }
    if (typeof asset_id === 'string' && asset_id) { values.push(asset_id); clauses.push(`and i.asset_id = $${values.length}`) }
    clauses.push('order by i.scheduled_date desc')
    values.push(typeof limit === 'string' ? Number(limit) || 100 : 100)
    clauses.push(`limit $${values.length}`)
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

inspectionsRouter.post('/inspections', requireCap('inspection:create'), async (req, res) => {
  const parsed = inspectionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.inspections (org_id, ${columns}) values (current_org_id(), ${placeholders}) returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [rows[0].id])
    const inspection = full[0]
    await writeAuditLog(c, { orgId: inspection.org_id, actorId: req.claims!.sub, action: 'inspection.create', entityType: 'inspection', entityId: inspection.id, after: inspection })
    return inspection
  })
  res.status(201).json(row)
})

inspectionsRouter.patch('/inspections/:id', requireCap('inspection:update'), async (req, res) => {
  const parsed = inspectionInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch = { ...parsed.data }
  if (patch.status === 'completed' && !patch.completed_date) patch.completed_date = new Date().toISOString().slice(0, 10)
  const { setSql, values } = buildSet(patch, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.inspections set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
    const inspection = full[0]
    await writeAuditLog(c, { orgId: inspection.org_id, actorId: req.claims!.sub, action: 'inspection.update', entityType: 'inspection', entityId: inspection.id, after: inspection })
    return inspection
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// Inspection report upload — attach a report file after the inspection is done.
inspectionsRouter.post('/inspections/:id/report', requireCap('inspection:update'), reportUpload.single('report'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  const url = `inspection-reports/${req.file.filename}`
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('update public.inspections set report_url = $2 where id = $1 returning id, asset_id', [req.params.id, url])
    if (!rows[0]) return null
    if (rows[0].asset_id) {
      await c.query(
        `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
         values (current_org_id(), $1, current_user_id(), 'inspection', 'Inspection report uploaded.', $2::jsonb)`,
        [rows[0].asset_id, JSON.stringify([{ url, name: req.file!.originalname }])]
      )
    }
    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
})
