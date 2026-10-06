import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { auditFromReq } from '../../audit.js'
import { buildSet, buildInsert } from '../../sqlUtil.js'
import { uploadRoute, DOCUMENT_MIME_TYPES } from '../../files.js'
import { nextRef } from '../../refs.js'
import { AUDIT_KINDS, AUDIT_OUTCOMES, AUDIT_STATUSES } from '@assetcore/domain'
import { parseOr400 } from '../../http/validate.js'

export const auditsRouter = Router()

// ── Audits ───────────────────────────────────────────────────────────────────
// 0001 tracked licences: documents with an expiry date. An audit is the other
// half of compliance — someone comes and checks — and what makes it worth
// recording is the outcome, not the appointment. Same capabilities as
// licences, because it is the same job done by the same people.


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

export const auditDate = z
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
  status: z.enum(AUDIT_STATUSES).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).nullable().optional(),
  summary: z.string().nullable().optional(),
  next_due_date: auditDate,
})

auditsRouter.get('/compliance-audits', requireCap('compliance:read'), async (req, res) => {
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

auditsRouter.get('/compliance-audits/:id', requireCap('compliance:read'), async (req, res) => {
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

auditsRouter.post('/compliance-audits', requireCap('compliance:create'), async (req, res) => {
  const input = parseOr400(auditInput, req.body, res)
  if (!input) return
  const data: Record<string, unknown> = { ...input }
  if (data.answers) data.answers = JSON.stringify(data.answers)
  // One date, two names, depending on which half of the merged shape the
  // caller knows about. Neither is allowed to be the only one set.
  if (!data.scheduled_date && data.audit_date) data.scheduled_date = data.audit_date
  if (!data.audit_date && data.scheduled_date) data.audit_date = data.scheduled_date
  if (!data.scheduled_date) data.scheduled_date = new Date().toISOString().slice(0, 10)
  const { columns, placeholders, values } = buildInsert(data, AUDIT_ALLOWED, 1)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const ref = await nextRef(c, 'AUD')
    const { rows } = await c.query(
      `insert into public.compliance_audits (org_id, created_by, ref, ${columns})
       values (current_org_id(), current_user_id(), $1, ${placeholders})
       returning id, org_id`,
      [ref, ...values]
    )
    await auditFromReq(c, req, {
      action: 'compliance_audit.create',
      entityType: 'compliance_audit', entityId: rows[0].id, after: { ref, ...input }})
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
auditsRouter.patch('/compliance-audits/:id', requireCap('compliance:update'), async (req, res) => {
  const input = parseOr400(auditInput.partial(), req.body, res)
  if (!input) return
  const patch: Record<string, unknown> = { ...input }
  if (patch.answers) patch.answers = JSON.stringify(patch.answers)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select id, org_id, status, outcome from public.compliance_audits where id = $1 and deleted_at is null',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }

    if (patch.status === 'completed') {
      const outcome = input.outcome ?? cur[0].outcome
      if (!outcome) return { error: 'outcome_required' as const }
      if (!patch.completed_date) patch.completed_date = new Date().toISOString().slice(0, 10)
    }

    const { setSql, values } = buildSet(patch, AUDIT_ALLOWED)
    if (!setSql) return { error: 'empty_patch' as const }
    await c.query(`update public.compliance_audits set ${setSql} where id = $1`, [req.params.id, ...values])
    await auditFromReq(c, req, {
      action: 'compliance_audit.update',
      entityType: 'compliance_audit', entityId: String(req.params.id),
      before: { status: cur[0].status, outcome: cur[0].outcome }, after: patch})
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

auditsRouter.delete('/compliance-audits/:id', requireCap('compliance:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.compliance_audits set deleted_at = now() where id = $1 and deleted_at is null returning id, org_id',
      [req.params.id]
    )
    if (rows[0]) {
      await auditFromReq(c, req, {
      action: 'compliance_audit.archive',
        entityType: 'compliance_audit', entityId: rows[0].id})
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// The audit's document upload: 0024 merged the ISO questionnaire this lineage
// recorded (standard, answers) with an audit lifecycle that ends in an
// outcome and carries findings. One table, one set of handlers below.
auditsRouter.post('/compliance-audits/:id/document', requireCap('compliance:update'), ...uploadRoute({ subdir: 'compliance-audits', field: 'document', mime: DOCUMENT_MIME_TYPES }, async (req, res, file) => {
  const url = file.url
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('update public.compliance_audits set document_url = $2 where id = $1 returning id, org_id', [req.params.id, url])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${AUDIT_SELECT} where ca.id = $1`, [req.params.id])
    await auditFromReq(c, req, { action: 'compliance_audit.attachment.add', entityType: 'compliance_audit', entityId: rows[0].id, after: { url, name: file.name } })
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
}))
