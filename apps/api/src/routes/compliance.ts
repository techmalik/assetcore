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
import { uploadTo, cleanupOrphanedUpload, deleteUploadedFile } from '../files.js'

export const complianceRouter = Router()
complianceRouter.use(requireAuth, requireOrg, requireActiveMembership)

const documentUpload = uploadTo('compliance-documents')

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
  kind: z.enum(['licence', 'permit', 'certificate', 'iso_certificate']).optional(),
  licence_number: z.string().nullable().optional(),
  issued_date: z.string(),
  expiry_date: z.string(),
  notes: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
  documents: z.array(z.unknown()).optional(),
})

complianceRouter.get('/compliance-licences', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where cl.deleted_at is null order by cl.expiry_date asc`).then((r) => r.rows)
  )
  res.json(rows)
})

complianceRouter.get('/compliance-licences/counts', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select expiry_date from public.compliance_licences where deleted_at is null').then((r) => r.rows)
  )
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d30 = new Date(today); d30.setDate(today.getDate() + 30)
  const d90 = new Date(today); d90.setDate(today.getDate() + 90)
  let active = 0, dueSoon = 0, expiring = 0, expired = 0
  for (const row of rows) {
    const exp = new Date(row.expiry_date)
    if (exp < today) expired++
    else if (exp < d30) expiring++
    else if (exp < d90) dueSoon++
    else active++
  }
  res.json({ active, dueSoon, expiring, expired, total: rows.length })
})

complianceRouter.get('/regulatory-authorities', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select id, name, code from public.regulatory_authorities order by code').then((r) => r.rows)
  )
  res.json(rows)
})

complianceRouter.post('/compliance-licences', requireCap('compliance:create'), async (req, res) => {
  const parsed = licenceInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.compliance_licences (org_id, created_by, ${columns})
       values (current_org_id(), current_user_id(), ${placeholders})
       returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [rows[0].id])
    const licence = full[0]
    await writeAuditLog(c, { orgId: licence.org_id, actorId: req.claims!.sub, action: 'compliance_licence.create', entityType: 'compliance_licence', entityId: licence.id, after: licence })
    return licence
  })
  res.status(201).json(row)
})

complianceRouter.patch('/compliance-licences/:id', requireCap('compliance:update'), async (req, res) => {
  const parsed = licenceInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.compliance_licences set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [req.params.id])
    const licence = full[0]
    await writeAuditLog(c, { orgId: licence.org_id, actorId: req.claims!.sub, action: 'compliance_licence.update', entityType: 'compliance_licence', entityId: licence.id, after: licence })
    return licence
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

complianceRouter.post('/compliance-licences/:id/document', requireCap('compliance:update'), documentUpload.single('document'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'missing_file' })
  const url = `compliance-documents/${file.filename}`
  const doc = { url, name: file.originalname, size: file.size }

  let row
  try {
    row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query(
        `update public.compliance_licences set documents = documents || $2::jsonb, document_url = $3 where id = $1 returning id, org_id`,
        [req.params.id, JSON.stringify([doc]), url]
      )
      if (!rows[0]) return null
      const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [req.params.id])
      await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'compliance_licence.attachment.add', entityType: 'compliance_licence', entityId: rows[0].id, after: doc })
      return full[0]
    })
  } catch (err) {
    await cleanupOrphanedUpload(file.path)
    throw err
  }
  if (!row) {
    await cleanupOrphanedUpload(file.path)
    return res.status(404).json({ error: 'not_found' })
  }
  res.status(201).json(row)
})

complianceRouter.delete('/compliance-licences/:id/documents', requireCap('compliance:update'), async (req, res) => {
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
    await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'compliance_licence.attachment.remove', entityType: 'compliance_licence', entityId: rows[0].id, before: { url } })
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  await deleteUploadedFile(req.claims!.org_id!, url)
  res.json(row)
})

// ── Compliance audits (ISO / routine-maintenance attestations) ────────────────
const auditDocumentUpload = uploadTo('compliance-audits')

const AUDIT_ALLOWED = [
  'site_id', 'asset_id', 'title', 'standard', 'iso_reference', 'audit_date',
  'auditor_id', 'routine_maintenance_complied', 'iso_audit_conducted', 'answers', 'notes', 'document_url',
]

const AUDIT_SELECT = `
  select ca.*,
    case when s.id is null then null else jsonb_build_object('name', s.name) end as site,
    case when a.id is null then null else jsonb_build_object('ain', a.ain, 'name', a.name) end as asset,
    case when u.id is null then null else jsonb_build_object('full_name', u.full_name) end as auditor
  from public.compliance_audits ca
  left join public.sites s on s.id = ca.site_id
  left join public.assets a on a.id = ca.asset_id
  left join public.users u on u.id = ca.auditor_id
`

const auditInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  asset_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  standard: z.string().nullable().optional(),
  iso_reference: z.string().nullable().optional(),
  audit_date: z.string(),
  auditor_id: z.string().uuid().nullable().optional(),
  routine_maintenance_complied: z.boolean().nullable().optional(),
  iso_audit_conducted: z.boolean().nullable().optional(),
  answers: z.record(z.unknown()).optional(),
  notes: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
})

complianceRouter.get('/compliance-audits', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${AUDIT_SELECT} where ca.deleted_at is null order by ca.audit_date desc`).then((r) => r.rows)
  )
  res.json(rows)
})

complianceRouter.post('/compliance-audits', requireCap('compliance:create'), async (req, res) => {
  const parsed = auditInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, AUDIT_ALLOWED)
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.compliance_audits (org_id, created_by, ${columns})
       values (current_org_id(), current_user_id(), ${placeholders}) returning id`,
      values
    )
    const { rows: full } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [rows[0].id])
    const audit = full[0]
    await writeAuditLog(c, { orgId: audit.org_id, actorId: req.claims!.sub, action: 'compliance_audit.create', entityType: 'compliance_audit', entityId: audit.id, after: audit })
    return audit
  })
  res.status(201).json(row)
})

complianceRouter.patch('/compliance-audits/:id', requireCap('compliance:update'), async (req, res) => {
  const parsed = auditInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, AUDIT_ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.compliance_audits set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [req.params.id])
    const audit = full[0]
    await writeAuditLog(c, { orgId: audit.org_id, actorId: req.claims!.sub, action: 'compliance_audit.update', entityType: 'compliance_audit', entityId: audit.id, after: parsed.data })
    return audit
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

complianceRouter.post('/compliance-audits/:id/document', requireCap('compliance:update'), auditDocumentUpload.single('document'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  const url = `compliance-audits/${req.file.filename}`
  let row
  try {
    row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query('update public.compliance_audits set document_url = $2 where id = $1 returning id, org_id', [req.params.id, url])
      if (!rows[0]) return null
      const { rows: full } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [req.params.id])
      await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'compliance_audit.attachment.add', entityType: 'compliance_audit', entityId: rows[0].id, after: { url, name: req.file!.originalname } })
      return full[0]
    })
  } catch (err) {
    await cleanupOrphanedUpload(req.file.path)
    throw err
  }
  if (!row) {
    await cleanupOrphanedUpload(req.file.path)
    return res.status(404).json({ error: 'not_found' })
  }
  res.status(201).json(row)
})

complianceRouter.delete('/compliance-audits/:id', requireCap('compliance:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('update public.compliance_audits set deleted_at = now() where id = $1 returning id, org_id', [req.params.id])
    const audit = rows[0]
    if (audit) await writeAuditLog(c, { orgId: audit.org_id, actorId: req.claims!.sub, action: 'compliance_audit.archive', entityType: 'compliance_audit', entityId: audit.id })
    return audit
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

complianceRouter.delete('/compliance-licences/:id', requireCap('compliance:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.compliance_licences set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const licence = rows[0]
    if (licence) await writeAuditLog(c, { orgId: licence.org_id, actorId: req.claims!.sub, action: 'compliance_licence.archive', entityType: 'compliance_licence', entityId: licence.id })
    return licence
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

complianceRouter.post('/compliance/check-expiry', requireCap('compliance:read'), async (req, res) => {
  const count = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select public.check_licence_expiry(current_org_id()) as count').then((r) => r.rows[0].count)
  )
  res.json({ count })
})
