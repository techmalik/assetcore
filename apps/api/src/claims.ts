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
    roleKey: effectiveRole(req),
    siteIds: req.membership?.siteIds ?? req.claims?.site_ids ?? null,
  }
}

// The caller's role and per-user grants, live where requireActiveMembership
// has read them (every write) and from the token otherwise. Every check of
// "who is this, really" goes through these, so no route reads the token's
// copy by accident: approvals once let a just-demoted approver pass the
// capability check on the live role and the "is it waiting on you" check on
// the stale one.
export function effectiveRole(req: Request): string | null {
  return req.membership?.roleKey ?? req.claims?.role_key ?? null
}

export function effectiveCaps(req: Request): string[] {
  return req.membership?.extraCaps ?? req.claims?.extra_caps ?? []
}

export function isOwner(req: Request): boolean {
  return effectiveRole(req) === 'owner'
}
