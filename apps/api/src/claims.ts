import type { Request } from 'express'
import type { Claims } from './db.js'

// req.membership (set by requireActiveMembership for mutating requests) is
// read fresh from the DB this request; the JWT's role_key/site_ids can be up
// to ~60min stale. Prefer it when present so RLS scoping (current_role_key(),
// current_site_ids()) reflects a just-changed role, grant, or site scope
// immediately instead of waiting for the caller's next token refresh.
export function claimsFromReq(req: Request): Claims {
  return {
    userId: req.claims?.sub ?? null,
    orgId: req.claims?.org_id ?? null,
    roleKey: req.membership?.roleKey ?? req.claims?.role_key ?? null,
    siteIds: req.membership?.siteIds ?? req.claims?.site_ids ?? null,
  }
}
