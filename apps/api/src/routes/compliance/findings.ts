import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { writeAuditLog } from '../../audit.js'
import { createDefect } from '../../services/defects.js'
import { FINDING_SEVERITIES, FINDING_STATUSES, DEFECT_SEVERITIES } from '@assetcore/domain'
import { auditDate } from './audits.js'
import { parseOr400 } from '../../http/validate.js'

export const findingsRouter = Router()

// ── Findings ─────────────────────────────────────────────────────────────────

const findingInput = z.object({
  clause: z.string().max(120).nullable().optional(),
  description: z.string().min(1).max(2000),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  due_date: auditDate,
})

findingsRouter.post('/compliance-audits/:id/findings', requireCap('compliance:update'), async (req, res) => {
  const input = parseOr400(findingInput, req.body, res)
  if (!input) return

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.compliance_audit_findings (org_id, audit_id, clause, description, severity, due_date)
       values (current_org_id(), $1, $2, $3, $4, $5) returning *`,
      [req.params.id, input.clause ?? null, input.description,
       input.severity ?? 'minor', input.due_date ?? null]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
})

findingsRouter.patch('/compliance-audits/:id/findings/:findingId', requireCap('compliance:update'), async (req, res) => {
  const input = parseOr400(findingInput.partial().extend({ status: z.enum(FINDING_STATUSES).optional() }), req.body, res)
  if (!input) return

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
      [req.params.findingId, req.params.id, input.clause ?? null, input.description ?? null,
       input.severity ?? null, input.due_date ?? null, input.status ?? null]
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
findingsRouter.post('/compliance-audits/:id/findings/:findingId/defect', requireCap('defect:create'), async (req, res) => {
  const input = parseOr400(z.object({
    severity: z.enum(DEFECT_SEVERITIES).optional(),
    asset_id: z.string().uuid().nullable().optional(),
  }), req.body ?? {}, res)
  if (!input) return

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

    const created = await createDefect(c, {
      title: `${finding.audit_ref}${finding.clause ? ` ${finding.clause}` : ''}: audit finding`,
      description: finding.description,
      severity: input.severity ?? SEVERITY_MAP[finding.severity] ?? 'moderate',
      category: 'compliance',
      asset_id: input.asset_id ?? null,
      site_id: finding.site_id,
      due_date: finding.due_date,
    }, req.claims!.sub)
    await c.query('update public.compliance_audit_findings set defect_id = $2 where id = $1',
      [req.params.findingId, created.id])
    await writeAuditLog(c, {
      orgId: req.claims!.org_id!, actorId: req.claims!.sub, action: 'compliance_audit.finding.raise_defect',
      entityType: 'compliance_audit', entityId: String(req.params.id),
      after: { finding_id: req.params.findingId, defect_ref: created.ref },
    })
    return { data: { id: created.id, ref: created.ref } }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'already_raised', defect_id: result.defect_id })
  }
  res.status(201).json(result.data)
})
