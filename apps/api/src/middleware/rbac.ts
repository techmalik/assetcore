import type { Request, Response, NextFunction } from 'express'

// Server-side mirror of apps/app/src/lib/rbac.js — the single source of truth
// for enforcement. The client copy stays for UI gating only.
//
// org:manage, user:manage, integration:manage are intentionally not listed
// under any role below — they're owner-only, covered by owner's '*'.
const ROLE_CAPABILITIES: Record<string, string[]> = {
  owner: ['*'],
  ops_manager: [
    'asset:read', 'asset:create', 'asset:update',
    'wo:read', 'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
    'pm:read', 'pm:create', 'pm:update',
    'inspection:read', 'compliance:read',
    'report:read', 'report:create', 'audit:read', 'user:read',
  ],
  maint_engineer: [
    'asset:read', 'asset:update',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'pm:update', 'inspection:read', 'inspection:create',
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

/** Mount after requireAuth. 403s unless the caller's role or per-user grants
 * include `capability`. */
export function requireCap(capability: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!can(req.claims?.role_key, capability, req.claims?.extra_caps ?? [])) {
      return res.status(403).json({ error: 'forbidden', capability })
    }
    next()
  }
}
