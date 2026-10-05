import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { config } from '../../config.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'
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
