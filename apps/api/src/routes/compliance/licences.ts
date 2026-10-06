import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { auditFromReq } from '../../audit.js'
import { buildSet, buildInsert } from '../../sqlUtil.js'
import { uploadRoute, deleteUploadedFile, DOCUMENT_MIME_TYPES } from '../../files.js'
import { LICENCE_KINDS } from '@assetcore/domain'
import { parseOr400 } from '../../http/validate.js'

export const licencesRouter = Router()

const ALLOWED = ['site_id', 'asset_id', 'authority_id', 'name', 'kind', 'licence_number', 'issued_date', 'expiry_date', 'notes', 'document_url', 'documents']

const SELECT = `
  select cl.*,
    case when au.id is null then null else jsonb_build_object('name', au.name, 'code', au.code) end as authority,
    case when s.id is null then null else jsonb_build_object('name', s.name, 'code', s.code) end as site,
    case when a.id is null then null else jsonb_build_object('ain', a.ain, 'name', a.name) end as asset
  from public.compliance_licences cl
  left join public.regulatory_authorities au on au.id = cl.authority_id
  left join public.sites s on s.id = cl.site_id
  left join public.assets a on a.id = cl.asset_id
`

const licenceInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  asset_id: z.string().uuid().nullable().optional(),
  authority_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  kind: z.enum(LICENCE_KINDS).optional(),
  licence_number: z.string().nullable().optional(),
  issued_date: z.string(),
  expiry_date: z.string(),
  notes: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
  documents: z.array(z.unknown()).optional(),
})

licencesRouter.get('/compliance-licences', requireCap('compliance:read'), async (req, res) => {
  const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const values: unknown[] = []
    const clauses = [SELECT, 'where cl.deleted_at is null']
    if (locationId) {
      values.push(locationId)
      // site_id is null means "org-wide, not site-specific" (see the create
      // form) — those still apply everywhere, so a location filter narrows
      // to that location's site-specific licences PLUS the org-wide ones,
      // not just an exact site_id match.
      clauses.push(`and (cl.site_id is null or cl.site_id in (select id from public.sites where location_id = $${values.length}))`)
    }
    clauses.push('order by cl.expiry_date asc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

licencesRouter.get('/regulatory-authorities', requireCap('compliance:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select id, name, code from public.regulatory_authorities order by code').then((r) => r.rows)
  )
  res.json(rows)
})

licencesRouter.post('/compliance-licences', requireCap('compliance:create'), async (req, res) => {
  const input = parseOr400(licenceInput, req.body, res)
  if (!input) return
  const { columns, placeholders, values } = buildInsert(input, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.compliance_licences (org_id, created_by, ${columns})
       values (current_org_id(), current_user_id(), ${placeholders})
       returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [rows[0].id])
    const licence = full[0]
    await auditFromReq(c, req, { action: 'compliance_licence.create', entityType: 'compliance_licence', entityId: licence.id, after: licence })
    return licence
  })
  res.status(201).json(row)
})

licencesRouter.patch('/compliance-licences/:id', requireCap('compliance:update'), async (req, res) => {
  const input = parseOr400(licenceInput.partial(), req.body, res)
  if (!input) return
  const { setSql, values } = buildSet(input, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.compliance_licences set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [req.params.id])
    const licence = full[0]
    await auditFromReq(c, req, { action: 'compliance_licence.update', entityType: 'compliance_licence', entityId: licence.id, after: licence })
    return licence
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

licencesRouter.post('/compliance-licences/:id/document', requireCap('compliance:update'), ...uploadRoute({ subdir: 'compliance-documents', field: 'document', mime: DOCUMENT_MIME_TYPES }, async (req, res, file) => {
  const url = file.url
  const doc = { url, name: file.name, size: file.size }

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.compliance_licences set documents = documents || $2::jsonb, document_url = $3 where id = $1 returning id, org_id`,
      [req.params.id, JSON.stringify([doc]), url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [req.params.id])
    await auditFromReq(c, req, { action: 'compliance_licence.attachment.add', entityType: 'compliance_licence', entityId: rows[0].id, after: doc })
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
}))

licencesRouter.delete('/compliance-licences/:id/documents', requireCap('compliance:update'), async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : null
  if (!url) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.compliance_licences
       set documents = coalesce((select jsonb_agg(d) from jsonb_array_elements(documents) d where d->>'url' <> $2), '[]'::jsonb)
       where id = $1 returning id, org_id`,
      [req.params.id, url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [req.params.id])
    await auditFromReq(c, req, { action: 'compliance_licence.attachment.remove', entityType: 'compliance_licence', entityId: rows[0].id, before: { url } })
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  await deleteUploadedFile(req.claims!.org_id!, url)
  res.json(row)
})

licencesRouter.delete('/compliance-licences/:id', requireCap('compliance:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.compliance_licences set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const licence = rows[0]
    if (licence) await auditFromReq(c, req, { action: 'compliance_licence.archive', entityType: 'compliance_licence', entityId: licence.id })
    return licence
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

licencesRouter.post('/compliance/check-expiry', requireCap('compliance:read'), async (req, res) => {
  const count = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select public.check_licence_expiry(current_org_id()) as count').then((r) => r.rows[0].count)
  )
  res.json({ count })
})

// Computed counterpart to the audit form's self-reported "did you comply with
// routine maintenance?" Yes/No — an objective on-time-completion rate over
// pm_tasks due in the window, so the subjective attestation sits next to a
// real number instead of standing alone. Defaults to the trailing 12 months;
// RLS already scopes to the caller's sites, so no separate site_id filter is
// needed beyond what the query params allow.
licencesRouter.get('/compliance/pm-compliance', requireCap('compliance:read'), async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : null
  const to = typeof req.query.to === 'string' ? req.query.to : null
  const siteId = typeof req.query.site_id === 'string' ? req.query.site_id : null

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const clauses = ["where due_date >= coalesce($1::date, current_date - interval '12 months')", 'and due_date <= coalesce($2::date, current_date)']
    const values: unknown[] = [from, to]
    if (siteId) { values.push(siteId); clauses.push(`and site_id = $${values.length}`) }
    const { rows } = await c.query(
      `select
         count(*) as total,
         count(*) filter (where status = 'completed') as completed,
         count(*) filter (where status = 'completed' and completed_at::date <= due_date) as on_time
       from public.pm_tasks
       ${clauses.join(' ')}`,
      values
    )
    return rows[0]
  })

  const total = Number(row.total)
  const completed = Number(row.completed)
  const onTime = Number(row.on_time)
  // Rate is on-time completions out of ALL tasks due in the window, not just
  // completed ones — a late-or-overdue task should pull the rate down, same
  // as the seeded-fixture example in the implementation plan (2 on-time / 4
  // total => 50%, not 2 on-time / 3 completed => 67%).
  const rate = total > 0 ? Math.round((onTime / total) * 100) : null
  res.json({ total, completed, onTime, rate })
})
