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

export const sparePartsRouter = Router()
sparePartsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = [
  'part_number', 'name', 'description', 'category', 'unit', 'unit_cost_cents',
  'reorder_level', 'reorder_quantity', 'supplier', 'storage_location', 'notes', 'active',
]

// quantity_in_stock is deliberately NOT in ALLOWED. Stock only ever moves
// through /adjust, so every change leaves a ledger row behind it.
const SELECT = `
  select p.*,
    (p.reorder_level > 0 and p.quantity_in_stock <= p.reorder_level) as is_low,
    coalesce((select count(*)::int from public.spare_part_assets spa where spa.part_id = p.id), 0) as linked_asset_count
  from public.spare_parts p
`

const partInput = z.object({
  part_number: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  unit: z.string().min(1).optional(),
  unit_cost_cents: z.number().int().nonnegative().optional(),
  reorder_level: z.number().nonnegative().optional(),
  reorder_quantity: z.number().nonnegative().nullable().optional(),
  supplier: z.string().nullable().optional(),
  storage_location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().optional(),
  // Opening stock, applied through the ledger on create so the very first
  // balance has a movement behind it like every later one.
  opening_stock: z.number().nonnegative().optional(),
})

sparePartsRouter.get('/spare-parts', requireCap('parts:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where p.deleted_at is null']
    const values: unknown[] = []
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    if (q) {
      values.push(`%${q}%`)
      clauses.push(`and (p.part_number ilike $${values.length} or p.name ilike $${values.length} or p.supplier ilike $${values.length})`)
    }
    const category = typeof req.query.category === 'string' ? req.query.category : ''
    if (category && category !== 'all') { values.push(category); clauses.push(`and p.category = $${values.length}`) }
    if (req.query.low_stock === 'true') clauses.push('and p.reorder_level > 0 and p.quantity_in_stock <= p.reorder_level')
    if (req.query.include_inactive !== 'true') clauses.push('and p.active')
    // Parts that fit a given asset, for the asset page's spares list.
    const assetId = typeof req.query.asset_id === 'string' ? req.query.asset_id : ''
    if (assetId) {
      values.push(assetId)
      clauses.push(`and exists (select 1 from public.spare_part_assets spa where spa.part_id = p.id and spa.asset_id = $${values.length})`)
    }
    clauses.push('order by p.name asc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

sparePartsRouter.get('/spare-parts/stats', requireCap('parts:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select
         count(*)::int as total,
         count(*) filter (where reorder_level > 0 and quantity_in_stock <= reorder_level)::int as low_stock,
         count(*) filter (where quantity_in_stock = 0)::int as out_of_stock,
         coalesce(sum(quantity_in_stock * unit_cost_cents), 0)::bigint as stock_value_cents
       from public.spare_parts
       where deleted_at is null and active`
    ).then((r) => r.rows[0])
  )
  res.json(row)
})

sparePartsRouter.get('/spare-parts/categories', requireCap('parts:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select category, count(*)::int as n from public.spare_parts
       where deleted_at is null and category is not null group by category order by category`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

sparePartsRouter.get('/spare-parts/:id', requireCap('parts:read'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`${SELECT} where p.id = $1`, [req.params.id])
    if (!rows[0]) return null
    const [{ rows: assets }, { rows: movements }] = await Promise.all([
      c.query(
        `select a.id, a.ain, a.name from public.spare_part_assets spa
         join public.assets a on a.id = spa.asset_id
         where spa.part_id = $1 and a.deleted_at is null order by a.ain`,
        [req.params.id]
      ),
      c.query(
        `select m.*,
           case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor,
           case when w.id is null then null else jsonb_build_object('id', w.id, 'ref', w.ref, 'title', w.title) end as work_order
         from public.stock_movements m
         left join public.users u on u.id = m.actor_id
         left join public.work_orders w on w.id = m.work_order_id
         where m.part_id = $1 order by m.created_at desc limit 50`,
        [req.params.id]
      ),
    ])
    return { ...rows[0], assets, movements }
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

sparePartsRouter.post('/spare-parts', requireCap('parts:create'), async (req, res) => {
  const parsed = partInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { opening_stock, ...fields } = parsed.data
  const { columns, placeholders, values } = buildInsert(fields, ALLOWED)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.spare_parts (org_id, created_by, ${columns})
       values (current_org_id(), current_user_id(), ${placeholders})
       returning id, org_id`,
      values
    )
    const part = rows[0]

    if (opening_stock && opening_stock > 0) {
      await c.query('update public.spare_parts set quantity_in_stock = $2 where id = $1', [part.id, opening_stock])
      await c.query(
        `insert into public.stock_movements (org_id, part_id, kind, quantity, balance_after, unit_cost_cents, reason, actor_id)
         values (current_org_id(), $1, 'receipt', $2, $2, $3, 'Opening stock', current_user_id())`,
        [part.id, opening_stock, fields.unit_cost_cents ?? null]
      )
    }

    await writeAuditLog(c, {
      orgId: part.org_id, actorId: req.claims!.sub, action: 'part.create',
      entityType: 'spare_part', entityId: part.id, after: { ...fields, opening_stock: opening_stock ?? 0 },
    })
    const { rows: full } = await c.query(`${SELECT} where p.id = $1`, [part.id])
    return full[0]
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message.includes('spare_parts_org_id_part_number_key')) return 'duplicate' as const
    throw err
  })

  if (result === 'duplicate') return res.status(409).json({ error: 'duplicate_part_number' })
  res.status(201).json(result)
})

sparePartsRouter.patch('/spare-parts/:id', requireCap('parts:update'), async (req, res) => {
  const parsed = partInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.spare_parts set ${setSql} where id = $1 and deleted_at is null returning id, org_id`,
      [req.params.id, ...values]
    )
    if (!rows[0]) return null
    await writeAuditLog(c, {
      orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'part.update',
      entityType: 'spare_part', entityId: rows[0].id, after: parsed.data,
    })
    const { rows: full } = await c.query(`${SELECT} where p.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

sparePartsRouter.delete('/spare-parts/:id', requireCap('parts:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.spare_parts set deleted_at = now() where id = $1 and deleted_at is null returning id, org_id',
      [req.params.id]
    )
    if (rows[0]) {
      await writeAuditLog(c, {
        orgId: rows[0].org_id, actorId: req.claims!.sub, action: 'part.archive',
        entityType: 'spare_part', entityId: rows[0].id,
      })
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

// ── Stock movement ───────────────────────────────────────────────────────────
const adjustInput = z.object({
  kind: z.enum(['receipt', 'issue', 'adjustment', 'return']),
  // Always positive; `kind` decides the sign. A UI that has to remember to send
  // -3 for an issue will eventually send +3.
  quantity: z.number().positive(),
  reason: z.string().max(300).nullable().optional(),
  unit_cost_cents: z.number().int().nonnegative().nullable().optional(),
})

sparePartsRouter.post('/spare-parts/:id/adjust', requireCap('parts:adjust'), async (req, res) => {
  const parsed = adjustInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { kind, quantity, reason, unit_cost_cents } = parsed.data
  const delta = kind === 'issue' ? -quantity : quantity
  const partId = String(req.params.id)

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    // Lock the row so two concurrent issues can't both read the same balance.
    const { rows: cur } = await c.query(
      'select id, org_id, quantity_in_stock, unit_cost_cents from public.spare_parts where id = $1 and deleted_at is null for update',
      [req.params.id]
    )
    if (!cur[0]) return { error: 'not_found' as const }

    const balanceAfter = Number(cur[0].quantity_in_stock) + delta
    if (balanceAfter < 0) {
      return { error: 'insufficient_stock' as const, in_stock: Number(cur[0].quantity_in_stock) }
    }

    await c.query('update public.spare_parts set quantity_in_stock = $2 where id = $1', [req.params.id, balanceAfter])
    await c.query(
      `insert into public.stock_movements (org_id, part_id, kind, quantity, balance_after, unit_cost_cents, reason, actor_id)
       values (current_org_id(), $1, $2, $3, $4, $5, $6, current_user_id())`,
      [req.params.id, kind, delta, balanceAfter, unit_cost_cents ?? cur[0].unit_cost_cents, reason ?? null]
    )
    // A receipt at a new price becomes the part's going rate.
    if (kind === 'receipt' && unit_cost_cents != null) {
      await c.query('update public.spare_parts set unit_cost_cents = $2 where id = $1', [req.params.id, unit_cost_cents])
    }

    await writeAuditLog(c, {
      orgId: cur[0].org_id, actorId: req.claims!.sub, action: `part.${kind}`,
      entityType: 'spare_part', entityId: partId,
      before: { quantity_in_stock: Number(cur[0].quantity_in_stock) },
      after: { quantity_in_stock: balanceAfter, quantity: delta, reason },
    })

    const { rows: full } = await c.query(`${SELECT} where p.id = $1`, [req.params.id])
    return { data: full[0] }
  })

  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(409).json({ error: 'insufficient_stock', in_stock: result.in_stock })
  }
  res.json(result.data)
})

sparePartsRouter.get('/spare-parts/:id/movements', requireCap('parts:read'), async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select m.*,
         case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as actor,
         case when w.id is null then null else jsonb_build_object('id', w.id, 'ref', w.ref, 'title', w.title) end as work_order
       from public.stock_movements m
       left join public.users u on u.id = m.actor_id
       left join public.work_orders w on w.id = m.work_order_id
       where m.part_id = $1 order by m.created_at desc limit 200`,
      [req.params.id]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

// ── Part ↔ asset links ───────────────────────────────────────────────────────
sparePartsRouter.post('/spare-parts/:id/assets', requireCap('parts:update'), async (req, res) => {
  const parsed = z.object({ asset_id: z.string().uuid() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.spare_part_assets (org_id, part_id, asset_id)
       values (current_org_id(), $1, $2) on conflict do nothing`,
      [req.params.id, parsed.data.asset_id]
    )
  )
  res.status(204).end()
})

sparePartsRouter.delete('/spare-parts/:id/assets/:assetId', requireCap('parts:update'), async (req, res) => {
  await withOrgContext(claimsFromReq(req), (c) =>
    c.query('delete from public.spare_part_assets where part_id = $1 and asset_id = $2', [req.params.id, req.params.assetId])
  )
  res.status(204).end()
})
