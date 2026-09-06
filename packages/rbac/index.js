// ============================================================================
// @assetcore/rbac — the single source of truth for the role → capability map.
//
// Consumed by BOTH sides:
//   - apps/app/src/lib/rbac.js   (UI gating only)
//   - apps/api/src/middleware/rbac.ts + routes/orgMembers.ts (enforcement)
//
// Previously each side kept its own hand-mirrored copy with a "keep in sync"
// comment and nothing asserting parity — this package removes the drift risk
// by making them the same object. Keep capability strings in `entity:action`
// form. '*' = all; '*:read' = read-only across entities.
//
// user:manage, integration:manage are intentionally not listed under any
// role below — they're owner-only, covered by owner's '*'. org:manage is
// also owner-only EXCEPT ops_manager, which is explicitly granted it so
// operations managers can maintain the location/site hierarchy and asset
// categories without full admin rights.
//
// depreciation:manage, approval:manage and escalation:manage are owner-only
// for the same reason: posting depreciation moves the books, and the approval
// matrix and escalation rules decide who gets to sign off and who gets woken
// up. Nobody grants themselves those.
//
// approval:decide gates the endpoint; the approval's own current_role_key
// decides whether this particular caller is the one being waited on. Both
// checks have to pass, which is why the capability can be granted broadly.
// ============================================================================

export const ROLE_CAPABILITIES = {
  owner: ['*'],
  ops_manager: [
    'asset:read', 'asset:create', 'asset:update',
    'wo:read', 'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
    'pm:read', 'pm:create', 'pm:update', 'maintenance:complete',
    'inspection:read', 'compliance:read',
    'parts:read', 'parts:create', 'parts:update', 'parts:adjust',
    'depreciation:read',
    'defect:read', 'defect:create', 'defect:update',
    'risk:read', 'risk:create', 'risk:update',
    'approval:read', 'approval:create', 'approval:decide',
    'escalation:read',
    'report:read', 'report:create', 'audit:read', 'user:read',
    'org:manage',
  ],
  maint_engineer: [
    'asset:read', 'asset:update',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'pm:update', 'maintenance:complete', 'inspection:read', 'inspection:create',
    'parts:read', 'parts:adjust',
    'defect:read', 'defect:create', 'defect:update',
    'risk:read',
    'approval:read', 'approval:create', 'approval:decide',
    'report:read',
  ],
  field_tech: [
    'asset:read',
    'wo:read', 'wo:update', 'wo:transition',
    'pm:read', 'inspection:read', 'inspection:create',
    'parts:read',
    'defect:read', 'defect:create',
    'risk:read',
    'approval:read', 'approval:create',
  ],
  hse_officer: [
    'asset:read',
    'wo:read',
    'inspection:read', 'inspection:create', 'inspection:update',
    'compliance:read', 'compliance:create', 'compliance:update',
    'parts:read',
    'defect:read', 'defect:create', 'defect:update',
    'risk:read', 'risk:create', 'risk:update',
    'approval:read', 'approval:create', 'approval:decide',
    'report:read', 'report:create',
  ],
  // Read-only across entities, plus audit visibility.
  auditor: ['*:read', 'audit:read'],
  viewer: ['*:read'],
}

/** Role → capability check. Per-user grants (extraCaps) sit on top of the
 * role baseline. */
export function can(roleKey, capability, extraCaps = []) {
  if (extraCaps?.includes(capability)) return true
  const caps = roleKey ? ROLE_CAPABILITIES[roleKey] : undefined
  if (!caps) return false
  if (caps.includes('*')) return true
  if (caps.includes(capability)) return true
  if (capability.endsWith(':read') && caps.includes('*:read')) return true
  return false
}

// Capabilities an admin may grant per-user on top of the role baseline. Kept to
// operational edit rights — never wildcards or org/user/integration management,
// which stay owner-only.
export const GRANTABLE_CAPS = [
  'asset:create', 'asset:update',
  'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
  'pm:create', 'pm:update', 'maintenance:complete',
  'inspection:create', 'inspection:update',
  'compliance:create', 'compliance:update',
  'parts:create', 'parts:update', 'parts:adjust',
  'defect:create', 'defect:update',
  'risk:create', 'risk:update',
  'approval:create', 'approval:decide',
  'report:create', 'audit:read',
]

export const ROLE_KEYS = ['owner', 'ops_manager', 'maint_engineer', 'field_tech', 'hse_officer', 'auditor', 'viewer']

// Every capability that grants entry to /admin at all — a role needs at
// least one of these to see any Admin tab (e.g. an Auditor holds only
// audit:read and lands on the Audit Log tab alone).
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
