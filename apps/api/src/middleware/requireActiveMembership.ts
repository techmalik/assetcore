import type { Request, Response, NextFunction } from 'express'
import { ownerPool } from '../db.js'
import { resolveSiteIds } from '../auth/routes.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Mount after requireAuth + requireOrg on every tenant router. requireAuth
 * deliberately doesn't hit the DB on every request (access tokens are
 * short-lived) — but that means a disabled user, a just-revoked capability,
 * or a just-narrowed site scope would otherwise keep working for up to the
 * token's ~60min lifetime. This closes that gap for state-changing requests
 * only: GETs skip the DB round trip entirely (a stale *read* scope for up to
 * an hour is a materially smaller risk than a stale *write* scope, and
 * matches the account-disabled tradeoff this middleware already made).
 *
 * On success, attaches req.membership with role/caps/site_ids read fresh
 * from the DB — requireCap() and claimsFromReq() both prefer it over the
 * JWT's claims when present, so every downstream check in this request uses
 * live data, not what was true when the caller last logged in. */
export async function requireActiveMembership(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next()

  const { sub, org_id: orgId } = req.claims!
  const { rows } = await ownerPool.query(
    `select u.status as user_status, m.status as membership_status,
       m.role_key, m.extra_caps, m.site_scope, m.location_scope
     from public.users u
     left join public.memberships m on m.user_id = u.id and m.org_id = $2
     where u.id = $1`,
    [sub, orgId]
  )
  const row = rows[0]
  if (!row || row.user_status !== 'active' || row.membership_status !== 'active') {
    return res.status(403).json({ error: 'account_disabled' })
  }

  const siteIds = await resolveSiteIds(orgId ?? null, row.site_scope ?? null, row.location_scope ?? null)
  req.membership = { roleKey: row.role_key, extraCaps: row.extra_caps ?? [], siteIds }
  next()
}
