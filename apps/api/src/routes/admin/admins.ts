import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'

export const platformAdminsRouter = Router()

platformAdminsRouter.get('/admins', requirePlatformCap('admin:read'), async (_req, res) => {
  const { rows } = await ownerPool.query(
    `select pa.user_id, pa.role, pa.full_name, pa.status, pa.created_at,
       jsonb_build_object('email', u.email) as profiles
     from public.platform_admins pa
     join public.users u on u.id = pa.user_id
     order by pa.created_at desc`
  )
  res.json({ admins: rows })
})

platformAdminsRouter.post('/admins', requirePlatformCap('admin:write'), async (req, res) => {
  const { email, role, full_name } = req.body ?? {}
  if (!email || !role) return res.status(400).json({ error: 'email and role are required' })
  const { rows: userRows } = await ownerPool.query('select id, full_name from public.users where email = $1', [email])
  const user = userRows[0]
  if (!user) return res.status(404).json({ error: 'No user with that email — they must sign up first' })

  const { rows } = await ownerPool.query(
    `insert into public.platform_admins (user_id, role, full_name, created_by)
     values ($1, $2, $3, $4) returning *`,
    [user.id, role, full_name ?? user.full_name ?? '', req.claims!.sub]
  )
  const admin = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'admin.add', targetType: 'admin', targetId: user.id, after: admin, ip: req.ip })
  res.status(201).json({ admin })
})

platformAdminsRouter.patch('/admins/:userId', requirePlatformCap('admin:write'), async (req, res) => {
  const { rows: beforeRows } = await ownerPool.query('select * from public.platform_admins where user_id = $1', [req.params.userId])
  const before = beforeRows[0]
  if (!before) return res.status(404).json({ error: 'Admin not found' })

  const body = req.body ?? {}
  const patch: Record<string, unknown> = {}
  if ('role' in body) patch.role = body.role
  if ('status' in body) patch.status = body.status
  const cols = Object.keys(patch)
  if (cols.length === 0) return res.status(400).json({ error: 'empty_patch' })

  const setSql = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  const { rows } = await ownerPool.query(
    `update public.platform_admins set ${setSql} where user_id = $1 returning *`,
    [req.params.userId, ...cols.map((c) => patch[c])]
  )
  const admin = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'admin.update', targetType: 'admin', targetId: String(req.params.userId), before, after: admin, ip: req.ip })
  res.json({ admin })
})
