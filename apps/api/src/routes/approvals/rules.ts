import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap, ROLE_KEYS } from '../../middleware/rbac.js'
import { writeAuditLog } from '../../audit.js'
import { buildSet } from '../../sqlUtil.js'
import { APPROVAL_ENTITY_TYPES, APPROVAL_KINDS } from '@assetcore/domain'
import { RULE_SELECT } from './shared.js'

export const rulesRouter = Router()

// ── The matrix ───────────────────────────────────────────────────────────────
// Owner-only: who signs off on what is an org governance decision, not
// something an operations manager grants themselves.

const levelInput = z.object({
  role_key: z.enum(ROLE_KEYS),
  label: z.string().max(120).nullable().optional(),
})

const ruleInput = z.object({
  name: z.string().min(1).max(160),
  entity_type: z.enum(APPROVAL_ENTITY_TYPES),
  kind: z.enum(APPROVAL_KINDS),
  min_amount_cents: z.number().int().nonnegative().optional(),
  max_amount_cents: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
  // Order is the routing order: levels[0] signs first.
  levels: z.array(levelInput).min(1).max(5),
})

const RULE_ALLOWED = ['name', 'entity_type', 'kind', 'min_amount_cents', 'max_amount_cents', 'active']

rulesRouter.get('/approval-rules', requireCap('approval:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `${RULE_SELECT} where r.deleted_at is null
       order by r.entity_type, r.kind, r.min_amount_cents`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

async function replaceLevels(c: import('pg').PoolClient, ruleId: string, levels: z.infer<typeof levelInput>[]) {
  await c.query('delete from public.approval_rule_levels where rule_id = $1', [ruleId])
  for (const [i, level] of levels.entries()) {
    await c.query(
      `insert into public.approval_rule_levels (org_id, rule_id, level, role_key, label)
       values (current_org_id(), $1, $2, $3, $4)`,
      [ruleId, i + 1, level.role_key, level.label ?? null]
    )
  }
}

rulesRouter.post('/approval-rules', requireCap('approval:manage'), async (req, res) => {
  const parsed = ruleInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { levels, ...fields } = parsed.data
  if (fields.max_amount_cents != null && fields.max_amount_cents <= (fields.min_amount_cents ?? 0)) {
    return res.status(422).json({ error: 'invalid_band' })
  }

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.approval_rules
         (org_id, created_by, name, entity_type, kind, min_amount_cents, max_amount_cents, active)
       values (current_org_id(), current_user_id(), $1, $2, $3, $4, $5, $6)
       returning id, org_id`,
      [fields.name, fields.entity_type, fields.kind, fields.min_amount_cents ?? 0,
       fields.max_amount_cents ?? null, fields.active ?? true]
    )
    await replaceLevels(c, rows[0].id, levels)
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'approval.rule.create',
      entityType: 'approval_rule', entityId: rows[0].id, after: parsed.data,
    })
    const { rows: full } = await c.query(`${RULE_SELECT} where r.id = $1`, [rows[0].id])
    return full[0]
  })
  res.status(201).json(row)
})

rulesRouter.patch('/approval-rules/:id', requireCap('approval:manage'), async (req, res) => {
  const parsed = ruleInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { levels, ...fields } = parsed.data
  const { setSql, values } = buildSet(fields, RULE_ALLOWED)
  if (!setSql && !levels) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // The band has to be checked against what the rule will BE, not against
    // what the patch happens to carry: raising only the floor above the stored
    // ceiling is just as invalid as sending both. Without this the DB's
    // approval_rules_check raises and escapes as a 500, so an editor is told
    // to call an administrator about a range they could fix themselves —
    // while the create path answers a typed 422. Same rule, same answer.
    if (fields.min_amount_cents !== undefined || fields.max_amount_cents !== undefined) {
      const { rows: current } = await c.query(
        'select min_amount_cents, max_amount_cents from public.approval_rules where id = $1 and deleted_at is null',
        [req.params.id]
      )
      if (!current[0]) return null
      const min = fields.min_amount_cents ?? Number(current[0].min_amount_cents ?? 0)
      const max = fields.max_amount_cents !== undefined
        ? fields.max_amount_cents
        : (current[0].max_amount_cents == null ? null : Number(current[0].max_amount_cents))
      if (max != null && max <= min) return { error: 'invalid_band' as const }
    }
    if (setSql) {
      const { rows } = await c.query(
        `update public.approval_rules set ${setSql} where id = $1 and deleted_at is null returning id`,
        [req.params.id, ...values]
      )
      if (!rows[0]) return null
    }
    if (levels) await replaceLevels(c, String(req.params.id), levels)
    const { rows: full } = await c.query(`${RULE_SELECT} where r.id = $1 and r.deleted_at is null`, [req.params.id])
    if (!full[0]) return null
    await writeAuditLog(c, {
      orgId: full[0].org_id, actorId: req.claims!.sub, action: 'approval.rule.update',
      entityType: 'approval_rule', entityId: String(req.params.id), after: parsed.data,
    })
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  if ('error' in row) return res.status(422).json({ error: row.error })
  res.json(row)
})

rulesRouter.delete('/approval-rules/:id', requireCap('approval:manage'), async (req, res) => {
  // Soft delete: requests already routed by this rule keep pointing at it, so
  // "who was supposed to sign this?" stays answerable after it's retired.
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.approval_rules set deleted_at = now(), active = false where id = $1 and deleted_at is null returning id, org_id',
      [req.params.id]
    )
    if (rows[0]) {
      await writeAuditLog(c, {
        orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'approval.rule.retire',
        entityType: 'approval_rule', entityId: rows[0].id,
      })
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
