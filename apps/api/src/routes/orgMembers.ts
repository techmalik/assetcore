import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { withOrgContext, withOwnerTx } from '../db.js'
import { claimsFromReq, isOwner } from '../claims.js'
import { config } from '../config.js'
import { requireCap, GRANTABLE_CAPS, ROLE_KEYS } from '../middleware/rbac.js'
import { auditFromReq } from '../audit.js'
import { buildSet } from '../sqlUtil.js'
import { hashPassword } from '../auth/passwords.js'
import { issueToken } from '../auth/tokens.js'
import { sendMail } from '../auth/mailer.js'

export const orgMembersRouter = Router()
// Sign-in and membership are checked once for every tenant route, in
// routes/index.ts. This router adds user:manage, path-scoped: it is mounted
// at apiRouter's root with no prefix, so an unscoped `.use(mw)` would also run
// for requests meant for routers mounted after it and 403 them.
orgMembersRouter.use('/org/members', requireCap('user:manage'))

// ROLE_KEYS and GRANTABLE_CAPS come from @assetcore/rbac (via middleware/rbac)
// — the same lists the app's Admin UI renders, so what the UI offers and what
// the API accepts can no longer drift apart.

const scopeSchema = z.object({
  site_scope: z.array(z.string().uuid()).nullable().optional(),
  location_scope: z.array(z.string().uuid()).nullable().optional(),
  extra_caps: z.array(z.enum(GRANTABLE_CAPS)).optional(),
})

type Fail = { error: string; status: number }
const fail = (status: number, error: string): Fail => ({ status, error })
const isFail = (v: unknown): v is Fail => typeof v === 'object' && v !== null && 'error' in v && 'status' in v

/** The org's active owners, locked until the transaction ends. Two admins
 * demoting or disabling the last two owners at once used to both pass the
 * last-owner check, because it read outside the transaction with no lock;
 * the second now waits here and then sees the first one's change.
 *
 * Call it before locking the target membership, and always in id order: two
 * owners demoting each other would otherwise each hold one row and wait on
 * the other's, and Postgres would abort one of them as a deadlock. */
async function lockActiveOwners(c: PoolClient, orgId: string): Promise<number> {
  const { rows } = await c.query(
    "select id from public.memberships where org_id = $1 and role_key = 'owner' and status = 'active' order by id for update",
    [orgId]
  )
  return rows.length
}

// user:manage is held by `admin` as well as `owner` (System Admin). Without
// the isOwner() checks below an admin could promote themselves to owner, or
// demote/disable an owner, or mint a reset link for an owner's account and
// sign in as them — each a way past the integration/depreciation rights kept
// owner-only in @assetcore/rbac. So: only an owner may grant the owner role,
// or touch a membership that is currently an owner's. The last-owner checks
// still apply on top, to owners acting on each other.

/** The membership, locked for the rest of the transaction. */
async function getOrgMembership(c: PoolClient, orgId: string, membershipId: string) {
  const { rows } = await c.query(
    `select m.*, u.email, u.full_name from public.memberships m
     join public.users u on u.id = m.user_id
     where m.id = $1 and m.org_id = $2
     for update of m`,
    [membershipId, orgId]
  )
  return rows[0] ?? null
}

orgMembersRouter.get('/org/members', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select m.id, m.user_id, m.role_key, m.status, m.created_at, m.site_scope, m.location_scope, m.extra_caps,
              u.full_name, u.email, u.phone,
              m.manager_id, mu.full_name as manager_name
       from public.memberships m
       join public.users u on u.id = m.user_id
       left join public.users mu on mu.id = m.manager_id
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
  if (role_key === 'owner' && !isOwner(req)) return res.status(403).json({ error: 'owner_only' })

  const out = await withOwnerTx(async (c) => {
    const { rows: existingRows } = await c.query('select id from public.users where email = $1', [email])
    let userId: string
    let sendInvite = true

    if (existingRows[0]) {
      userId = existingRows[0].id
      const { rows: memberships } = await c.query('select org_id from public.memberships where user_id = $1', [userId])
      if (memberships.some((m) => m.org_id !== orgId)) return fail(409, 'email_belongs_to_another_org')
      if (memberships.some((m) => m.org_id === orgId)) return fail(409, 'already_a_member')
      // Existing user with no membership anywhere (e.g. platform-admin-only
      // account) — attach them without touching their password.
      sendInvite = false
    } else {
      const passwordHash = await hashPassword(randomUUID())
      const { rows } = await c.query(
        `insert into public.users (email, password_hash, full_name, must_change_password)
         values ($1, $2, $3, true) returning id`,
        [email, passwordHash, full_name]
      )
      userId = rows[0].id
    }

    const { rows: membership } = await c.query(
      `insert into public.memberships (org_id, user_id, role_key, site_scope, location_scope, extra_caps, status)
       values ($1, $2, $3, $4, $5, $6, 'active') returning id`,
      [orgId, userId, role_key, site_scope ?? null, location_scope ?? null, extra_caps ?? []]
    )
    const token = sendInvite ? await issueToken(c, userId, 'invite') : null

    await auditFromReq(c, req, {
      action: 'user.invite', entityType: 'membership', entityId: membership[0].id,
      after: { email, full_name, role_key },
    })
    return { userId, token }
  })
  if (isFail(out)) return res.status(out.status).json({ error: out.error })

  // Mailed only once the invite is committed: a link mailed from inside the
  // transaction pointed at a user who did not exist if the commit then failed.
  let inviteLink: string | null = null
  // Whether the invite actually reached the mailbox — the UI words its
  // confirmation differently when there is no relay and the admin has to
  // pass the link on by hand.
  let emailSent = false
  if (out.token) {
    inviteLink = `${config.APP_ORIGIN}/reset-password?token=${out.token}`
    const sent = await sendMail({
      to: email,
      subject: "You've been invited to AssetCore",
      text: `You've been invited to join AssetCore. Set your password: ${inviteLink}\n\nThis link expires in 7 days.`,
    })
    emailSent = sent.delivered
  }
  res.status(201).json({ user_id: out.userId, invite_link: inviteLink, email_sent: emailSent })
})

const roleSchema = z.object({ role_key: z.enum(ROLE_KEYS) })

orgMembersRouter.patch('/org/members/:id/role', async (req, res) => {
  const parsed = roleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const orgId = req.claims!.org_id!
  const membershipId = String(req.params.id)

  const out = await withOwnerTx(async (c) => {
    const owners = await lockActiveOwners(c, orgId)
    const before = await getOrgMembership(c, orgId, membershipId)
    if (!before) return fail(404, 'not_found')
    if ((before.role_key === 'owner' || parsed.data.role_key === 'owner') && !isOwner(req)) return fail(403, 'owner_only')

    if (before.role_key === 'owner' && before.status === 'active' && parsed.data.role_key !== 'owner' && owners <= 1) {
      return fail(400, 'cannot_demote_last_owner')
    }

    const { rows } = await c.query(
      'update public.memberships set role_key = $2 where id = $1 returning *',
      [membershipId, parsed.data.role_key]
    )
    await auditFromReq(c, req, {
      action: 'user.role', entityType: 'membership', entityId: membershipId,
      before: { role_key: before.role_key }, after: { role_key: parsed.data.role_key },
    })
    return { row: rows[0] }
  })
  if (isFail(out)) return res.status(out.status).json({ error: out.error })
  res.json(out.row)
})

// Update a member's location/site scope and per-user capability grants. Sending
// a field replaces it; omit a field to leave it unchanged. null scope = all.
// The member edit modal also sets a line manager (0028), so this patch carries
// it. A manager only preselects a name when someone sends work for approval.
// It grants nothing, so it rides on the same user:manage gate as scope.
const ACCESS_ALLOWED = ['site_scope', 'location_scope', 'extra_caps', 'manager_id']
const accessSchema = scopeSchema.extend({
  manager_id: z.string().uuid().nullable().optional(),
})

orgMembersRouter.patch('/org/members/:id/access', async (req, res) => {
  const parsed = accessSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const orgId = req.claims!.org_id!
  const membershipId = String(req.params.id)

  // Sending a field replaces it; an empty grant list is [] rather than null.
  const patch: Record<string, unknown> = { ...parsed.data }
  if ('extra_caps' in patch) patch.extra_caps = patch.extra_caps ?? []
  const { setSql, values } = buildSet(patch, ACCESS_ALLOWED, 2)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const out = await withOwnerTx(async (c) => {
    const before = await getOrgMembership(c, orgId, membershipId)
    if (!before) return fail(404, 'not_found')
    if (before.role_key === 'owner' && !isOwner(req)) return fail(403, 'owner_only')
    const managerId = parsed.data.manager_id
    if (managerId) {
      // Managed by someone who is actually here: an active member of this org,
      // not the member themselves.
      if (managerId === before.user_id) return fail(422, 'invalid_manager')
      const { rows: mgr } = await c.query(
        "select manager_id from public.memberships where org_id = $1 and user_id = $2 and status = 'active'",
        [orgId, managerId]
      )
      if (!mgr[0]) return fail(422, 'invalid_manager')
      // Two people each other's manager is always a data-entry slip, and it
      // would bounce a "send to my manager" request straight back. Longer
      // loops are left alone because the field only preselects a picker.
      if (mgr[0].manager_id === before.user_id) return fail(422, 'manager_cycle')
    }
    const { rows } = await c.query(
      `update public.memberships set ${setSql} where id = $1 and org_id = $2 returning *`,
      [membershipId, orgId, ...values]
    )
    await auditFromReq(c, req, {
      action: 'user.access', entityType: 'membership', entityId: membershipId,
      before: { site_scope: before.site_scope, location_scope: before.location_scope, extra_caps: before.extra_caps },
      after: parsed.data,
    })
    return { row: rows[0] }
  })
  if (isFail(out)) return res.status(out.status).json({ error: out.error })
  res.json(out.row)
})

function setStatus(status: 'disabled' | 'active', action: string) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const orgId = req.claims!.org_id!
    const membershipId = String(req.params.id)

    const out = await withOwnerTx(async (c) => {
      const owners = await lockActiveOwners(c, orgId)
      const before = await getOrgMembership(c, orgId, membershipId)
      if (!before) return fail(404, 'not_found')
      if (before.role_key === 'owner' && !isOwner(req)) return fail(403, 'owner_only')

      if (status === 'disabled') {
        if (before.user_id === req.claims!.sub) return fail(400, 'cannot_disable_self')
        if (before.role_key === 'owner' && before.status === 'active' && owners <= 1) {
          return fail(400, 'cannot_disable_last_owner')
        }
      }

      const { rows } = await c.query('update public.memberships set status = $2 where id = $1 returning *', [membershipId, status])
      await auditFromReq(c, req, {
        action, entityType: 'membership', entityId: membershipId,
        before: { status: before.status }, after: { status },
      })
      return { row: rows[0] }
    })
    if (isFail(out)) return res.status(out.status).json({ error: out.error })
    res.json(out.row)
  }
}
orgMembersRouter.post('/org/members/:id/disable', setStatus('disabled', 'user.disable'))
orgMembersRouter.post('/org/members/:id/enable', setStatus('active', 'user.enable'))

orgMembersRouter.post('/org/members/:id/reset-password', async (req, res) => {
  const orgId = req.claims!.org_id!
  const membershipId = String(req.params.id)

  const out = await withOwnerTx(async (c) => {
    const membership = await getOrgMembership(c, orgId, membershipId)
    if (!membership) return fail(404, 'not_found')
    // The link comes back in the response, so resetting an owner is a way to
    // sign in as one.
    if (membership.role_key === 'owner' && !isOwner(req)) return fail(403, 'owner_only')

    const token = await issueToken(c, membership.user_id, 'reset')
    await auditFromReq(c, req, { action: 'user.reset_password', entityType: 'membership', entityId: membershipId })
    return { token, email: membership.email as string }
  })
  if (isFail(out)) return res.status(out.status).json({ error: out.error })

  const link = `${config.APP_ORIGIN}/reset-password?token=${out.token}`
  const sent = await sendMail({ to: out.email, subject: 'Reset your AssetCore password', text: `Reset your password: ${link}\n\nThis link expires in 1 hour.` })
  res.json({ action_link: link, email_sent: sent.delivered })
})
