import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'
import { buildSet, buildInsert } from '../../sqlUtil.js'

export const orgsRouter = Router()

const ALLOWED = ['name', 'short_name', 'industry', 'region', 'plan', 'billing_status']

orgsRouter.get('/orgs', requirePlatformCap('org:read'), async (_req, res) => {
  const { rows } = await ownerPool.query(
    `select id, name, short_name, industry, region, plan, billing_status, created_at, deleted_at
     from public.organizations order by created_at desc`
  )
  res.json({ orgs: rows })
})

async function orgCounts(orgId: string) {
  const [sites, assets, workOrders, users] = await Promise.all([
    ownerPool.query('select count(*)::int as c from public.sites where org_id = $1 and deleted_at is null', [orgId]).then((r) => r.rows[0].c),
    ownerPool.query('select count(*)::int as c from public.assets where org_id = $1 and deleted_at is null', [orgId]).then((r) => r.rows[0].c),
    ownerPool.query('select count(*)::int as c from public.work_orders where org_id = $1 and deleted_at is null', [orgId]).then((r) => r.rows[0].c),
    ownerPool.query("select count(*)::int as c from public.memberships where org_id = $1 and status = 'active'", [orgId]).then((r) => r.rows[0].c),
  ])
  return { sites, assets, workOrders, users }
}

orgsRouter.get('/orgs/:id', requirePlatformCap('org:read'), async (req, res) => {
  const { rows } = await ownerPool.query('select * from public.organizations where id = $1', [req.params.id])
  const org = rows[0]
  if (!org) return res.status(404).json({ error: 'Organization not found' })
  res.json({ org, counts: await orgCounts(String(req.params.id)) })
})

orgsRouter.post('/orgs', requirePlatformCap('org:write'), async (req, res) => {
  const body = req.body ?? {}
  if (!body.name) return res.status(400).json({ error: 'name is required' })
  const { rows } = await ownerPool.query(
    `insert into public.organizations (name, short_name, industry, region, plan, billing_status)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [body.name, body.short_name ?? null, body.industry ?? null, body.region ?? null, body.plan ?? 'licensed', body.billing_status ?? 'licensed']
  )
  const org = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'org.create', targetType: 'org', targetId: org.id, orgId: org.id, after: org, ip: req.ip })
  res.status(201).json({ org })
})

orgsRouter.patch('/orgs/:id', requirePlatformCap('org:write'), async (req, res) => {
  const { rows: beforeRows } = await ownerPool.query('select * from public.organizations where id = $1', [req.params.id])
  const before = beforeRows[0]
  if (!before) return res.status(404).json({ error: 'Organization not found' })

  const { setSql, values } = buildSet(req.body ?? {}, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })
  const { rows } = await ownerPool.query(
    `update public.organizations set ${setSql} where id = $1 returning *`,
    [req.params.id, ...values]
  )
  const org = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'org.update', targetType: 'org', targetId: org.id, orgId: org.id, before, after: org, ip: req.ip })
  res.json({ org })
})

function setSuspended(suspend: boolean) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const { rows } = await ownerPool.query(
      'update public.organizations set deleted_at = $2 where id = $1 returning *',
      [req.params.id, suspend ? new Date().toISOString() : null]
    )
    const org = rows[0]
    if (!org) return res.status(404).json({ error: 'Organization not found' })
    await writePlatformAuditLog({
      actorId: req.claims!.sub, action: suspend ? 'org.suspend' : 'org.restore',
      targetType: 'org', targetId: org.id, orgId: org.id, after: org, ip: req.ip,
    })
    res.json({ org })
  }
}
orgsRouter.post('/orgs/:id/suspend', requirePlatformCap('org:suspend'), setSuspended(true))
orgsRouter.post('/orgs/:id/restore', requirePlatformCap('org:suspend'), setSuspended(false))

orgsRouter.get('/orgs/:id/usage', requirePlatformCap('org:read'), async (req, res) => {
  const [{ rows: assets }, { rows: wos }] = await Promise.all([
    ownerPool.query('select status from public.assets where org_id = $1 and deleted_at is null', [req.params.id]),
    ownerPool.query('select status from public.work_orders where org_id = $1 and deleted_at is null', [req.params.id]),
  ])
  const tally = (rows: { status: string }[]) =>
    rows.reduce((m: Record<string, number>, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})
  res.json({ counts: await orgCounts(String(req.params.id)), assetsByStatus: tally(assets), workOrdersByStatus: tally(wos) })
})

orgsRouter.get('/orgs/:id/audit', requirePlatformCap('audit:read'), async (req, res) => {
  const { rows } = await ownerPool.query(
    'select * from public.audit_log where org_id = $1 order by created_at desc limit 100',
    [req.params.id]
  )
  res.json({ entries: rows })
})

orgsRouter.get('/orgs/:id/users', requirePlatformCap('user:read'), async (req, res) => {
  const { rows } = await ownerPool.query(
    `select m.id, m.user_id, m.role_key, m.status, m.created_at,
       jsonb_build_object('full_name', u.full_name, 'email', u.email, 'phone', u.phone) as profiles
     from public.memberships m
     join public.users u on u.id = m.user_id
     where m.org_id = $1`,
    [req.params.id]
  )
  res.json({ users: rows })
})

orgsRouter.get('/orgs/:id/notes', requirePlatformCap('org:read'), async (req, res) => {
  const { rows } = await ownerPool.query(
    `select n.id, n.body, n.created_at, n.author_id,
       jsonb_build_object('full_name', u.full_name, 'email', u.email) as profiles
     from public.org_notes n
     left join public.users u on u.id = n.author_id
     where n.org_id = $1
     order by n.created_at desc`,
    [req.params.id]
  )
  res.json({ notes: rows })
})

orgsRouter.post('/orgs/:id/notes', requirePlatformCap('org:write'), async (req, res) => {
  const body = req.body ?? {}
  if (!body.body) return res.status(400).json({ error: 'body is required' })
  const { columns, placeholders, values } = buildInsert({ org_id: req.params.id, author_id: req.claims!.sub, body: body.body }, ['org_id', 'author_id', 'body'])
  const { rows } = await ownerPool.query(`insert into public.org_notes (${columns}) values (${placeholders}) returning *`, values)
  const note = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'org.note', targetType: 'note', targetId: note.id, orgId: String(req.params.id), after: note, ip: req.ip })
  res.status(201).json({ note })
})
