import type { Request, Response, NextFunction } from 'express'

/** Mount after requireAuth on every tenant-scoped router. Platform admins with
 * no membership carry a JWT with org_id: null and have no business on these
 * routes — they use /api/admin instead. */
export function requireOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.claims?.org_id) return res.status(403).json({ error: 'no_org_context' })
  next()
}
