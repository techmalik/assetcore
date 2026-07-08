import type { Request, Response, NextFunction } from 'express'
import { ownerPool } from '../db.js'

declare module 'express-serve-static-core' {
  interface Request {
    platformAdmin?: { role: string }
  }
}

/** Mount after requireAuth. Looks up platform_admins via the owner pool (this
 * table has no RLS-pool write policy — only ownerPool reaches it), attaching
 * `req.platformAdmin`. Optionally restrict to specific platform roles. */
export function requirePlatformAdmin(allowedRoles?: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.claims?.sub) return res.status(401).json({ error: 'missing_token' })

    const { rows } = await ownerPool.query(
      "select role from public.platform_admins where user_id = $1 and status = 'active'",
      [req.claims.sub]
    )
    const admin = rows[0]
    if (!admin) return res.status(403).json({ error: 'not_a_platform_admin' })
    if (allowedRoles && !allowedRoles.includes(admin.role)) {
      return res.status(403).json({ error: 'insufficient_platform_role' })
    }
    req.platformAdmin = { role: admin.role }
    next()
  }
}
