import type { Request, Response, NextFunction } from 'express'
import { effectiveRole, effectiveCaps } from '../claims.js'
// The role → capability map and can() live in @assetcore/rbac — one shared
// workspace package consumed by both this API (enforcement) and apps/app
// (UI gating), so the two sides can no longer drift apart.
import { can, type Capability } from '@assetcore/rbac'

export { can, GRANTABLE_CAPS, ROLE_KEYS } from '@assetcore/rbac'

/** Mount after requireAuth (and, on every router that has it, after
 * requireActiveMembership — req.membership, when present, is read fresh
 * from the DB this request and takes priority over the possibly-stale JWT
 * claims; see TASK-2.6). 403s unless the caller's role or per-user grants
 * include `capability`. */
export function requireCap(capability: Capability) {
  // Named so test/routeGates.test.ts can find it in a route's stack.
  return function requireCapMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!hasCap(req, capability)) {
      return res.status(403).json({ error: 'forbidden', capability })
    }
    next()
  }
}

/** In-handler capability check for routes that only need to gate ONE field of
 * an otherwise-broader-capability request — e.g. any wo:update holder may
 * PATCH a work order, but only wo:assign holders may change its assignee_id.
 * Same resolution order as requireCap (fresh membership over possibly-stale
 * JWT claims). */
export function hasCap(req: Request, capability: Capability): boolean {
  return can(effectiveRole(req), capability, effectiveCaps(req))
}

function hasAnyCap(req: Request, capabilities: readonly Capability[]): boolean {
  return capabilities.some((c) => hasCap(req, c))
}

/** requireCap for a route open to holders of any one of several
 * capabilities. Answers 403 naming the first. */
export function requireAnyCap(...capabilities: Capability[]) {
  // Same name as requireCap's middleware: test/routeGates.test.ts looks for it.
  return function requireCapMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!hasAnyCap(req, capabilities)) {
      return res.status(403).json({ error: 'forbidden', capability: capabilities[0] })
    }
    next()
  }
}
