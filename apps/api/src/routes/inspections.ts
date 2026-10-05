import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'
import { uploadRoute, DOCUMENT_MIME_TYPES } from '../files.js'
import { notifyUsers, notifyRoleHolders } from '../notify.js'
import { refreshAssetHealth } from '../healthService.js'
import { isSiteShutdown, SITE_SHUTDOWN_ERROR } from '../siteShutdown.js'
import { listQuery } from '../http/query.js'
import { parseOr400 } from '../http/validate.js'
import { INSPECTION_KINDS, INSPECTION_STATUSES, CHECKLIST_RESULTS } from '@assetcore/domain'

export const inspectionsRouter = Router()


const ALLOWED = [
  'asset_id', 'site_id', 'title', 'kind', 'status', 'inspector_id',
  'scheduled_date', 'completed_date', 'findings', 'notes', 'checklist_results', 'report_url',
  // 0023 — the checklist behind the results, and the outcome the condition
  // score reads.
  'template_id', 'condition_rating',
]


const SELECT = `
  select i.*,
    case when a.id is null then null else jsonb_build_object('ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('name', s.name, 'code', s.code) end as site,
    case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as inspector,
    case when ab.id is null then null else jsonb_build_object('id', ab.id, 'full_name', ab.full_name) end as assigner,
    case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name) end as template,
    (select count(*)::int from public.defects d where d.inspection_id = i.id and d.deleted_at is null) as defect_count
  from public.inspections i
  left join public.inspection_templates t on t.id = i.template_id
  left join public.assets a on a.id = i.asset_id
  left join public.sites s on s.id = i.site_id
  left join public.users u on u.id = i.inspector_id
  left join public.users ab on ab.id = i.assigned_by
`

const inspectionInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  kind: z.enum(INSPECTION_KINDS).optional(),
  status: z.enum(INSPECTION_STATUSES).optional(),
  inspector_id: z.string().uuid().nullable().optional(),
  scheduled_date: z.string(),
  completed_date: z.string().nullable().optional(),
  findings: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // [{item, result, notes}] — the shape generate_pm_tasks() already stamps
  // onto a PM task, so a checklist reads the same wherever it appears.
  checklist_results: z.array(z.object({
    item: z.string().min(1).max(300),
    result: z.enum(CHECKLIST_RESULTS).default('pending'),
    notes: z.string().max(500).nullable().optional(),
  })).nullable().optional(),
  report_url: z.string().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  condition_rating: z.number().int().min(1).max(5).nullable().optional(),
})

const inspectionListInput = listQuery({
  statuses: z.string().optional(),
  asset_id: z.string().uuid().optional().or(z.literal('')),
  location_id: z.string().uuid().optional().or(z.literal('')),
})

inspectionsRouter.get('/inspections', requireCap('inspection:read'), async (req, res) => {
  const q = parseOr400(inspectionListInput, req.query, res)
  if (!q) return
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    if (q.statuses) {
      values.push(q.statuses.split(','))
      clauses.push(`and i.status = any($${values.length})`)
    }
    if (q.asset_id) { values.push(q.asset_id); clauses.push(`and i.asset_id = $${values.length}`) }
    if (q.location_id) { values.push(q.location_id); clauses.push(`and i.site_id in (select id from public.sites where location_id = $${values.length})`) }
    clauses.push('order by i.scheduled_date desc')
    values.push(q.limit, q.offset)
    clauses.push(`limit $${values.length - 1} offset $${values.length}`)
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

inspectionsRouter.post('/inspections', requireCap('inspection:create'), async (req, res) => {
  const parsed = inspectionInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  // Nobody is sent to inspect at a shut-down site (0027).
  if (await withOrgContext(claimsFromReq(req), (c) => isSiteShutdown(c, parsed.data.site_id, parsed.data.asset_id))) {
    return res.status(422).json(SITE_SHUTDOWN_ERROR)
  }

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const data: Record<string, unknown> = { ...parsed.data }

    // A template is expanded onto the inspection at creation, exactly as
    // generate_pm_tasks() does for a PM schedule: the inspection carries its
    // own copy, so editing the template later never rewrites an inspection
    // that has already been carried out.
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
    // Creating an inspection with an inspector IS an assignment, so it gets the
    // same attribution as a later reassignment.
    if (parsed.data.inspector_id) {
      await c.query(
        'update public.inspections set assigned_by = $2, assigned_at = now() where id = $1',
        [rows[0].id, req.claims!.sub]
      )
    }
    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [rows[0].id])
    const inspection = full[0]
    await writeAuditLog(c, { orgId: inspection.org_id, actorId: req.claims!.sub, action: 'inspection.create', entityType: 'inspection', entityId: inspection.id, after: inspection })
    if (inspection.inspector_id) {
      const assignerName = inspection.assigner?.full_name
      await notifyUsers(c, {
        orgId: inspection.org_id, userIds: [inspection.inspector_id], actorId: req.claims!.sub,
        kind: 'inspection_assigned', title: `Inspection assigned to you: ${inspection.title}`,
        body: `Scheduled ${inspection.scheduled_date}.${assignerName ? ` Assigned by ${assignerName}.` : ''}`,
        entityType: 'inspection', entityId: inspection.id,
      })
    }
    return { data: inspection }
  })
  if ('error' in row) return res.status(404).json({ error: 'template_not_found' })
  res.status(201).json(row.data)
})

inspectionsRouter.patch('/inspections/:id', requireCap('inspection:update'), async (req, res) => {
  const parsed = inspectionInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch: Record<string, unknown> = { ...parsed.data }
  if (patch.status === 'completed' && !patch.completed_date) patch.completed_date = new Date().toISOString().slice(0, 10)
  if (parsed.data.checklist_results) patch.checklist_results = JSON.stringify(parsed.data.checklist_results)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: before } = await c.query(
      'select inspector_id, status, asset_id, condition_rating from public.inspections where id = $1',
      [req.params.id]
    )
    if (!before[0]) return null

    // An inspection is completed by recording what was found, not by flipping
    // a status. Without the 1-5 rating the condition score has nothing to
    // read, and a score built on a rating nobody gave is a guess.
    if (patch.status === 'completed' && (parsed.data.condition_rating ?? before[0].condition_rating) == null) {
      return { error: 'condition_rating_required' as const }
    }

    const { setSql, values } = buildSet(patch, ALLOWED)
    if (!setSql) return { error: 'empty_patch' as const }
    const inspectorChanged = 'inspector_id' in patch && patch.inspector_id !== before[0].inspector_id
    const justCompleted = patch.status === 'completed' && before[0].status !== 'completed'

    const { rows } = await c.query(`update public.inspections set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null

    if (inspectorChanged) {
      await c.query(
        `update public.inspections
         set assigned_by = case when $2::uuid is null then null else $3::uuid end,
             assigned_at = case when $2::uuid is null then null else now() end
         where id = $1`,
        [req.params.id, parsed.data.inspector_id ?? null, req.claims!.sub]
      )
    }

    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
    const inspection = full[0]
    // A reassignment gets its own action and a real `before`. It used to land
    // as a generic `inspection.update` with no before, so the audit log could
    // not even be read as "this was an assignment", let alone say from whom.
    if (inspectorChanged) {
      await writeAuditLog(c, {
        orgId: inspection.org_id, actorId: req.claims!.sub, action: 'inspection.assign',
        entityType: 'inspection', entityId: inspection.id,
        before: { inspector_id: before[0].inspector_id }, after: { inspector_id: parsed.data.inspector_id ?? null },
      })
    } else {
      await writeAuditLog(c, { orgId: inspection.org_id, actorId: req.claims!.sub, action: 'inspection.update', entityType: 'inspection', entityId: inspection.id, after: inspection })
    }

    if (inspectorChanged && parsed.data.inspector_id) {
      const assignerName = inspection.assigner?.full_name
      await notifyUsers(c, {
        orgId: inspection.org_id, userIds: [parsed.data.inspector_id], actorId: req.claims!.sub,
        kind: 'inspection_assigned', title: `Inspection assigned to you: ${inspection.title}`,
        body: `Scheduled ${inspection.scheduled_date}.${assignerName ? ` Assigned by ${assignerName}.` : ''}`,
        entityType: 'inspection', entityId: inspection.id,
      })
    }
    if (justCompleted) {
      // hse_officer is the compliance-owning role for inspections (per the
      // app's own role matrix) so it's included here alongside owner/admin/manager,
      // unlike PM-task completion which stays owner/admin/manager only.
      await notifyRoleHolders(c, {
        orgId: inspection.org_id, siteId: inspection.site_id, roles: ['owner', 'admin', 'manager', 'hse_officer'],
        actorId: req.claims!.sub, kind: 'work_completed',
        title: `Inspection completed: ${inspection.title}`,
        body: inspection.findings ? String(inspection.findings).slice(0, 120) : 'Completed.',
        entityType: 'inspection', entityId: inspection.id,
        dedupePrefix: `work_completed:inspection:${inspection.id}`,
      })
    }
    // A fresh condition rating is a quarter of the asset's score, so it moves
    // straight away rather than waiting for the 01:00 pass.
    await refreshAssetHealth(c, inspection.asset_id, req.claims!.sub)
    if (inspection.asset_id !== before[0].asset_id) {
      await refreshAssetHealth(c, before[0].asset_id, req.claims!.sub)
    }
    return { data: inspection }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  if ('error' in row) {
    if (row.error === 'empty_patch') return res.status(400).json({ error: 'empty_patch' })
    return res.status(422).json({ error: 'condition_rating_required' })
  }
  res.json(row.data)
})

// Inspection report upload — attach a report file after the inspection is done.
inspectionsRouter.post('/inspections/:id/report', requireCap('inspection:update'), ...uploadRoute({ subdir: 'inspection-reports', field: 'report', mime: DOCUMENT_MIME_TYPES }, async (req, res, file) => {
  const url = file.url
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('update public.inspections set report_url = $2 where id = $1 returning id, org_id, asset_id', [req.params.id, url])
    if (!rows[0]) return null
    if (rows[0].asset_id) {
      await c.query(
        `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
         values (current_org_id(), $1, current_user_id(), 'inspection', 'Inspection report uploaded.', $2::jsonb)`,
        [rows[0].asset_id, JSON.stringify([{ url, name: file.name }])]
      )
    }
    const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
    const inspection = full[0]
    await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'inspection.attachment.add', entityType: 'inspection', entityId: rows[0].id, after: { url, name: file.name } })
    await notifyRoleHolders(c, {
      orgId: inspection.org_id, siteId: inspection.site_id, roles: ['owner', 'admin', 'manager', 'hse_officer'],
      actorId: req.claims!.sub, kind: 'report_uploaded',
      title: `Inspection report uploaded: ${inspection.title}`,
      body: file.name, entityType: 'inspection', entityId: inspection.id,
      dedupePrefix: `report_uploaded:inspection:${inspection.id}`,
    })
    return inspection
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
}))

// ── Checklist templates ──────────────────────────────────────────────────────
// The checklist definition inspections never had (0023). PM's template lives
// on the schedule; inspections have no schedule, so it is its own reusable
// record, picked when the inspection is raised and copied onto it.

const templateInput = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(INSPECTION_KINDS).optional(),
  description: z.string().nullable().optional(),
  items: z.array(z.string().min(1).max(300)).max(100),
  active: z.boolean().optional(),
})

const TEMPLATE_ALLOWED = ['name', 'kind', 'description', 'items', 'active']

inspectionsRouter.get('/inspection-templates', requireCap('inspection:read'), async (req, res) => {
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

