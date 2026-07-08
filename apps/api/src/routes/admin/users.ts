import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { ownerPool } from '../../db.js'
import { config } from '../../config.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'
import { hashPassword } from '../../auth/passwords.js'
import { issueToken } from '../../auth/tokens.js'
import { sendMail } from '../../auth/mailer.js'

export const adminUsersRouter = Router()

adminUsersRouter.get('/users', requirePlatformCap('user:read'), async (req, res) => {
  const search = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : ''
  const { rows } = await ownerPool.query(
    `select m.id, m.org_id, m.user_id, m.role_key, m.status, m.created_at,
       jsonb_build_object('name', o.name, 'short_name', o.short_name) as organizations,
       jsonb_build_object('full_name', u.full_name, 'email', u.email, 'phone', u.phone) as profiles
     from public.memberships m
     join public.organizations o on o.id = m.org_id
     join public.users u on u.id = m.user_id
     order by m.created_at desc
     limit 1000`
  )
  const filtered = !search
    ? rows
    : rows.filter((r) =>
        r.profiles?.email?.toLowerCase().includes(search) || r.profiles?.full_name?.toLowerCase().includes(search)
      )
  res.json({ users: filtered })
})

adminUsersRouter.patch('/users/:id/role', requirePlatformCap('user:write'), async (req, res) => {
  const roleKey = req.body?.role_key
  if (!roleKey) return res.status(400).json({ error: 'role_key is required' })
  const { rows: beforeRows } = await ownerPool.query('select * from public.memberships where id = $1', [req.params.id])
  const before = beforeRows[0]
  if (!before) return res.status(404).json({ error: 'Membership not found' })

  const { rows } = await ownerPool.query(
    'update public.memberships set role_key = $2 where id = $1 returning *',
    [req.params.id, roleKey]
  )
  const membership = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'user.role', targetType: 'user', targetId: before.user_id, orgId: before.org_id, before, after: membership, ip: req.ip })
  res.json({ membership })
})

function setMembershipStatus(status: string, action: string) {
  return async (req: import('express').Request, res: import('express').Response) => {
    const { rows: beforeRows } = await ownerPool.query('select * from public.memberships where id = $1', [req.params.id])
    const before = beforeRows[0]
    if (!before) return res.status(404).json({ error: 'Membership not found' })
    const { rows } = await ownerPool.query('update public.memberships set status = $2 where id = $1 returning *', [req.params.id, status])
    const membership = rows[0]
    await writePlatformAuditLog({ actorId: req.claims!.sub, action, targetType: 'user', targetId: before.user_id, orgId: before.org_id, before, after: membership, ip: req.ip })
    res.json({ membership })
  }
}
adminUsersRouter.post('/users/:id/disable', requirePlatformCap('user:write'), setMembershipStatus('disabled', 'user.disable'))
adminUsersRouter.post('/users/:id/enable', requirePlatformCap('user:write'), setMembershipStatus('active', 'user.enable'))

// Our own token flow replaces auth.admin.inviteUserByEmail: creates the user
// (random unguessable password, must_change_password) + membership, then
// emails a set-password (invite-token) link — or prints it in dev.
adminUsersRouter.post('/users/:id/invite', requirePlatformCap('user:write'), async (req, res) => {
  const { email, full_name, org_id, role_key } = req.body ?? {}
  if (!email || !org_id || !role_key) return res.status(400).json({ error: 'email, org_id, role_key required' })

  const client = await ownerPool.connect()
  try {
    await client.query('begin')
    const tempPasswordHash = await hashPassword(randomUUID())
    const { rows: userRows } = await client.query(
      `insert into public.users (email, password_hash, full_name, must_change_password)
       values ($1, $2, $3, true)
       on conflict (email) do update set email = excluded.email
       returning id`,
      [email, tempPasswordHash, full_name ?? '']
    )
    const userId = userRows[0].id
    await client.query(
      `insert into public.memberships (org_id, user_id, role_key, status)
       values ($1, $2, $3, 'active')
       on conflict (org_id, user_id) do update set role_key = excluded.role_key, status = 'active'`,
      [org_id, userId, role_key]
    )
    const token = await issueToken(client, userId, 'invite')
    await client.query('commit')

    const link = `${config.APP_ORIGIN}/reset-password?token=${token}&invite=1`
    await sendMail({ to: email, subject: "You've been invited to AssetCore", text: `Set your password: ${link}\n\nThis link expires in 7 days.` })
    await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'user.invite', targetType: 'user', targetId: userId, orgId: org_id, after: { email, role_key }, ip: req.ip })
    res.status(201).json({ user_id: userId })
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
})

// Our own token flow replaces auth.admin.generateLink: issues a reset token
// and returns the link (also emailed) for the admin to hand to the user.
adminUsersRouter.post('/users/:userId/reset-password', requirePlatformCap('user:write'), async (req, res) => {
  const { email } = req.body ?? {}
  if (!email) return res.status(400).json({ error: 'email is required' })

  const client = await ownerPool.connect()
  try {
    const userId = String(req.params.userId)
    const token = await issueToken(client, userId, 'reset')
    const link = `${config.APP_ORIGIN}/reset-password?token=${token}`
    await sendMail({ to: email, subject: 'Reset your AssetCore password', text: `Reset your password: ${link}\n\nThis link expires in 1 hour.` })
    await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'user.reset_password', targetType: 'user', targetId: userId, ip: req.ip })
    res.json({ action_link: link })
  } finally {
    client.release()
  }
})
