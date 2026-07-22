import type { Request, Response, NextFunction } from 'express'

// Server-side mirror of apps/app/src/lib/rbac.js — the single source of truth
// for enforcement. The client copy stays for UI gating only.
//
// user:manage, integration:manage are intentionally not listed under any
// role below — they're owner-only, covered by owner's '*'. org:manage is
// also owner-only EXCEPT ops_manager, which is explicitly granted it so
// operations managers can maintain the location/site hierarchy and asset
// categories without full admin rights.
const ROLE_CAPABILITIES: Record<string, string[]> = {
  owner: ['*'],
  ops_manager: [
    'asset:read', 'asset:create', 'asset:update',
    'wo:read', 'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
    'pm:read', 'pm:create', 'pm:update', 'maintenance:complete',
    'inspection:read', 'compliance:read',
    'report:read', 'report:create', 'audit:read', 'user:read',
    'org:manage',
  ],
  maint_engineer: [
    'asset:read', 'asset:update',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'pm:update', 'maintenance:complete', 'inspection:read', 'inspection:create',
    'report:read',
  ],
  field_tech: [
    'asset:read',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'inspection:read', 'inspection:create',
  ],
  hse_officer: [
    'asset:read',
    'wo:read',
    'inspection:read', 'inspection:create', 'inspection:update',
    'compliance:read', 'compliance:create', 'compliance:update',
    'report:read', 'report:create',
  ],
  // Read-only across entities, plus audit visibility.
  auditor: ['*:read', 'audit:read'],
  viewer: ['*:read'],
}

export function can(
  roleKey: string | null | undefined,
  capability: string,
  extraCaps: string[] = []
): boolean {
  // Per-user grants (admin-assigned) sit on top of the role baseline.
  if (extraCaps.includes(capability)) return true
  const caps = roleKey ? ROLE_CAPABILITIES[roleKey] : undefined
  if (!caps) return false
  if (caps.includes('*')) return true
  if (caps.includes(capability)) return true
  if (capability.endsWith(':read') && caps.includes('*:read')) return true
  return false
}

/** Mount after requireAuth (and, on every router that has it, after
 * requireActiveMembership — req.membership, when present, is read fresh
 * from the DB this request and takes priority over the possibly-stale JWT
 * claims; see TASK-2.6). 403s unless the caller's role or per-user grants
 * include `capability`. */
export function requireCap(capability: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roleKey = req.membership?.roleKey ?? req.claims?.role_key
    const extraCaps = req.membership?.extraCaps ?? req.claims?.extra_caps ?? []
    if (!can(roleKey, capability, extraCaps)) {
      return res.status(403).json({ error: 'forbidden', capability })
    }
    next()
  }
}
