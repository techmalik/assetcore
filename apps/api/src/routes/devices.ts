import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { writeAuditLog } from '../audit.js'
import { buildSet, buildInsert } from '../sqlUtil.js'

export const devicesRouter = Router()
devicesRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = ['asset_id', 'site_id', 'serial_number', 'name', 'kind', 'protocol', 'status', 'firmware_version', 'ip_address', 'config']

const SELECT = `
  select d.*,
    case when a.id is null then null else jsonb_build_object('ain', a.ain, 'name', a.name) end as asset,
    case when s.id is null then null else jsonb_build_object('name', s.name, 'code', s.code) end as site
  from public.devices d
  left join public.assets a on a.id = d.asset_id
  left join public.sites s on s.id = d.site_id
`

const deviceInput = z.object({
  asset_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  serial_number: z.string().nullable().optional(),
  name: z.string().min(1),
  kind: z.string().optional(),
  protocol: z.string().optional(),
  status: z.string().optional(),
  firmware_version: z.string().nullable().optional(),
  ip_address: z.string().nullable().optional(),
  config: z.record(z.unknown()).optional(),
})

devicesRouter.get('/devices', async (req, res) => {
  const statuses = req.query.statuses
  const rows = await withOrgContext(claimsFromReq(req), (c) => {
    const clauses = [SELECT, 'where d.deleted_at is null']
    const values: unknown[] = []
    if (typeof statuses === 'string' && statuses) {
      values.push(statuses.split(','))
      clauses.push(`and d.status = any($${values.length})`)
    }
    clauses.push('order by d.created_at desc')
    return c.query(clauses.join(' '), values).then((r) => r.rows)
  })
  res.json(rows)
})

devicesRouter.post('/devices', async (req, res) => {
  const parsed = deviceInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { columns, placeholders, values } = buildInsert(parsed.data, ALLOWED)

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.devices (org_id, ${columns}) values (current_org_id(), ${placeholders}) returning id`,
      values
    )
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [rows[0].id])
    const device = full[0]
    await writeAuditLog(c, { orgId: device.org_id, actorId: req.claims!.sub, action: 'device.create', entityType: 'device', entityId: device.id, after: device })
    return device
  })
  res.status(201).json(row)
})

devicesRouter.patch('/devices/:id', async (req, res) => {
  const parsed = deviceInput.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.devices set ${setSql} where id = $1 returning id, org_id`, [req.params.id, ...values])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [req.params.id])
    const device = full[0]
    await writeAuditLog(c, { orgId: device.org_id, actorId: req.claims!.sub, action: 'device.update', entityType: 'device', entityId: device.id, after: device })
    return device
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

devicesRouter.delete('/devices/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.devices set deleted_at = now() where id = $1 returning id, org_id',
      [req.params.id]
    )
    const device = rows[0]
    if (device) await writeAuditLog(c, { orgId: device.org_id, actorId: req.claims!.sub, action: 'device.delete', entityType: 'device', entityId: device.id })
    return device
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})

devicesRouter.get('/devices/:id/readings', async (req, res) => {
  const limit = Number(req.query.limit) || 10
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      'select * from public.telemetry_readings where device_id = $1 order by recorded_at desc limit $2',
      [req.params.id, limit]
    ).then((r) => r.rows)
  )
  res.json(rows)
})
