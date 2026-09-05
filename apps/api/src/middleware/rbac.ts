import type { Request, Response, NextFunction } from 'express'

// Server-side mirror of apps/app/src/lib/rbac.js — the single source of truth
// for enforcement. The client copy stays for UI gating only.
//
// org:manage, user:manage, integration:manage, depreciation:manage,
// approval:manage and escalation:manage are intentionally not listed under any
// role below — they're owner-only, covered by owner's '*'. Depreciation posting
// moves the books; the approval matrix and escalation rules decide who gets to
// sign off and who gets woken up. Only the owner sets those.
//
// approval:decide gates the endpoint; the approval's own current_role_key
// decides whether this particular caller is the one being waited on. Both
// checks have to pass, which is why the capability can be granted broadly.
const ROLE_CAPABILITIES: Record<string, string[]> = {
  owner: ['*'],
  ops_manager: [
    'asset:read', 'asset:create', 'asset:update',
    'wo:read', 'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
    'pm:read', 'pm:create', 'pm:update',
    'parts:read', 'parts:create', 'parts:update', 'parts:adjust',
    'depreciation:read',
    'defect:read', 'defect:create', 'defect:update',
    'approval:read', 'approval:create', 'approval:decide',
    'escalation:read',
    'inspection:read', 'compliance:read',
    'report:read', 'report:create', 'audit:read', 'user:read',
  ],
  maint_engineer: [
    'asset:read', 'asset:update',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'pm:update', 'inspection:read', 'inspection:create',
    'parts:read', 'parts:adjust',
    'defect:read', 'defect:create', 'defect:update',
    'approval:read', 'approval:create', 'approval:decide',
    'report:read',
  ],
  field_tech: [
    'asset:read',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'inspection:read', 'inspection:create',
    'defect:read', 'defect:create',
    'approval:read', 'approval:create',
    'parts:read',
  ],
  hse_officer: [
    'asset:read',
    'wo:read',
    'inspection:read', 'inspection:create', 'inspection:update',
    'compliance:read', 'compliance:create', 'compliance:update',
    'defect:read', 'defect:create', 'defect:update',
    'approval:read', 'approval:create', 'approval:decide',
    'parts:read',
    'report:read', 'report:create',
  ],
  viewer: ['*:read'],
}

export function can(roleKey: string | null | undefined, capability: string): boolean {
  const caps = roleKey ? ROLE_CAPABILITIES[roleKey] : undefined
  if (!caps) return false
  if (caps.includes('*')) return true
  if (caps.includes(capability)) return true
  if (capability.endsWith(':read') && caps.includes('*:read')) return true
  return false
}

/** Mount after requireAuth. 403s unless the caller's role_key has `capability`. */
export function requireCap(capability: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!can(req.claims?.role_key, capability)) {
      return res.status(403).json({ error: 'forbidden', capability })
    }
    next()
  }
}
