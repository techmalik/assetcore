import type { AccessClaims } from '../auth/jwt.js'

declare global {
  namespace Express {
    interface Request {
      claims?: AccessClaims
      // Set by requireActiveMembership for mutating requests only (GETs skip
      // the DB round trip) — the caller's role/scope/grants read fresh from
      // memberships rather than the possibly-stale JWT, so a just-revoked
      // capability or a just-narrowed site scope takes effect on the very
      // next write instead of waiting for token refresh. See TASK-2.6.
      membership?: { roleKey: string | null; extraCaps: string[]; siteIds: string[] | null }
    }
  }
}

export {}
