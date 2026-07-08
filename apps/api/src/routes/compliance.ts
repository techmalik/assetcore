import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'

export const complianceRouter = Router()
complianceRouter.use(requireAuth, requireOrg)

const ALLOWED = ['site_id', 'asset_id', 'authority_id', 'name', 'licence_number', 'issued_date', 'expiry_date', 'notes', 'document_url']

const SELECT = `
  select cl.*,
    case when au.id is null then null else jsonb_build_object('name', au.name, 'code', au.code) end as authority,
    case when s.id is null then null else jsonb_build_object('name', s.name, 'code', s.code) end as site,
    case when a.id is null then null else jsonb_build_object('ain', a.ain, 'name', a.name) end as asset
  from public.compliance_licences cl
  left join public.regulatory_authorities au on au.id = cl.authority_id
  left join public.sites s on s.id = cl.site_id
  left join public.assets a on a.id = cl.asset_id
`

const licenceInput = z.object({
  site_id: z.string().uuid().nullable().optional(),
  asset_id: z.string().uuid().nullable().optional(),
  authority_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  licence_number: z.string().nullable().optional(),
  issued_date: z.string(),
  expiry_date: z.string(),
  notes: z.string().nullable().optional(),
  document_url: z.string().nullable().optional(),
})

complianceRouter.get('/compliance-licences', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} where cl.deleted_at is null order by cl.expiry_date asc`).then((r) => r.rows)
  )
  res.json(rows)
})

complianceRouter.get('/compliance-licences/counts', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select expiry_date from public.compliance_licences where deleted_at is null').then((r) => r.rows)
  )
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d30 = new Date(today); d30.setDate(today.getDate() + 30)
  const d90 = new Date(today); d90.setDate(today.getDate() + 90)
  let active = 0, dueSoon = 0, expiring = 0, expired = 0
  for (const row of rows) {
    const exp = new Date(row.expiry_date)
    if (exp < today) expired++
    else if (exp < d30) expiring++
    else if (exp < d90) dueSoon++
    else active++
  }
  res.json({ active, dueSoon, expiring, expired, total: rows.length })
})

complianceRouter.get('/regulatory-authorities', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select id, name, code from public.regulatory_authorities order by code').then((r) => r.rows)
  )
  res.json(rows)
})

complianceRouter.post('/compliance-licences', requireCap('compliance:create'), async (req, res) => {
  const parsed = licenceInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.compliance_licences (org_id, created_by, ${columns})
       values (current_org_id(), current_user_id(), ${placeholders})
       returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [rows[0].id])
    const licence = full[0]
    await writeAuditLog(c, { orgId: licence.org_id, actorId: req.claims!.sub, action: 'compliance_licence.create', entityType: 'compliance_licence', entityId: licence.id, after: licence })
    return licence
  })
  res.status(201).json(row)
})

complianceRouter.patch('/compliance-licences/:id', requireCap('compliance:update'), async (req, res) => {
  const parsed = licenceInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.compliance_licences set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where cl.id = $1`, [req.params.id])
    const licence = full[0]
    await writeAuditLog(c, { orgId: licence.org_id, actorId: req.claims!.sub, action: 'compliance_licence.update', entityType: 'compliance_licence', entityId: licence.id, after: licence })
    return licence
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

complianceRouter.delete('/compliance-licences/:id', requireCap('compliance:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.compliance_licences set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const licence = rows[0]
    if (licence) await writeAuditLog(c, { orgId: licence.org_id, actorId: req.claims!.sub, action: 'compliance_licence.archive', entityType: 'compliance_licence', entityId: licence.id })
    return licence
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

complianceRouter.post('/compliance/check-expiry', requireCap('compliance:read'), async (req, res) => {
  const count = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select public.check_licence_expiry(current_org_id()) as count').then((r) => r.rows[0].count)
  )
  res.json({ count })
})
