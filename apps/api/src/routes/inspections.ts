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
import { uploadTo, cleanupOrphanedUpload } from '../files.js'
import { notifyUsers, notifyRoleHolders } from '../notify.js'
import { refreshAssetHealth } from '../healthService.js'

export const inspectionsRouter = Router()
inspectionsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const reportUpload = uploadTo('inspection-reports')

const ALLOWED = [
  'asset_id', 'site_id', 'title', 'kind', 'status', 'inspector_id',
  'scheduled_date', 'completed_date', 'findings', 'notes', 'checklist_results', 'report_url',
  // 0023 — the checklist behind the results, and the outcome the condition
  // score reads.
  'template_id', 'condition_rating',
]

export const INSPECTION_KINDS = ['safety', 'condition', 'integrity', 'regulatory', 'environmental'] as const
export const CHECKLIST_RESULTS = ['pass', 'fail', 'na', 'pending'] as const

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
  kind: z.enum(['safety', 'condition', 'integrity', 'regulatory', 'environmental']).optional(),
  status: z.enum(['scheduled', 'due', 'in_progress', 'completed', 'overdue']).optional(),
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

inspectionsRouter.get('/inspections', async (req, res) => {
  const { statuses, limit, asset_id, location_id } = req.query
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where 1=1']
    const values: unknown[] = []
    if (typeof statuses === 'string' && statuses) {
      values.push(statuses.split(','))
      clauses.push(`and i.status = any($${values.length})`)
    }
    if (typeof asset_id === 'string' && asset_id) { values.push(asset_id); clauses.push(`and i.asset_id = $${values.length}`) }
    if (typeof location_id === 'string' && location_id) { values.push(location_id); clauses.push(`and i.site_id in (select id from public.sites where location_id = $${values.length})`) }
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
      // app's own role matrix) so it's included here alongside owner/ops_manager,
      // unlike PM-task completion which stays owner/ops_manager only.
      await notifyRoleHolders(c, {
        orgId: inspection.org_id, siteId: inspection.site_id, roles: ['owner', 'ops_manager', 'hse_officer'],
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
inspectionsRouter.post('/inspections/:id/report', requireCap('inspection:update'), reportUpload.single('report'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })
  const url = `inspection-reports/${req.file.filename}`
  let row
  try {
    row = await withOrgContext(claimsFromReq(req), async (c) => {
      const { rows } = await c.query('update public.inspections set report_url = $2 where id = $1 returning id, org_id, asset_id', [req.params.id, url])
      if (!rows[0]) return null
      if (rows[0].asset_id) {
        await c.query(
          `insert into public.asset_activity (org_id, asset_id, user_id, kind, body, attachments)
           values (current_org_id(), $1, current_user_id(), 'inspection', 'Inspection report uploaded.', $2::jsonb)`,
          [rows[0].asset_id, JSON.stringify([{ url, name: req.file!.originalname }])]
        )
      }
      const { rows: full } = await c.query(`${SELECT} where i.id = $1`, [req.params.id])
      const inspection = full[0]
      await writeAuditLog(c, { orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'inspection.attachment.add', entityType: 'inspection', entityId: rows[0].id, after: { url, name: req.file!.originalname } })
      await notifyRoleHolders(c, {
        orgId: inspection.org_id, siteId: inspection.site_id, roles: ['owner', 'ops_manager', 'hse_officer'],
        actorId: req.claims!.sub, kind: 'report_uploaded',
        title: `Inspection report uploaded: ${inspection.title}`,
        body: req.file!.originalname, entityType: 'inspection', entityId: inspection.id,
        dedupePrefix: `report_uploaded:inspection:${inspection.id}`,
      })
      return inspection
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

/** One inspection with the defects raised from it — the first half of the
 * inspection -> defect -> work order chain, read from the inspection's end. */
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
