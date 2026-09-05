import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'

export const categoriesRouter = Router()
categoriesRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = ['name', 'code', 'description', 'depreciation_method', 'useful_life_years', 'salvage_value_percent']

const categoryInput = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // Defaults a new asset in this category inherits (0002). Phase 2's
  // depreciation engine reads them when building a schedule.
  depreciation_method: z.enum(['straight_line', 'declining_balance', 'sum_of_years_digits', 'units_of_production']).optional(),
  useful_life_years: z.number().nonnegative().nullable().optional(),
  salvage_value_percent: z.number().min(0).max(100).nullable().optional(),
})

categoriesRouter.get('/categories', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select * from public.asset_categories order by name').then((r) => r.rows)
  )
  res.json(rows)
})

categoriesRouter.post('/categories', async (req, res) => {
  const parsed = categoryInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.asset_categories (org_id, ${columns}) values (current_org_id(), ${placeholders}) returning *`,
      values
    )
    const cat = rows[0]
    await writeAuditLog(c, { orgId: cat.org_id, actorId: req.claims!.sub, action: 'category.create', entityType: 'asset_category', entityId: cat.id, after: cat })
    return cat
  })
  res.status(201).json(row)
})

categoriesRouter.patch('/categories/:id', async (req, res) => {
  const parsed = categoryInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.asset_categories set ${setSql} where id = $1 returning *`,
      [req.params.id, ...values]
    )
    const cat = rows[0]
    if (cat) await writeAuditLog(c, { orgId: cat.org_id, actorId: req.claims!.sub, action: 'category.update', entityType: 'asset_category', entityId: cat.id, after: parsed.data })
    return cat
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

categoriesRouter.delete('/categories/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('delete from public.asset_categories where id = $1 returning id, org_id', [req.params.id])
    const cat = rows[0]
    if (cat) await writeAuditLog(c, { orgId: cat.org_id, actorId: req.claims!.sub, action: 'category.delete', entityType: 'asset_category', entityId: cat.id })
    return cat
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
