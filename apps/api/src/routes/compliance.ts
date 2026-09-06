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

// ── Compliance audits ─────────────────────────────────────────────────────────
// The CRUD for these lives at the foot of this file: 0024 merged the ISO
// questionnaire this lineage recorded (standard, answers) with an audit
// lifecycle that ends in an outcome and carries findings. One table, one set
// of handlers, both sets of fields. Only the document upload stayed here,
// because it is about the file rather than the audit.
const auditDocumentUpload = uploadTo('compliance-audits')

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

// Computed counterpart to the audit form's self-reported "did you comply with
// routine maintenance?" Yes/No — an objective on-time-completion rate over
// pm_tasks due in the window, so the subjective attestation sits next to a
// real number instead of standing alone. Defaults to the trailing 12 months;
// RLS already scopes to the caller's sites, so no separate site_id filter is
// needed beyond what the query params allow.
complianceRouter.get('/compliance/pm-compliance', requireCap('compliance:read'), async (req, res) => {
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
// ── Audits ───────────────────────────────────────────────────────────────────
// 0001 tracked licences: documents with an expiry date. An audit is the other
// half of compliance — someone comes and checks — and what makes it worth
// recording is the outcome, not the appointment. Same capabilities as
// licences, because it is the same job done by the same people.

export const AUDIT_KINDS = ['internal', 'external', 'regulatory', 'certification'] as const
export const AUDIT_OUTCOMES = ['pass', 'pass_with_findings', 'fail', 'not_applicable'] as const
export const FINDING_SEVERITIES = ['observation', 'minor', 'major', 'critical'] as const

// The lifecycle half (0024) plus the ISO questionnaire half 0005 already had.
// Both are editable; they answer different questions about the same audit.
const AUDIT_ALLOWED = [
  'title', 'kind', 'authority_id', 'site_id', 'asset_id', 'licence_id', 'scope', 'auditor', 'lead_id',
  'scheduled_date', 'completed_date', 'status', 'outcome', 'summary', 'next_due_date',
  'standard', 'iso_reference', 'audit_date', 'auditor_id',
  'routine_maintenance_complied', 'iso_audit_conducted', 'answers', 'notes', 'document_url',
]

const AUDIT_SELECT = `
  select ca.*,
    case when au.id is null then null else jsonb_build_object('id', au.id, 'name', au.name, 'code', au.code) end as authority,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when cl.id is null then null else jsonb_build_object('id', cl.id, 'name', cl.name) end as licence,
    case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as lead,
    case when ar.id is null then null else jsonb_build_object('id', ar.id, 'full_name', ar.full_name) end as auditor_user,
    case when ast.id is null then null else jsonb_build_object('id', ast.id, 'ain', ast.ain, 'name', ast.name) end as asset,
    (select count(*)::int from public.compliance_audit_findings f where f.audit_id = ca.id) as finding_count,
    (select count(*)::int from public.compliance_audit_findings f
      where f.audit_id = ca.id and f.status = 'open') as open_finding_count
  from public.compliance_audits ca
  left join public.regulatory_authorities au on au.id = ca.authority_id
  left join public.sites s on s.id = ca.site_id
  left join public.compliance_licences cl on cl.id = ca.licence_id
  left join public.users u on u.id = ca.lead_id
  left join public.users ar on ar.id = ca.auditor_id
  left join public.assets ast on ast.id = ca.asset_id
`

const auditDate = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'expected YYYY-MM-DD' })

const auditInput = z.object({
  title: z.string().min(1).max(300),
  // 0005's ISO questionnaire fields, kept alongside the lifecycle.
  asset_id: z.string().uuid().nullable().optional(),
  standard: z.string().max(120).nullable().optional(),
  iso_reference: z.string().max(120).nullable().optional(),
  auditor_id: z.string().uuid().nullable().optional(),
  routine_maintenance_complied: z.boolean().nullable().optional(),
  iso_audit_conducted: z.boolean().nullable().optional(),
  answers: z.record(z.unknown()).nullable().optional(),
  notes: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
  kind: z.enum(AUDIT_KINDS).optional(),
  authority_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  licence_id: z.string().uuid().nullable().optional(),
  scope: z.string().nullable().optional(),
  auditor: z.string().max(200).nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  // Optional: 0005's shape recorded an audit that had already happened and
  // sent only audit_date. Whichever arrives, the other is derived below.
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  audit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completed_date: auditDate,
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).nullable().optional(),
  summary: z.string().nullable().optional(),
  next_due_date: auditDate,
})

/** AUD-{year}-{4 digits}, matching the other registers' ref format. */
async function generateAuditRef(c: import('pg').PoolClient): Promise<string> {
  const year = new Date().getFullYear()
  const { rows } = await c.query('select count(*)::int as n from public.compliance_audits where ref like $1', [`AUD-${year}-%`])
  return `AUD-${year}-${String(rows[0].n + 1).padStart(4, '0')}`
}

complianceRouter.get('/compliance-audits', requireCap('compliance:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [AUDIT_SELECT, 'where ca.deleted_at is null']
    const values: unknown[] = []
    const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : null
    if (status) { values.push(status); clauses.push(`and ca.status = $${values.length}`) }
    const kind = typeof req.query.kind === 'string' && req.query.kind !== 'all' ? req.query.kind : null
    if (kind) { values.push(kind); clauses.push(`and ca.kind = $${values.length}`) }
    if (req.query.open_findings === 'true') {
      clauses.push('and exists (select 1 from public.compliance_audit_findings f where f.audit_id = ca.id and f.status = \'open\')')
    }
    clauses.push('order by ca.scheduled_date desc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

complianceRouter.get('/compliance-audits/stats', requireCap('compliance:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select
         count(*) filter (where status in ('scheduled','in_progress'))::int as upcoming,
         count(*) filter (where status = 'completed')::int                  as completed,
         count(*) filter (where status = 'completed' and outcome = 'fail')::int as failed,
         (select count(*)::int from public.compliance_audit_findings f
           join public.compliance_audits a on a.id = f.audit_id and a.deleted_at is null
           where f.status = 'open')                                          as open_findings,
         (select count(*)::int from public.compliance_audit_findings f
           join public.compliance_audits a on a.id = f.audit_id and a.deleted_at is null
           where f.status = 'open' and f.severity in ('major','critical'))    as serious_findings
       from public.compliance_audits where deleted_at is null`
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

complianceRouter.get('/compliance-audits/:id', requireCap('compliance:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [req.params.id])
    if (!rows[0]) return null
    const { rows: findings } = await c.query(
      `select f.*,
         case when d.id is null then null else jsonb_build_object(
           'id', d.id, 'ref', d.ref, 'status', d.status, 'work_order_id', d.work_order_id) end as defect
       from public.compliance_audit_findings f
       left join public.defects d on d.id = f.defect_id
       where f.audit_id = $1
       order by case f.severity when 'critical' then 0 when 'major' then 1 when 'minor' then 2 else 3 end,
                f.created_at`,
      [req.params.id]
    )
    return { ...rows[0], findings }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

complianceRouter.post('/compliance-audits', requireCap('compliance:create'), async (req, res) => {
  const parsed = auditInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const data: Record<string, unknown> = { ...parsed.data }
  if (data.answers) data.answers = JSON.stringify(data.answers)
  // One date, two names, depending on which half of the merged shape the
  // caller knows about. Neither is allowed to be the only one set.
  if (!data.scheduled_date && data.audit_date) data.scheduled_date = data.audit_date
  if (!data.audit_date && data.scheduled_date) data.audit_date = data.scheduled_date
  if (!data.scheduled_date) data.scheduled_date = new Date().toISOString().slice(0, 10)
  const { columns, placeholders, values } = buildInsert(data, AUDIT_ALLOWED, 1)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const ref = await generateAuditRef(c)
    const { rows } = await c.query(
      `insert into public.compliance_audits (org_id, created_by, ref, ${columns})
       values (current_org_id(), current_user_id(), $1, ${placeholders})
       returning id, org_id`,
      [ref, ...values]
    )
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'compliance_audit.create',
      entityType: 'compliance_audit', entityId: rows[0].id, after: { ref, ...parsed.data },
    })
    const { rows: full } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [rows[0].id])
    return full[0]
  })
  res.status(201).json(row)
})

/**
 * An audit is completed by recording how it went.
 *
 * Refusing to complete without an outcome is the same rule inspections got in
 * Phase 3: a compliance record whose result is blank is a diary entry, and the
 * whole reason to track audits is to be able to answer "did we pass?" without
 * reading a PDF.
 */
complianceRouter.patch('/compliance-audits/:id', requireCap('compliance:update'), async (req, res) => {
  const parsed = auditInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch: Record<string, unknown> = { ...parsed.data }
  if (patch.answers) patch.answers = JSON.stringify(patch.answers)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select id, org_id, status, outcome from public.compliance_audits where id = $1 and deleted_at is null',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }

    if (patch.status === 'completed') {
      const outcome = parsed.data.outcome ?? cur[0].outcome
      if (!outcome) return { error: 'outcome_required' as const }
      if (!patch.completed_date) patch.completed_date = new Date().toISOString().slice(0, 10)
    }

    const { setSql, values } = buildSet(patch, AUDIT_ALLOWED)
    if (!setSql) return { error: 'empty_patch' as const }
    await c.query(`update public.compliance_audits set ${setSql} where id = $1`, [req.params.id, ...values])
    await writeAuditLog(c, {
      orgId: cur[0].org_id, actorId: req.claims!.sub, action: 'compliance_audit.update',
      entityType: 'compliance_audit', entityId: String(req.params.id),
      before: { status: cur[0].status, outcome: cur[0].outcome }, after: patch,
    })
    const { rows: full } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [req.params.id])
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'empty_patch') return res.status(400).json({ error: 'empty_patch' })
    return res.status(422).json({ error: 'outcome_required' })
  }
  res.json(result.data)
})

complianceRouter.delete('/compliance-audits/:id', requireCap('compliance:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.compliance_audits set deleted_at = now() where id = $1 and deleted_at is null returning id, org_id',
      [req.params.id]
    )
    if (rows[0]) {
      await writeAuditLog(c, {
        orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'compliance_audit.archive',
        entityType: 'compliance_audit', entityId: rows[0].id,
      })
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// ── Findings ─────────────────────────────────────────────────────────────────

const findingInput = z.object({
  clause: z.string().max(120).nullable().optional(),
  description: z.string().min(1).max(2000),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  due_date: auditDate,
})

complianceRouter.post('/compliance-audits/:id/findings', requireCap('compliance:update'), async (req, res) => {
  const parsed = findingInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.compliance_audit_findings (org_id, audit_id, clause, description, severity, due_date)
       values (current_org_id(), $1, $2, $3, $4, $5) returning *`,
      [req.params.id, parsed.data.clause ?? null, parsed.data.description,
       parsed.data.severity ?? 'minor', parsed.data.due_date ?? null]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
})

complianceRouter.patch('/compliance-audits/:id/findings/:findingId', requireCap('compliance:update'), async (req, res) => {
  const parsed = findingInput.partial().extend({ status: z.enum(['open', 'closed']).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      // Closing stamps the clock; reopening clears it, so a finding that is
      // open again never carries a closure date.
      `update public.compliance_audit_findings
          set clause      = coalesce($3, clause),
              description = coalesce($4, description),
              severity    = coalesce($5, severity),
              due_date    = coalesce($6, due_date),
              status      = coalesce($7, status),
              closed_at   = case when $7 is null then closed_at
                                 when $7 = 'closed' then coalesce(closed_at, now())
                                 else null end
        where id = $1 and audit_id = $2
        returning *`,
      [req.params.findingId, req.params.id, parsed.data.clause ?? null, parsed.data.description ?? null,
       parsed.data.severity ?? null, parsed.data.due_date ?? null, parsed.data.status ?? null]
    ).then((r) => r.rows[0] ?? null)
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

/**
 * Turn a finding into a defect.
 *
 * The same chain inspections got in Phase 3, from the other direction: a
 * regulator writes down a non-conformity, it becomes a defect on the register,
 * and from there a work order. Without this the finding sits in a PDF and the
 * maintenance team never hears about it.
 */
complianceRouter.post('/compliance-audits/:id/findings/:findingId/defect', requireCap('defect:create'), async (req, res) => {
  const parsed = z.object({
    severity: z.enum(['minor', 'moderate', 'major', 'critical']).optional(),
    asset_id: z.string().uuid().nullable().optional(),
  }).safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  // An audit finding's severity scale and a defect's are different words for
  // the same idea; map once here rather than at each call site.
  const SEVERITY_MAP: Record<string, string> = {
    observation: 'minor', minor: 'moderate', major: 'major', critical: 'critical',
  }

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      `select f.*, a.ref as audit_ref, a.site_id
       from public.compliance_audit_findings f
       join public.compliance_audits a on a.id = f.audit_id
       where f.id = $1 and f.audit_id = $2`,
      [req.params.findingId, req.params.id]
    )
    const finding = cur[0]
    if (!finding) return { error: 'not_found' as const }
    if (finding.defect_id) return { error: 'already_raised' as const, defect_id: finding.defect_id }

    const year = new Date().getFullYear()
    const { rows: seq } = await c.query('select count(*)::int as n from public.defects where ref like $1', [`DEF-${year}-%`])
    const ref = `DEF-${year}-${String(seq[0].n + 1).padStart(4, '0')}`

    const { rows: created } = await c.query(
      `insert into public.defects
         (org_id, reported_by, ref, title, description, severity, category, asset_id, site_id, due_date)
       values (current_org_id(), current_user_id(), $1, $2, $3, $4, 'compliance', $5, $6, $7)
       returning id, ref`,
      [
        ref,
        `${finding.audit_ref}${finding.clause ? ` ${finding.clause}` : ''}: audit finding`,
        finding.description,
        parsed.data.severity ?? SEVERITY_MAP[finding.severity] ?? 'moderate',
        parsed.data.asset_id ?? null,
        finding.site_id,
        finding.due_date,
      ]
    )
    await c.query('update public.compliance_audit_findings set defect_id = $2 where id = $1',
      [req.params.findingId, created[0].id])
    await writeAuditLog(c, {
      orgId: req.claims!.org_id!, actorId: req.claims!.sub, action: 'compliance_audit.finding.raise_defect',
      entityType: 'compliance_audit', entityId: String(req.params.id),
      after: { finding_id: req.params.findingId, defect_ref: created[0].ref },
    })
    return { data: created[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'already_raised', defect_id: result.defect_id })
  }
  res.status(201).json(result.data)
})
