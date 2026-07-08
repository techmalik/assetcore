import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requireAuth } from '../../middleware/requireAuth.js'

export const meRouter = Router()

// Deliberately mounted without requirePlatformAdmin: the frontend calls this
// right after login to learn whether the caller is a platform admin at all
// (a 403 here means "authenticated but not staff", not "go away").
meRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await ownerPool.query(
    "select role, full_name, status from public.platform_admins where user_id = $1 and status = 'active'",
    [req.claims!.sub]
  )
  const admin = rows[0]
  if (!admin) return res.status(403).json({ error: 'not_a_platform_admin' })
  res.json({
    role: admin.role,
    fullName: admin.full_name,
    userId: req.claims!.sub,
    email: req.claims!.email,
  })
})
