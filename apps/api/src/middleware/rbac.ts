import type { Request, Response, NextFunction } from 'express'
// The role → capability map and can() live in @assetcore/rbac — one shared
// workspace package consumed by both this API (enforcement) and apps/app
// (UI gating), so the two sides can no longer drift apart.
import { can } from '@assetcore/rbac'

export { can, ROLE_CAPABILITIES, GRANTABLE_CAPS, ROLE_KEYS } from '@assetcore/rbac'

/** Mount after requireAuth (and, on every router that has it, after
 * requireActiveMembership — req.membership, when present, is read fresh
 * from the DB this request and takes priority over the possibly-stale JWT
 * claims; see TASK-2.6). 403s unless the caller's role or per-user grants
 * include `capability`. */
export function requireCap(capability: string) {
  return (req: Request, res: Response, next: NextFunction) => {
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
export function hasCap(req: Request, capability: string): boolean {
  const roleKey = req.membership?.roleKey ?? req.claims?.role_key
  const extraCaps = req.membership?.extraCaps ?? req.claims?.extra_caps ?? []
  return can(roleKey, capability, extraCaps)
}
