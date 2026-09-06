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
import { generateWoRef } from './workOrders.js'

export const defectsRouter = Router()
defectsRouter.use(requireAuth, requireOrg, requireActiveMembership)

export const DEFECT_SEVERITIES = ['minor', 'moderate', 'major', 'critical'] as const
export const DEFECT_STATUSES = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'deferred'] as const
const OPEN_STATUSES = ['open', 'acknowledged', 'in_progress', 'deferred']

// A defect's severity is about the finding; a work order's priority is about
// the response. They are not the same scale, so the jump between them is
// stated once here rather than guessed at each call site.
const SEVERITY_TO_PRIORITY: Record<string, string> = {
  minor: 'low',
  moderate: 'medium',
  major: 'high',
  critical: 'critical',
}

const ALLOWED = [
  'asset_id', 'site_id', 'inspection_id', 'title', 'description', 'severity', 'status',
  'category', 'assigned_to', 'identified_date', 'due_date', 'resolution_notes',
]

const SELECT = `
  select d.*,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when i.id is null then null else jsonb_build_object('id', i.id, 'title', i.title, 'kind', i.kind, 'completed_date', i.completed_date) end as inspection,
    case when w.id is null then null else jsonb_build_object('id', w.id, 'ref', w.ref, 'title', w.title, 'status', w.status, 'priority', w.priority) end as work_order,
    case when ru.id is null then null else jsonb_build_object('id', ru.id, 'full_name', ru.full_name) end as reporter,
    case when au.id is null then null else jsonb_build_object('id', au.id, 'full_name', au.full_name) end as assignee
  from public.defects d
  left join public.assets a on a.id = d.asset_id
  left join public.sites s on s.id = d.site_id
  left join public.inspections i on i.id = d.inspection_id
  left join public.work_orders w on w.id = d.work_order_id
  left join public.users ru on ru.id = d.reported_by
  left join public.users au on au.id = d.assigned_to
`

const dateField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v))
  .refine((v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: 'expected YYYY-MM-DD' })

const defectInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  inspection_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  description: z.string().nullable().optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  status: z.enum(DEFECT_STATUSES).optional(),
  category: z.string().max(100).nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  identified_date: dateField,
  due_date: dateField,
  resolution_notes: z.string().nullable().optional(),
})

/** DEF-{year}-{4-digit sequence within the org}, mirroring the work order ref
 * format so the two read alike on a page that shows both. */
async function generateDefectRef(c: import('pg').PoolClient): Promise<string> {
  const year = new Date().getFullYear()
  const { rows } = await c.query(`select count(*)::int as n from public.defects where ref like $1`, [`DEF-${year}-%`])
  return `DEF-${year}-${String(rows[0].n + 1).padStart(4, '0')}`
}

const qp = (req: { query: Record<string, unknown> }, key: string): string | null => {
  const v = req.query[key]
  return typeof v === 'string' && v !== '' && v !== 'all' ? v : null
}

defectsRouter.get('/defects', requireCap('defect:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where d.deleted_at is null']
    const values: unknown[] = []
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('$?', `$${values.length}`)) }

    const status = qp(req, 'status')
    if (status) add('and d.status = $?', status)
    // The default view of a register is what still needs doing.
    if (req.query.open === 'true') { values.push(OPEN_STATUSES); clauses.push(`and d.status = any($${values.length})`) }
    const severity = qp(req, 'severity')
    if (severity) add('and d.severity = $?', severity)
    const assetId = qp(req, 'asset_id')
    if (assetId) add('and d.asset_id = $?', assetId)
    const inspectionId = qp(req, 'inspection_id')
    if (inspectionId) add('and d.inspection_id = $?', inspectionId)
    if (req.query.overdue === 'true') clauses.push("and d.due_date is not null and d.due_date < current_date and d.status not in ('resolved','closed')")

    const q = qp(req, 'q')
    if (q) {
      values.push(`%${q}%`)
      clauses.push(`and (d.ref ilike $${values.length} or d.title ilike $${values.length} or d.description ilike $${values.length})`)
    }

    // Worst first: a register sorted by date buries the thing that matters.
    clauses.push(`order by case d.severity when 'critical' then 0 when 'major' then 1 when 'moderate' then 2 else 3 end,
                  d.due_date asc nulls last, d.identified_date desc`)
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

defectsRouter.get('/defects/stats', requireCap('defect:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select
         count(*) filter (where status = any($1))::int                              as open,
         count(*) filter (where status = any($1) and severity = 'critical')::int     as critical,
         count(*) filter (where status = any($1) and due_date is not null
                            and due_date < current_date)::int                        as overdue,
         count(*) filter (where status = any($1) and work_order_id is null)::int     as unactioned,
         count(*) filter (where status in ('resolved','closed'))::int                as closed
       from public.defects where deleted_at is null`,
      [OPEN_STATUSES]
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

defectsRouter.get('/defects/:id', requireCap('defect:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where d.id = $1`, [req.params.id]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

defectsRouter.post('/defects', requireCap('defect:create'), async (req, res) => {
  const parsed = defectInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED, 1)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const ref = await generateDefectRef(c)
    const { rows } = await c.query(
      `insert into public.defects (org_id, reported_by, ref${columns ? `, ${columns}` : ''})
       values (current_org_id(), current_user_id(), $1${placeholders ? `, ${placeholders}` : ''})
       returning id, org_id, asset_id`,
      [ref, ...values]
    )
    const created = rows[0]
    // A new defect changes the asset's health immediately — that is the whole
    // reason the register feeds the score.
    await refreshAssetHealth(c, created.asset_id)
    await writeAuditLog(c, {
      orgId: created.org_id, actorId: req.claims!.sub, action: 'defect.create',
      entityType: 'defect', entityId: created.id, after: { ref, ...parsed.data },
    })
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [created.id])
    return full[0]
  })
  res.status(201).json(row)
})

defectsRouter.patch('/defects/:id', requireCap('defect:update'), async (req, res) => {
  const parsed = defectInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const patch = { ...parsed.data }
  const { setSql, values } = buildSet(patch, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  // Resolving stamps the clock; reopening clears it, so a defect that is open
  // again never carries a resolution date.
  const clock = patch.status === undefined ? ''
    : patch.status === 'resolved' || patch.status === 'closed'
      ? ', resolved_at = coalesce(resolved_at, now())'
      : ', resolved_at = null'

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: before } = await c.query('select status, asset_id from public.defects where id = $1 and deleted_at is null', [req.params.id])
    if (!before[0]) return null
    const { rows } = await c.query(
      `update public.defects set ${setSql}${clock} where id = $1 and deleted_at is null returning id, org_id, asset_id`,
      [req.params.id, ...values]
    )
    if (!rows[0]) return null
    // The asset may have moved with the patch — rescore both ends.
    await refreshAssetHealth(c, before[0].asset_id)
    if (rows[0].asset_id !== before[0].asset_id) await refreshAssetHealth(c, rows[0].asset_id)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'defect.update',
      entityType: 'defect', entityId: rows[0].id, before: { status: before[0].status }, after: patch,
    })
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

/**
 * Raise the job that clears this defect.
 *
 * This is the second half of the chain the product was missing: an inspection
 * finds something, that becomes a defect, and the defect becomes a work order
 * that points back at it. Closing that work order resolves the defect
 * (apps/api/src/routes/workOrders.ts), so nobody has to remember to.
 */
const raiseInput = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  sla_due: z.string().nullable().optional(),
  type: z.enum(['corrective', 'preventive', 'inspection', 'emergency']).optional(),
})

defectsRouter.post('/defects/:id/work-order', requireCap('wo:create'), async (req, res) => {
  const parsed = raiseInput.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const input = parsed.data

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select * from public.defects where id = $1 and deleted_at is null',
      [req.params.id]
    )
    const defect = cur[0]
    if (!defect) return { error: 'not_found' as const }
    // One defect, one job. Raising a second would split its history in two.
    if (defect.work_order_id) return { error: 'already_raised' as const, work_order_id: defect.work_order_id }

    const ref = await generateWoRef(c)
    const { rows: woRows } = await c.query(
      `insert into public.work_orders
         (org_id, created_by, ref, title, description, type, priority, asset_id, site_id, assignee_id, sla_due)
       values (current_org_id(), current_user_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id, org_id, ref`,
      [
        ref,
        input.title ?? `${defect.ref}: ${defect.title}`,
        // Carry the finding across rather than making someone retype it.
        input.description ?? defect.description ?? null,
        input.type ?? 'corrective',
        input.priority ?? SEVERITY_TO_PRIORITY[defect.severity] ?? 'medium',
        defect.asset_id,
        defect.site_id,
        input.assignee_id ?? defect.assigned_to ?? null,
        input.sla_due ?? (defect.due_date ? `${defect.due_date}T17:00:00Z` : null),
      ]
    )
    const wo = woRows[0]

    await c.query(
      `update public.defects
          set work_order_id = $2,
              status = case when status = 'open' then 'in_progress' else status end
        where id = $1`,
      [req.params.id, wo.id]
    )
    await c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'comment', $2)`,
      [wo.id, `Raised from defect ${defect.ref} (${defect.severity}).`]
    )
    await writeAuditLog(c, {
      orgId: wo.org_id, actorId: req.claims!.sub, action: 'defect.raise_work_order',
      entityType: 'defect', entityId: defect.id, after: { work_order_id: wo.id, ref: wo.ref },
    })

    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [req.params.id])
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'already_raised', work_order_id: result.work_order_id })
  }
  res.status(201).json(result.data)
})

defectsRouter.delete('/defects/:id', requireCap('defect:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.defects set deleted_at = now() where id = $1 and deleted_at is null returning id, org_id, asset_id',
      [req.params.id]
    )
    if (!rows[0]) return null
    await refreshAssetHealth(c, rows[0].asset_id)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'defect.archive',
      entityType: 'defect', entityId: rows[0].id,
    })
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
