// Role → capability map. UI gates with can(); the database enforces the same
// boundaries via RLS + role checks. Keep capability strings in `entity:action`
// form. '*' = all; '*:read' = read-only across entities.
//
// org:manage, user:manage, integration:manage are intentionally not listed
// under any role below — they're owner-only, covered by owner's '*'. Defined
// here (and mirrored in apps/api/src/middleware/rbac.ts) so call sites use a
// real capability name instead of a made-up one.
const ROLE_CAPABILITIES = {
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
  viewer: ['*:read'],
}

export function can(roleKey, capability) {
  const caps = ROLE_CAPABILITIES[roleKey]
  if (!caps) return false
  if (caps.includes('*')) return true
  if (caps.includes(capability)) return true
  if (capability.endsWith(':read') && caps.includes('*:read')) return true
  return false
}

export const ROLE_LABELS = {
  owner: 'Org Owner / Admin',
  ops_manager: 'Operations Manager',
  maint_engineer: 'Maintenance Engineer',
  field_tech: 'Field Technician',
  hse_officer: 'HSE Officer',
  viewer: 'Executive / Viewer',
}
