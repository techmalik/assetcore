// admin-api — single Edge Function backing the AssetCore backoffice.
//
// Flow per request:  CORS → requireAdmin (JWT + platform_admins) → route →
// service-role query → (mutations) writeAudit. The service-role key never
// leaves this server. See _guard.ts / _audit.ts.
import { requireAdmin, requireCap, json, cors, HttpError, type AdminCtx } from './_guard.ts'
import { writeAudit } from './_audit.ts'

// ── tiny router ──────────────────────────────────────────────────────────────
type Handler = (ctx: AdminCtx, req: Request, params: Record<string, string>) => Promise<Response>
interface Route { method: string; parts: string[]; handler: Handler }
const routes: Route[] = []
const on = (method: string, pattern: string, handler: Handler) =>
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler })

function matchRoute(method: string, path: string) {
  const segs = path.split('/').filter(Boolean)
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i]
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i])
      else if (p !== segs[i]) { ok = false; break }
    }
    if (ok) return { handler: r.handler, params }
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Strip everything up to and including the function name.
  const url = new URL(req.url)
  const path = url.pathname.replace(/^.*\/admin-api/, '') || '/'

  try {
    const match = matchRoute(req.method, path)
    if (!match) return json({ error: 'Not found' }, 404)
    const ctx = await requireAdmin(req)
    return await match.handler(ctx, req, match.params)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: (err as Error).message ?? 'Internal error' }, 500)
  }
})

// ── helpers ────────────────────────────────────────────────────────────────
const count = async (ctx: AdminCtx, table: string, build?: (q: any) => any) => {
  let q = ctx.svc.from(table).select('*', { count: 'exact', head: true })
  if (build) q = build(q)
  const { count: c } = await q
  return c ?? 0
}

// ============================================================================
// METRICS
// ============================================================================
on('GET', '/metrics', async (ctx) => {
  const [{ data: orgs }, { data: invoices }, assets, woTotal, woOpen, members] = await Promise.all([
    ctx.svc.from('organizations').select('id,plan,billing_status,deleted_at,created_at'),
    ctx.svc.from('billing_invoices').select('amount_cents,status'),
    count(ctx, 'assets', (q) => q.is('deleted_at', null)),
    count(ctx, 'work_orders', (q) => q.is('deleted_at', null)),
    count(ctx, 'work_orders', (q) => q.is('deleted_at', null).neq('status', 'closed')),
    count(ctx, 'memberships', (q) => q.eq('status', 'active')),
  ])

  const live = (orgs ?? []).filter((o) => !o.deleted_at)
  const byPlan: Record<string, number> = {}
  const byBilling: Record<string, number> = {}
  for (const o of live) {
    byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1
    byBilling[o.billing_status] = (byBilling[o.billing_status] ?? 0) + 1
  }
  const since = Date.now() - 30 * 864e5
  const newOrgs30d = live.filter((o) => new Date(o.created_at).getTime() >= since).length

  const sum = (pred: (s: string) => boolean) =>
    (invoices ?? []).filter((i) => pred(i.status)).reduce((a, i) => a + (i.amount_cents ?? 0), 0)

  return json({
    orgs: { total: live.length, suspended: (orgs ?? []).length - live.length, new30d: newOrgs30d, byPlan, byBilling },
    users: members,
    assets,
    workOrders: { total: woTotal, open: woOpen },
    billing: {
      collectedCents: sum((s) => s === 'paid'),
      outstandingCents: sum((s) => s === 'sent' || s === 'overdue'),
    },
  })
})

// ============================================================================
// ORGANIZATIONS
// ============================================================================
on('GET', '/orgs', async (ctx) => {
  requireCap(ctx, 'org:read')
  const { data, error } = await ctx.svc
    .from('organizations')
    .select('id,name,short_name,industry,region,plan,billing_status,created_at,deleted_at')
    .order('created_at', { ascending: false })
  if (error) throw new HttpError(500, error.message)
  return json({ orgs: data })
})

const orgCounts = async (ctx: AdminCtx, orgId: string) => {
  const [sites, assets, workOrders, users] = await Promise.all([
    count(ctx, 'sites', (q) => q.eq('org_id', orgId).is('deleted_at', null)),
    count(ctx, 'assets', (q) => q.eq('org_id', orgId).is('deleted_at', null)),
    count(ctx, 'work_orders', (q) => q.eq('org_id', orgId).is('deleted_at', null)),
    count(ctx, 'memberships', (q) => q.eq('org_id', orgId).eq('status', 'active')),
  ])
  return { sites, assets, workOrders, users }
}

on('GET', '/orgs/:id', async (ctx, _req, p) => {
  requireCap(ctx, 'org:read')
  const { data: org, error } = await ctx.svc.from('organizations').select('*').eq('id', p.id).maybeSingle()
  if (error) throw new HttpError(500, error.message)
  if (!org) throw new HttpError(404, 'Organization not found')
  return json({ org, counts: await orgCounts(ctx, p.id) })
})

on('POST', '/orgs', async (ctx, req) => {
  requireCap(ctx, 'org:write')
  const body = await req.json()
  if (!body?.name) throw new HttpError(400, 'name is required')
  const { data, error } = await ctx.svc.from('organizations').insert({
    name: body.name,
    short_name: body.short_name ?? null,
    industry: body.industry ?? null,
    region: body.region ?? null,
    plan: body.plan ?? 'trial',
    billing_status: body.billing_status ?? 'trial',
  }).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'org.create', targetType: 'org', targetId: data.id, orgId: data.id, after: data })
  return json({ org: data }, 201)
})

on('PATCH', '/orgs/:id', async (ctx, req, p) => {
  requireCap(ctx, 'org:write')
  const body = await req.json()
  const { data: before } = await ctx.svc.from('organizations').select('*').eq('id', p.id).maybeSingle()
  if (!before) throw new HttpError(404, 'Organization not found')
  const patch: Record<string, unknown> = {}
  for (const f of ['name', 'short_name', 'industry', 'region', 'plan', 'billing_status']) {
    if (f in body) patch[f] = body[f]
  }
  const { data, error } = await ctx.svc.from('organizations').update(patch).eq('id', p.id).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'org.update', targetType: 'org', targetId: p.id, orgId: p.id, before, after: data })
  return json({ org: data })
})

const setSuspended = (suspend: boolean): Handler => async (ctx, _req, p) => {
  requireCap(ctx, 'org:suspend')
  const { data, error } = await ctx.svc
    .from('organizations')
    .update({ deleted_at: suspend ? new Date().toISOString() : null })
    .eq('id', p.id).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: suspend ? 'org.suspend' : 'org.restore', targetType: 'org', targetId: p.id, orgId: p.id, after: data })
  return json({ org: data })
}
on('POST', '/orgs/:id/suspend', setSuspended(true))
on('POST', '/orgs/:id/restore', setSuspended(false))

on('GET', '/orgs/:id/usage', async (ctx, _req, p) => {
  requireCap(ctx, 'org:read')
  const [{ data: assets }, { data: wos }] = await Promise.all([
    ctx.svc.from('assets').select('status').eq('org_id', p.id).is('deleted_at', null),
    ctx.svc.from('work_orders').select('status').eq('org_id', p.id).is('deleted_at', null),
  ])
  const tally = (rows: { status: string }[] | null) =>
    (rows ?? []).reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {} as Record<string, number>)
  return json({ counts: await orgCounts(ctx, p.id), assetsByStatus: tally(assets), workOrdersByStatus: tally(wos) })
})

on('GET', '/orgs/:id/audit', async (ctx, _req, p) => {
  requireCap(ctx, 'audit:read')
  const { data, error } = await ctx.svc
    .from('audit_log').select('*').eq('org_id', p.id)
    .order('created_at', { ascending: false }).limit(100)
  if (error) throw new HttpError(500, error.message)
  return json({ entries: data })
})

on('GET', '/orgs/:id/users', async (ctx, _req, p) => {
  requireCap(ctx, 'user:read')
  const { data, error } = await ctx.svc
    .from('memberships')
    .select('id,user_id,role_key,status,created_at,profiles:profiles!inner(full_name,email,phone)')
    .eq('org_id', p.id)
  if (error) throw new HttpError(500, error.message)
  return json({ users: data })
})

on('GET', '/orgs/:id/notes', async (ctx, _req, p) => {
  requireCap(ctx, 'org:read')
  const { data, error } = await ctx.svc
    .from('org_notes')
    .select('id,body,created_at,author_id,profiles:profiles(full_name,email)')
    .eq('org_id', p.id).order('created_at', { ascending: false })
  if (error) throw new HttpError(500, error.message)
  return json({ notes: data })
})

on('POST', '/orgs/:id/notes', async (ctx, req, p) => {
  requireCap(ctx, 'org:write')
  const body = await req.json()
  if (!body?.body) throw new HttpError(400, 'body is required')
  const { data, error } = await ctx.svc.from('org_notes')
    .insert({ org_id: p.id, author_id: ctx.user.id, body: body.body }).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'org.note', targetType: 'note', targetId: data.id, orgId: p.id, after: data })
  return json({ note: data }, 201)
})

// ============================================================================
// USERS (cross-org directory)
// ============================================================================
on('GET', '/users', async (ctx, req) => {
  requireCap(ctx, 'user:read')
  const search = new URL(req.url).searchParams.get('q')?.toLowerCase() ?? ''
  const { data, error } = await ctx.svc
    .from('memberships')
    .select('id,org_id,user_id,role_key,status,created_at,organizations:organizations(name,short_name),profiles:profiles!inner(full_name,email,phone)')
    .order('created_at', { ascending: false }).limit(1000)
  if (error) throw new HttpError(500, error.message)
  const rows = (data ?? []).filter((r: any) =>
    !search || r.profiles?.email?.toLowerCase().includes(search) || r.profiles?.full_name?.toLowerCase().includes(search))
  return json({ users: rows })
})

on('PATCH', '/users/:id/role', async (ctx, req, p) => {
  requireCap(ctx, 'user:write')
  const body = await req.json() // { org_id, role_key }
  const { data: before } = await ctx.svc.from('memberships').select('*').eq('id', p.id).maybeSingle()
  if (!before) throw new HttpError(404, 'Membership not found')
  const { data, error } = await ctx.svc.from('memberships')
    .update({ role_key: body.role_key }).eq('id', p.id).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'user.role', targetType: 'user', targetId: before.user_id, orgId: before.org_id, before, after: data })
  return json({ membership: data })
})

const setMembershipStatus = (status: string, action: string): Handler => async (ctx, _req, p) => {
  requireCap(ctx, 'user:write')
  const { data: before } = await ctx.svc.from('memberships').select('*').eq('id', p.id).maybeSingle()
  if (!before) throw new HttpError(404, 'Membership not found')
  const { data, error } = await ctx.svc.from('memberships').update({ status }).eq('id', p.id).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action, targetType: 'user', targetId: before.user_id, orgId: before.org_id, before, after: data })
  return json({ membership: data })
}
on('POST', '/users/:id/disable', setMembershipStatus('disabled', 'user.disable'))
on('POST', '/users/:id/enable', setMembershipStatus('active', 'user.enable'))

on('POST', '/users/:id/invite', async (ctx, req) => {
  requireCap(ctx, 'user:write')
  const body = await req.json() // { email, full_name, org_id, role_key }
  if (!body?.email || !body?.org_id || !body?.role_key) throw new HttpError(400, 'email, org_id, role_key required')
  const { data: invited, error: invErr } = await ctx.svc.auth.admin.inviteUserByEmail(body.email, {
    data: { full_name: body.full_name ?? '' },
  })
  if (invErr || !invited?.user) throw new HttpError(500, invErr?.message ?? 'Invite failed')
  const { error: memErr } = await ctx.svc.from('memberships')
    .insert({ org_id: body.org_id, user_id: invited.user.id, role_key: body.role_key, status: 'active' })
  if (memErr) throw new HttpError(500, memErr.message)
  await writeAudit(ctx, { action: 'user.invite', targetType: 'user', targetId: invited.user.id, orgId: body.org_id, after: { email: body.email, role_key: body.role_key } })
  return json({ user_id: invited.user.id }, 201)
})

on('POST', '/users/:userId/reset-password', async (ctx, req, p) => {
  requireCap(ctx, 'user:write')
  const body = await req.json() // { email }
  if (!body?.email) throw new HttpError(400, 'email is required')
  const { data, error } = await ctx.svc.auth.admin.generateLink({ type: 'recovery', email: body.email })
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'user.reset_password', targetType: 'user', targetId: p.userId })
  return json({ action_link: data.properties?.action_link })
})

// ============================================================================
// BILLING (invoice / PO; USD cents; no payment integration)
// ============================================================================
on('GET', '/billing/invoices', async (ctx, req) => {
  requireCap(ctx, 'billing:read')
  const orgId = new URL(req.url).searchParams.get('org_id')
  let q = ctx.svc.from('billing_invoices')
    .select('*,organizations:organizations(name,short_name)')
    .order('created_at', { ascending: false })
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  if (error) throw new HttpError(500, error.message)
  return json({ invoices: data })
})

on('POST', '/billing/invoices', async (ctx, req) => {
  requireCap(ctx, 'billing:write')
  const body = await req.json()
  if (!body?.org_id || !body?.number) throw new HttpError(400, 'org_id and number are required')
  const { data, error } = await ctx.svc.from('billing_invoices').insert({
    org_id: body.org_id,
    number: body.number,
    amount_cents: body.amount_cents ?? 0,
    currency: body.currency ?? 'USD',
    status: body.status ?? 'draft',
    po_number: body.po_number ?? null,
    period_start: body.period_start ?? null,
    period_end: body.period_end ?? null,
    due_at: body.due_at ?? null,
    notes: body.notes ?? null,
    created_by: ctx.user.id,
  }).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'invoice.create', targetType: 'invoice', targetId: data.id, orgId: data.org_id, after: data })
  return json({ invoice: data }, 201)
})

on('PATCH', '/billing/invoices/:id', async (ctx, req, p) => {
  requireCap(ctx, 'billing:write')
  const body = await req.json()
  const { data: before } = await ctx.svc.from('billing_invoices').select('*').eq('id', p.id).maybeSingle()
  if (!before) throw new HttpError(404, 'Invoice not found')
  const patch: Record<string, unknown> = {}
  for (const f of ['amount_cents', 'status', 'po_number', 'period_start', 'period_end', 'due_at', 'notes']) {
    if (f in body) patch[f] = body[f]
  }
  // Stamp lifecycle timestamps on status transitions.
  if (body.status === 'sent' && !before.issued_at) patch.issued_at = new Date().toISOString()
  if (body.status === 'paid' && !before.paid_at) patch.paid_at = new Date().toISOString()
  const { data, error } = await ctx.svc.from('billing_invoices').update(patch).eq('id', p.id).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'invoice.update', targetType: 'invoice', targetId: p.id, orgId: before.org_id, before, after: data })
  return json({ invoice: data })
})

// ============================================================================
// SUPPORT — time-boxed, audited, READ-ONLY tenant view
// ============================================================================
on('POST', '/support/impersonate', async (ctx, req) => {
  requireCap(ctx, 'impersonate')
  const body = await req.json() // { org_id, reason, minutes }
  if (!body?.org_id || !body?.reason) throw new HttpError(400, 'org_id and reason are required')
  const minutes = Math.min(Math.max(Number(body.minutes) || 30, 5), 240)
  const { data, error } = await ctx.svc.from('impersonation_grants').insert({
    admin_id: ctx.user.id,
    org_id: body.org_id,
    reason: body.reason,
    expires_at: new Date(Date.now() + minutes * 60000).toISOString(),
  }).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'support.impersonate', targetType: 'impersonation', targetId: data.id, orgId: body.org_id, after: { reason: body.reason, minutes } })
  return json({ grant: data }, 201)
})

const activeGrant = async (ctx: AdminCtx, orgId: string) => {
  const { data } = await ctx.svc.from('impersonation_grants')
    .select('id,expires_at,revoked_at').eq('admin_id', ctx.user.id).eq('org_id', orgId)
    .is('revoked_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

on('GET', '/support/org/:id', async (ctx, _req, p) => {
  requireCap(ctx, 'impersonate')
  if (!(await activeGrant(ctx, p.id))) throw new HttpError(403, 'No active support session for this org')
  const [{ data: org }, { data: assets }, { data: workOrders }, { data: licences }] = await Promise.all([
    ctx.svc.from('organizations').select('*').eq('id', p.id).maybeSingle(),
    ctx.svc.from('assets').select('id,ain,name,status,health_score').eq('org_id', p.id).is('deleted_at', null).limit(50),
    ctx.svc.from('work_orders').select('id,ref,title,status,priority,sla_due').eq('org_id', p.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(50),
    ctx.svc.from('compliance_licences').select('id,name,licence_number,expiry_date').eq('org_id', p.id).limit(50),
  ])
  return json({ org, assets, workOrders, licences })
})

on('POST', '/support/revoke/:id', async (ctx, _req, p) => {
  requireCap(ctx, 'impersonate')
  const { data, error } = await ctx.svc.from('impersonation_grants')
    .update({ revoked_at: new Date().toISOString() }).eq('id', p.id).eq('admin_id', ctx.user.id).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'support.revoke', targetType: 'impersonation', targetId: p.id, orgId: data.org_id })
  return json({ grant: data })
})

// ============================================================================
// PLATFORM AUDIT
// ============================================================================
on('GET', '/audit', async (ctx, req) => {
  requireCap(ctx, 'audit:read')
  const sp = new URL(req.url).searchParams
  let q = ctx.svc.from('platform_audit_log')
    .select('*,profiles:profiles(full_name,email),organizations:organizations(name,short_name)')
    .order('created_at', { ascending: false }).limit(200)
  if (sp.get('org_id')) q = q.eq('org_id', sp.get('org_id'))
  if (sp.get('actor_id')) q = q.eq('actor_id', sp.get('actor_id'))
  const { data, error } = await q
  if (error) throw new HttpError(500, error.message)
  return json({ entries: data })
})

// ============================================================================
// PLATFORM ADMINS (superadmin only)
// ============================================================================
on('GET', '/admins', async (ctx) => {
  requireCap(ctx, 'admin:read')
  const { data, error } = await ctx.svc.from('platform_admins')
    .select('user_id,role,full_name,status,created_at,profiles:profiles(email)')
    .order('created_at', { ascending: false })
  if (error) throw new HttpError(500, error.message)
  return json({ admins: data })
})

on('POST', '/admins', async (ctx, req) => {
  requireCap(ctx, 'admin:write')
  const body = await req.json() // { email, role, full_name }
  if (!body?.email || !body?.role) throw new HttpError(400, 'email and role are required')
  const { data: prof } = await ctx.svc.from('profiles').select('id,full_name').ilike('email', body.email).maybeSingle()
  if (!prof) throw new HttpError(404, 'No user with that email — they must sign up first')
  const { data, error } = await ctx.svc.from('platform_admins').insert({
    user_id: prof.id, role: body.role, full_name: body.full_name ?? prof.full_name ?? '', created_by: ctx.user.id,
  }).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'admin.add', targetType: 'admin', targetId: prof.id, after: data })
  return json({ admin: data }, 201)
})

on('PATCH', '/admins/:userId', async (ctx, req, p) => {
  requireCap(ctx, 'admin:write')
  const body = await req.json() // { role?, status? }
  const { data: before } = await ctx.svc.from('platform_admins').select('*').eq('user_id', p.userId).maybeSingle()
  if (!before) throw new HttpError(404, 'Admin not found')
  const patch: Record<string, unknown> = {}
  if ('role' in body) patch.role = body.role
  if ('status' in body) patch.status = body.status
  const { data, error } = await ctx.svc.from('platform_admins').update(patch).eq('user_id', p.userId).select().single()
  if (error) throw new HttpError(500, error.message)
  await writeAudit(ctx, { action: 'admin.update', targetType: 'admin', targetId: p.userId, before, after: data })
  return json({ admin: data })
})
