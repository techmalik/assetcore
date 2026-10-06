import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { buildSet } from '../../sqlUtil.js'
import { parseOr400 } from '../../http/validate.js'
import { send } from '../../http/result.js'
import { auditFromReq } from '../../audit.js'

export const partsRouter = Router()

// ── Parts on a work order ────────────────────────────────────────────────────
// Replaces the free-text `parts` JSON blob with lines that point at real stock.

const woPartInput = z.object({
  part_id: z.string().uuid().nullable().optional(),
  description: z.string().max(300).nullable().optional(),
  quantity_required: z.number().positive(),
  quantity_used: z.number().nonnegative().optional(),
  unit_cost_cents: z.number().int().nonnegative().nullable().optional(),
}).refine((v) => v.part_id || v.description, { message: 'part_id or description required' })

partsRouter.post('/work-orders/:id/parts', requireCap('wo:update'), async (req, res) => {
  const input = parseOr400(woPartInput, req.body, res)
  if (!input) return
  const d = input

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Snapshot the price now: what it cost on the day is what the job cost,
    // even if the part is repriced later.
    let unitCost = d.unit_cost_cents ?? null
    if (unitCost == null && d.part_id) {
      const { rows } = await c.query('select unit_cost_cents from public.spare_parts where id = $1', [d.part_id])
      unitCost = rows[0] ? Number(rows[0].unit_cost_cents) : null
    }
    const { rows } = await c.query(
      `insert into public.work_order_parts
         (org_id, work_order_id, part_id, description, quantity_required, quantity_used, unit_cost_cents, added_by)
       values (current_org_id(), $1, $2, $3, $4, $5, $6, current_user_id())
       returning id`,
      [req.params.id, d.part_id ?? null, d.description ?? null, d.quantity_required, d.quantity_used ?? 0, unitCost]
    )
    const { rows: full } = await c.query(
      `select wp.*,
         case when sp.id is null then null else jsonb_build_object(
           'id', sp.id, 'part_number', sp.part_number, 'name', sp.name,
           'unit', sp.unit, 'quantity_in_stock', sp.quantity_in_stock) end as part
       from public.work_order_parts wp
       left join public.spare_parts sp on sp.id = wp.part_id where wp.id = $1`,
      [rows[0].id]
    )
    await auditFromReq(c, req, {
      action: 'wo.part.add', entityType: 'work_order', entityId: String(req.params.id),
      after: { line_id: rows[0].id, part_id: d.part_id ?? null, part: full[0].part?.part_number ?? null, description: d.description ?? null, quantity_required: d.quantity_required },
    })
    return full[0]
  })
  res.status(201).json(row)
})

partsRouter.patch('/work-orders/:id/parts/:lineId', requireCap('wo:update'), async (req, res) => {
  const input = parseOr400(z.object({
    quantity_required: z.number().positive().optional(),
    quantity_used: z.number().nonnegative().optional(),
    unit_cost_cents: z.number().int().nonnegative().nullable().optional(),
    description: z.string().max(300).nullable().optional(),
  }), req.body, res)
  if (!input) return

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    // Once stock has moved for a line, editing it would put the ledger and the
    // balance out of step. Reverse it with a stock adjustment instead.
    const { rows: cur } = await c.query(
      'select consumed_at, quantity_required, quantity_used, unit_cost_cents, description from public.work_order_parts where id = $1 and work_order_id = $2',
      [req.params.lineId, req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }
    if (cur[0].consumed_at) return { error: 'already_consumed' as const }

    const { setSql, values } = buildSet(input, ['quantity_required', 'quantity_used', 'unit_cost_cents', 'description'])
    if (!setSql) return { error: 'empty_patch' as const }
    const { rows } = await c.query(
      `update public.work_order_parts set ${setSql} where id = $1 returning *`,
      [req.params.lineId, ...values]
    )
    const { consumed_at: _consumed, ...before } = cur[0]
    await auditFromReq(c, req, {
      action: 'wo.part.update', entityType: 'work_order', entityId: String(req.params.id),
      before: { line_id: req.params.lineId, ...before }, after: { line_id: req.params.lineId, ...input },
    })
    return { data: rows[0] }
  })

  send(res, result, { not_found: 404, already_consumed: 409, empty_patch: 400 })
})

partsRouter.delete('/work-orders/:id/parts/:lineId', requireCap('wo:update'), async (req, res) => {
  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'delete from public.work_order_parts where id = $1 and work_order_id = $2 and consumed_at is null returning id, part_id, description, quantity_required',
      [req.params.lineId, req.params.id]
    )
    if (rows[0]) {
      const { id, ...line } = rows[0]
      await auditFromReq(c, req, {
        action: 'wo.part.delete', entityType: 'work_order', entityId: String(req.params.id),
        before: { line_id: id, ...line },
      })
      return { ok: true }
    }
    const { rows: exists } = await c.query(
      'select consumed_at from public.work_order_parts where id = $1 and work_order_id = $2',
      [req.params.lineId, req.params.id]
    )
    return exists[0] ? { error: 'already_consumed' as const } : { error: 'not_found' as const }
  })
  if ('error' in result) {
    return res.status(result.error === 'already_consumed' ? 409 : 404).json({ error: result.error })
  }
  res.status(204).end()
})
