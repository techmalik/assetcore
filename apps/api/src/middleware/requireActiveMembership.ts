import type { Request, Response, NextFunction } from 'express'
import { ownerPool } from '../db.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Mount after requireAuth + requireOrg on every tenant router. requireAuth
 * deliberately doesn't hit the DB on every request (access tokens are
 * short-lived) — but that means a disabled user could keep mutating data for
 * up to the token's ~60min lifetime. This closes that gap for state-changing
 * requests only: GETs skip the DB round trip entirely. */
export async function requireActiveMembership(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next()

  const { sub, org_id: orgId } = req.claims!
  const { rows } = await ownerPool.query(
    `select u.status as user_status, m.status as membership_status
     from public.users u
     left join public.memberships m on m.user_id = u.id and m.org_id = $2
     where u.id = $1`,
    [sub, orgId]
  )
  const row = rows[0]
  if (!row || row.user_status !== 'active' || row.membership_status !== 'active') {
    return res.status(403).json({ error: 'account_disabled' })
  }
  next()
}
