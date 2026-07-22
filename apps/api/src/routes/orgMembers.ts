import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ownerPool, withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { config } from '../config.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { hashPassword } from '../auth/passwords.js'
import { issueToken } from '../auth/tokens.js'
import { sendMail } from '../auth/mailer.js'

export const orgMembersRouter = Router()
// Path-scoped, unlike every other router's blanket `.use(requireAuth, ...)`:
// this one also carries requireCap('user:manage'), and this router (like all
// the others) is mounted at apiRouter's root with no prefix. An unscoped
// `.use(mw)` here would run for ANY request that reaches this point in the
// chain — including ones meant for routers mounted later (profile, licence,
// files) — and requireCap's 403 stops the request dead before it ever gets
// there. Scoping to '/org/members' keeps it to this router's own routes.
orgMembersRouter.use('/org/members', requireAuth, requireOrg, requireActiveMembership, requireCap('user:manage'))

const ROLE_KEYS = ['owner', 'ops_manager', 'maint_engineer', 'field_tech', 'hse_officer', 'auditor', 'viewer'] as const

// Capabilities an admin may grant per-user on top of the role baseline. Kept to
// operational edit rights — never wildcards or org/user/integration management,
// which stay owner-only.
const GRANTABLE_CAPS = [
  'asset:create', 'asset:update',
  'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
  'pm:create', 'pm:update',
  'inspection:create', 'inspection:update',
  'compliance:create', 'compliance:update',
  'report:create', 'audit:read',
] as const

const scopeSchema = z.object({
  site_scope: z.array(z.string().uuid()).nullable().optional(),
  location_scope: z.array(z.string().uuid()).nullable().optional(),
  extra_caps: z.array(z.enum(GRANTABLE_CAPS)).optional(),
})

async function countActiveOwners(orgId: string): Promise<number> {
  const { rows } = await ownerPool.query(
    "select count(*)::int as n from public.memberships where org_id = $1 and role_key = 'owner' and status = 'active'",
    [orgId]
  )
  return rows[0].n
}

async function getOrgMembership(orgId: string, membershipId: string) {
  const { rows } = await ownerPool.query(
    `select m.*, u.email, u.full_name from public.memberships m
     join public.users u on u.id = m.user_id
     where m.id = $1 and m.org_id = $2`,
    [membershipId, orgId]
  )
  return rows[0] ?? null
}

orgMembersRouter.get('/org/members', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select m.id, m.user_id, m.role_key, m.status, m.created_at, m.site_scope, m.location_scope, m.extra_caps,
              u.full_name, u.email, u.phone
       from public.memberships m
       join public.users u on u.id = m.user_id
       where m.org_id = current_org_id()
       order by m.created_at asc`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1),
  role_key: z.enum(ROLE_KEYS),
  site_scope: z.array(z.string().uuid()).nullable().optional(),
  location_scope: z.array(z.string().uuid()).nullable().optional(),
  extra_caps: z.array(z.enum(GRANTABLE_CAPS)).optional(),
})

orgMembersRouter.post('/org/members/invite', async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { email, full_name, role_key, site_scope, location_scope, extra_caps } = parsed.data
  const orgId = req.claims!.org_id!

  const client = await ownerPool.connect()
  try {
    await client.query('begin')
    const { rows: existingRows } = await client.query('select id from public.users where email = $1', [email])
    let userId: string
    let sendInvite = true

    if (existingRows[0]) {
      userId = existingRows[0].id
      const { rows: memberships } = await client.query('select org_id from public.memberships where user_id = $1', [userId])
      if (memberships.some((m) => m.org_id !== orgId)) {
        await client.query('rollback')
        return res.status(409).json({ error: 'email_belongs_to_another_org' })
      }
      if (memberships.some((m) => m.org_id === orgId)) {
        await client.query('rollback')
        return res.status(409).json({ error: 'already_a_member' })
      }
      // Existing user with no membership anywhere (e.g. platform-admin-only
      // account) — attach them without touching their password.
      sendInvite = false
    } else {
      const passwordHash = await hashPassword(randomUUID())
      const { rows } = await client.query(
        `insert into public.users (email, password_hash, full_name, must_change_password)
         values ($1, $2, $3, true) returning id`,
        [email, passwordHash, full_name]
      )
      userId = rows[0].id
    }

    await client.query(
      `insert into public.memberships (org_id, user_id, role_key, site_scope, location_scope, extra_caps, status)
       values ($1, $2, $3, $4, $5, $6, 'active')`,
      [orgId, userId, role_key, site_scope ?? null, location_scope ?? null, extra_caps ?? []]
    )

    let inviteLink: string | null = null
    if (sendInvite) {
      const token = await issueToken(client, userId, 'invite')
      inviteLink = `${config.APP_ORIGIN}/reset-password?token=${token}`
      await sendMail({
        to: email,
        subject: "You've been invited to AssetCore",
        text: `You've been invited to join AssetCore. Set your password: ${inviteLink}\n\nThis link expires in 7 days.`,
      })
    }

    await writeAuditLog(client, {
      orgId, actorId: req.claims!.sub, action: 'user.invite', entityType: 'membership', entityId: userId,
      after: { email, full_name, role_key },
    })
    await client.query('commit')
    res.status(201).json({ user_id: userId, invite_link: inviteLink })
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
})

const roleSchema = z.object({ role_key: z.enum(ROLE_KEYS) })

orgMembersRouter.patch('/org/members/:id/role', async (req, res) => {
  const parsed = roleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const orgId = req.claims!.org_id!

  const client = await ownerPool.connect()
  try {
    await client.query('begin')
    const before = await getOrgMembership(orgId, req.params.id)
    if (!before) { await client.query('rollback'); return res.status(404).json({ error: 'not_found' }) }

    if (before.role_key === 'owner' && parsed.data.role_key !== 'owner') {
      const owners = await countActiveOwners(orgId)
      if (owners <= 1) { await client.query('rollback'); return res.status(400).json({ error: 'cannot_demote_last_owner' }) }
    }

    const { rows } = await client.query(
      'update public.memberships set role_key = $2 where id = $1 returning *',
      [req.params.id, parsed.data.role_key]
    )
    await writeAuditLog(client, {
      orgId, actorId: req.claims!.sub, action: 'user.role', entityType: 'membership', entityId: req.params.id,
      before: { role_key: before.role_key }, after: { role_key: parsed.data.role_key },
    })
    await client.query('commit')
    res.json(rows[0])
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
})

// Update a member's location/site scope and per-user capability grants. Sending
// a field replaces it; omit a field to leave it unchanged. null scope = all.
orgMembersRouter.patch('/org/members/:id/access', async (req, res) => {
  const parsed = scopeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const orgId = req.claims!.org_id!

  const sets: string[] = []
  const values: unknown[] = [req.params.id, orgId]
  if ('site_scope' in parsed.data) { values.push(parsed.data.site_scope ?? null); sets.push(`site_scope = $${values.length}`) }
  if ('location_scope' in parsed.data) { values.push(parsed.data.location_scope ?? null); sets.push(`location_scope = $${values.length}`) }
  if ('extra_caps' in parsed.data) { values.push(parsed.data.extra_caps ?? []); sets.push(`extra_caps = $${values.length}`) }
  if (!sets.length) return res.status(400).json({ error: 'empty_patch' })

  const client = await ownerPool.connect()
  try {
    await client.query('begin')
    const before = await getOrgMembership(orgId, req.params.id)
    if (!before) { await client.query('rollback'); return res.status(404).json({ error: 'not_found' }) }
    const { rows } = await client.query(
      `update public.memberships set ${sets.join(', ')} where id = $1 and org_id = $2 returning *`,
      values
    )
    await writeAuditLog(client, {
      orgId, actorId: req.claims!.sub, action: 'user.access', entityType: 'membership', entityId: req.params.id,
      before: { site_scope: before.site_scope, location_scope: before.location_scope, extra_caps: before.extra_caps },
      after: parsed.data,
    })
    await client.query('commit')
    res.json(rows[0])
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
})

function setStatus(status: 'disabled' | 'active', action: string) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const orgId = req.claims!.org_id!
    const membershipId = String(req.params.id)
    const client = await ownerPool.connect()
    try {
      await client.query('begin')
      const before = await getOrgMembership(orgId, membershipId)
      if (!before) { await client.query('rollback'); return res.status(404).json({ error: 'not_found' }) }

      if (status === 'disabled') {
        if (before.user_id === req.claims!.sub) { await client.query('rollback'); return res.status(400).json({ error: 'cannot_disable_self' }) }
        if (before.role_key === 'owner' && before.status === 'active') {
          const owners = await countActiveOwners(orgId)
          if (owners <= 1) { await client.query('rollback'); return res.status(400).json({ error: 'cannot_disable_last_owner' }) }
        }
      }

      const { rows } = await client.query('update public.memberships set status = $2 where id = $1 returning *', [membershipId, status])
      await writeAuditLog(client, {
        orgId, actorId: req.claims!.sub, action, entityType: 'membership', entityId: membershipId,
        before: { status: before.status }, after: { status },
      })
      await client.query('commit')
      res.json(rows[0])
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  }
}
orgMembersRouter.post('/org/members/:id/disable', setStatus('disabled', 'user.disable'))
orgMembersRouter.post('/org/members/:id/enable', setStatus('active', 'user.enable'))

orgMembersRouter.post('/org/members/:id/reset-password', async (req, res) => {
  const orgId = req.claims!.org_id!
  const client = await ownerPool.connect()
  try {
    const membership = await getOrgMembership(orgId, req.params.id)
    if (!membership) return res.status(404).json({ error: 'not_found' })

    const token = await issueToken(client, membership.user_id, 'reset')
    const link = `${config.APP_ORIGIN}/reset-password?token=${token}`
    await sendMail({ to: membership.email, subject: 'Reset your AssetCore password', text: `Reset your password: ${link}\n\nThis link expires in 1 hour.` })
    await writeAuditLog(client, { orgId, actorId: req.claims!.sub, action: 'user.reset_password', entityType: 'membership', entityId: req.params.id })
    res.json({ action_link: link })
  } finally {
    client.release()
  }
})
