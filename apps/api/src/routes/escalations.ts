import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext, ownerPool } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet } from '../sqlUtil.js'
import { ROLE_KEYS } from './approvals.js'

export const escalationsRouter = Router()
escalationsRouter.use(requireAuth, requireOrg, requireActiveMembership)

export const ESCALATION_ENTITY_TYPES = [
  'work_order', 'pm_task', 'defect', 'inspection', 'approval', 'compliance_licence',
] as const
export const ESCALATION_TRIGGERS = ['overdue', 'unassigned', 'unacknowledged', 'stale'] as const

// Not every trigger makes sense for every entity, and run_escalations() has no
// query for the pairs left out. Offering a combination the evaluator would
// silently skip is worse than not offering it, so the same table gates the
// API and feeds the form.
export const VALID_TRIGGERS: Record<string, string[]> = {
  work_order: ['overdue', 'unassigned', 'stale'],
  pm_task: ['overdue', 'unassigned'],
  defect: ['overdue', 'unacknowledged', 'stale'],
  inspection: ['overdue', 'unassigned'],
  approval: ['overdue', 'unacknowledged'],
  compliance_licence: ['overdue'],
}

const SELECT = `
  select r.*,
    case when nr.key is null then null else nr.label end as notify_role_label,
    (select count(*)::int from public.escalation_events e where e.rule_id = r.id) as fired_count,
    (select max(e.created_at) from public.escalation_events e where e.rule_id = r.id) as last_fired_at
  from public.escalation_rules r
  left join public.roles nr on nr.key = r.notify_role_key
`

const ruleInput = z.object({
  name: z.string().min(1).max(160),
  entity_type: z.enum(ESCALATION_ENTITY_TYPES),
  trigger: z.enum(ESCALATION_TRIGGERS),
  threshold_days: z.number().int().min(0).max(365),
  // Narrowing filters. priority only applies to work orders and severity only
  // to defects; anything else is left null rather than filtering on a column
  // the entity does not have.
  priority: z.enum(['low', 'medium', 'high', 'critical']).nullable().optional(),
  severity: z.enum(['minor', 'moderate', 'major', 'critical']).nullable().optional(),
  notify_role_key: z.enum(ROLE_KEYS),
  active: z.boolean().optional(),
})

const ALLOWED = ['name', 'entity_type', 'trigger', 'threshold_days', 'priority', 'severity', 'notify_role_key', 'active']

/** Rejects a rule the evaluator could never act on, and strips filters that
 * don't apply to the chosen entity. */
function validateRule(d: Partial<z.infer<typeof ruleInput>>): { error: string } | { patch: Record<string, unknown> } {
  const patch: Record<string, unknown> = { ...d }
  if (d.entity_type && d.trigger && !VALID_TRIGGERS[d.entity_type].includes(d.trigger)) {
    return { error: 'invalid_trigger_for_entity' }
  }
  if (d.entity_type && d.entity_type !== 'work_order') patch.priority = null
  if (d.entity_type && d.entity_type !== 'defect') patch.severity = null
  return { patch }
}

escalationsRouter.get('/escalation-rules', requireCap('escalation:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where r.deleted_at is null order by r.entity_type, r.threshold_days`).then((r) => r.rows)
  )
  res.json(rows)
})

/** The last escalations that actually fired — the answer to "is this rule
 * doing anything?", which a list of rules alone can't give. */
escalationsRouter.get('/escalation-events', requireCap('escalation:read'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select e.*, r.name as rule_name, r.notify_role_key
       from public.escalation_events e
       join public.escalation_rules r on r.id = e.rule_id
       order by e.created_at desc limit $1`,
      [limit]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

escalationsRouter.post('/escalation-rules', requireCap('escalation:manage'), async (req, res) => {
  const parsed = ruleInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const checked = validateRule(parsed.data)
  if ('error' in checked) return res.status(422).json({ error: checked.error })
  const d = checked.patch

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.escalation_rules
         (org_id, created_by, name, entity_type, trigger, threshold_days, priority, severity, notify_role_key, active)
       values (current_org_id(), current_user_id(), $1, $2, $3, $4, $5, $6, $7, $8)
       returning id, org_id`,
      [d.name, d.entity_type, d.trigger, d.threshold_days, d.priority ?? null, d.severity ?? null,
       d.notify_role_key, d.active ?? true]
    )
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'escalation.rule.create',
      entityType: 'escalation_rule', entityId: rows[0].id, after: d,
    })
    const { rows: full } = await c.query(`${SELECT} where r.id = $1`, [rows[0].id])
    return full[0]
  })
  res.status(201).json(row)
})

escalationsRouter.patch('/escalation-rules/:id', requireCap('escalation:manage'), async (req, res) => {
  const parsed = ruleInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query(
      'select * from public.escalation_rules where id = $1 and deleted_at is null',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }

    // Validate against the rule as it will be, not just the fields sent — a
    // patch changing only the entity type can still invalidate the trigger.
    const merged = { ...cur[0], ...parsed.data }
    const checked = validateRule(merged)
    if ('error' in checked) return { error: checked.error as 'invalid_trigger_for_entity' }

    const patch = { ...parsed.data } as Record<string, unknown>
    if (merged.entity_type !== 'work_order') patch.priority = null
    if (merged.entity_type !== 'defect') patch.severity = null

    const { setSql, values } = buildSet(patch, ALLOWED)
    if (!setSql) return { error: 'empty_patch' as const }
    await c.query(`update public.escalation_rules set ${setSql} where id = $1`, [req.params.id, ...values])
    await writeAuditLog(c, {
      orgId: cur[0].org_id, actorId: req.claims!.sub, action: 'escalation.rule.update',
      entityType: 'escalation_rule', entityId: String(req.params.id), after: patch,
    })
    const { rows: full } = await c.query(`${SELECT} where r.id = $1`, [req.params.id])
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (result.error === 'empty_patch') return res.status(400).json({ error: 'empty_patch' })
    return res.status(422).json({ error: result.error })
  }
  res.json(result.data)
})

escalationsRouter.delete('/escalation-rules/:id', requireCap('escalation:manage'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.escalation_rules set deleted_at = now(), active = false where id = $1 and deleted_at is null returning id, org_id',
      [req.params.id]
    )
    if (rows[0]) {
      await writeAuditLog(c, {
        orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'escalation.rule.retire',
        entityType: 'escalation_rule', entityId: rows[0].id,
      })
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

/**
 * Run the rules now, for this org only.
 *
 * The cron runs them nightly; this is so somebody writing a rule can see
 * whether it catches anything without waiting until morning. It is the same
 * function, so a dry run here and the real run at 07:15 cannot disagree —
 * and because escalations fire once per entity, running it early simply means
 * the notification arrives early rather than twice.
 */
escalationsRouter.post('/escalation-rules/run', requireCap('escalation:manage'), async (req, res) => {
  // security definer function on the owner pool, matching how jobs.ts calls
  // it; the org id is bound from the caller's own claims, never the body.
  const { rows } = await ownerPool.query('select public.run_escalations($1) as fired', [req.claims!.org_id])
  res.json({ fired: rows[0].fired })
})
