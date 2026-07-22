// Role → capability map. UI gates with can(); the database enforces the same
// boundaries via RLS + role checks. Keep capability strings in `entity:action`
// form. '*' = all; '*:read' = read-only across entities.
//
// user:manage, integration:manage are intentionally not listed under any
// role below — they're owner-only, covered by owner's '*'. org:manage is
// also owner-only EXCEPT ops_manager, which is explicitly granted it so
// operations managers can maintain the location/site hierarchy and asset
// categories without full admin rights. Defined here (and mirrored in
// apps/api/src/middleware/rbac.ts) so call sites use a real capability name
// instead of a made-up one.
const ROLE_CAPABILITIES = {
  owner: ['*'],
  ops_manager: [
    'asset:read', 'asset:create', 'asset:update',
    'wo:read', 'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
    'pm:read', 'pm:create', 'pm:update',
    'inspection:read', 'compliance:read',
    'report:read', 'report:create', 'audit:read', 'user:read',
    'org:manage',
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
  auditor: ['*:read', 'audit:read'],
  viewer: ['*:read'],
}

export function can(roleKey, capability, extraCaps = []) {
  if (extraCaps?.includes(capability)) return true
  const caps = ROLE_CAPABILITIES[roleKey]
  if (!caps) return false
  if (caps.includes('*')) return true
  if (caps.includes(capability)) return true
  if (capability.endsWith(':read') && caps.includes('*:read')) return true
  return false
}

// Every capability that grants entry to /admin at all — a role needs at
// least one of these to see any Admin tab (e.g. an Auditor holds only
// audit:read and lands on the Audit Log tab alone). Kept here rather than in
// Admin.jsx since Admin.jsx imports Sidebar.jsx, which also needs this list.
export const ADMIN_ENTRY_CAPS = ['org:manage', 'user:manage', 'audit:read']

export const ROLE_LABELS = {
  owner: 'System Admin',
  ops_manager: 'Operations Manager',
  maint_engineer: 'Maintenance Engineer',
  field_tech: 'Field Technician',
  hse_officer: 'HSE Officer',
  auditor: 'Auditor',
  viewer: 'Executive / Viewer',
}
