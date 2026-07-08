import type { Request, Response, NextFunction } from 'express'

// Server-side mirror of apps/admin/src/lib/rbac.js — the single source of
// truth for platform-console enforcement. The client copy stays for UI gating only.
const ROLE_CAPS: Record<string, string[]> = {
  superadmin: ['*'],
  admin: [
    'org:read', 'org:write', 'org:suspend', 'user:read', 'user:write',
    'billing:read', 'billing:write', 'impersonate', 'admin:read', 'audit:read',
  ],
  support: ['org:read', 'user:read', 'billing:read', 'impersonate', 'audit:read'],
  billing: ['org:read', 'billing:read', 'billing:write', 'audit:read'],
}

export function hasCap(role: string | undefined, cap: string): boolean {
  const caps = role ? ROLE_CAPS[role] : undefined
  if (!caps) return false
  return caps[0] === '*' || caps.includes(cap)
}

/** Mount after requirePlatformAdmin. 403s unless the caller's platform role has `cap`. */
export function requirePlatformCap(cap: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasCap(req.platformAdmin?.role, cap)) {
      return res.status(403).json({ error: 'forbidden', capability: cap })
    }
    next()
  }
}
