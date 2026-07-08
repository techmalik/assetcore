import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../auth/jwt.js'

/** Verifies the `Authorization: Bearer <jwt>` header and attaches `req.claims`.
 * Does NOT re-check `users.status` on every request (that's a DB round trip
 * per call) — access tokens are short-lived (~60 min); a disabled user is
 * locked out at the next /api/auth/refresh, which does check status. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'missing_token' })

  try {
    req.claims = await verifyAccessToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'invalid_token' })
  }
}
