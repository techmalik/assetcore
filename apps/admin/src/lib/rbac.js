// Platform-admin capability model. MUST mirror the server-side map in
// supabase/functions/admin-api/_guard.ts. The UI uses can() to hide/disable
// actions; the Edge function re-enforces every call, so this is UX only.
const ROLE_CAPS = {
  superadmin: ['*'],
  admin: [
    'org:read', 'org:write', 'org:suspend', 'user:read', 'user:write',
    'billing:read', 'billing:write', 'impersonate', 'admin:read', 'audit:read',
  ],
  support: ['org:read', 'user:read', 'billing:read', 'impersonate', 'audit:read'],
  billing: ['org:read', 'billing:read', 'billing:write', 'audit:read'],
}

export function can(role, cap) {
  const caps = ROLE_CAPS[role]
  if (!caps) return false
  return caps[0] === '*' || caps.includes(cap)
}

export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  support: 'Support',
  billing: 'Billing',
}
