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
// The role keys are also stored in the database (public.roles, and every
// role_key column that references it) — 0026_roles_restructure.sql is the
// migration that moved data onto this set. Adding a key here without a roles
// row makes invites to it fail the foreign key.
//
// owner (labelled "System Admin") is the only '*' role. admin runs the org
// day to day: org:manage, user:manage, audit:read, and the approval matrix
// and escalation rules (approval:manage, escalation:manage). Two things stay
// owner-only, covered by owner's '*' and deliberately not granted to admin:
//   - integration:manage — wires the instance to outside systems;
//   - depreciation:manage — posting depreciation moves the books.
// user:manage on admin does NOT extend to owners: orgMembers.ts refuses to let
// a non-owner grant the owner role or touch an existing owner's membership,
// otherwise an admin could promote themselves past this line.
//
// manager still holds org:manage (as ops_manager did) so operations managers
// can maintain the location/site hierarchy and asset categories without user
// or governance rights.
//
// managing_director / executive_director are oversight roles: read everything,
// read the audit log, and sign off on approvals — they do no operational
// editing.
//
// approval:decide gates the endpoint; the approval's own current_role_key
// decides whether this particular caller is the one being waited on. Both
// checks have to pass, which is why the capability can be granted broadly.
// ============================================================================

// Operations manager baseline, shared by `manager` and (as a subset) `admin`,
// so the two can't drift: an admin is a manager plus governance rights.
const MANAGER_CAPS = [
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
]

const EXECUTIVE_CAPS = [
  '*:read', 'audit:read',
  'approval:read', 'approval:create', 'approval:decide',
  'report:read', 'report:create',
  'depreciation:read',
]

export const ROLE_CAPABILITIES = {
  owner: ['*'],
  admin: [
    ...MANAGER_CAPS,
    'user:manage',
    'approval:manage', 'escalation:manage',
    'compliance:create', 'compliance:update',
    'inspection:create', 'inspection:update',
  ],
  managing_director: [...EXECUTIVE_CAPS],
  executive_director: [...EXECUTIVE_CAPS],
  manager: [...MANAGER_CAPS],
  supervisor: [
    'asset:read', 'asset:update',
    'wo:read', 'wo:create', 'wo:update', 'wo:assign', 'wo:transition',
    'pm:read', 'pm:update', 'maintenance:complete',
    'inspection:read', 'inspection:create', 'inspection:update',
    'parts:read', 'parts:adjust',
    'defect:read', 'defect:create', 'defect:update',
    'risk:read',
    'approval:read', 'approval:create', 'approval:decide',
    'report:read',
  ],
  officer: [
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

// Read capabilities that '*:read' deliberately does NOT satisfy — they have
// to be granted by name. The audit log records who did what to whom across
// the whole organisation, including who invited which member; "read-only
// across entities" is a statement about business data, not a licence to read
// the org's own security record.
//
// The auditor role already listed 'audit:read' alongside '*:read', which only
// makes sense if the author believed the wildcard did not cover it. It did,
// so that explicit grant was dead and every '*:read' role — viewer included —
// silently inherited audit access, and with it an Admin tab (audit:read is in
// ADMIN_ENTRY_CAPS). This list makes the wildcard mean what it was written to
// mean and brings the auditor's (and the directors') explicit grant back to
// life.
export const EXPLICIT_ONLY_CAPS = ['audit:read']

/** Role → capability check. Per-user grants (extraCaps) sit on top of the
 * role baseline. */
export function can(roleKey, capability, extraCaps = []) {
  if (extraCaps?.includes(capability)) return true
  const caps = roleKey ? ROLE_CAPABILITIES[roleKey] : undefined
  if (!caps) return false
  if (caps.includes('*')) return true
  if (caps.includes(capability)) return true
  if (capability.endsWith(':read') && caps.includes('*:read') && !EXPLICIT_ONLY_CAPS.includes(capability)) return true
  return false
}

// Capabilities an admin may grant per-user on top of the role baseline. Kept to
// operational edit rights — never wildcards or org/user/integration/approval-
// matrix management, which belong to roles, not to individual grants.
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

export const ROLE_KEYS = [
  'owner', 'admin', 'managing_director', 'executive_director',
  'manager', 'supervisor', 'officer', 'hse_officer', 'auditor', 'viewer',
]

// Seniority, highest first — used to order people and roles in pickers (e.g.
// approvers, member lists). Mirrors public.roles.rank; it is NOT an
// authorisation check — capabilities decide what a role may do.
export const ROLE_RANK = {
  owner: 100,
  admin: 90,
  managing_director: 85,
  executive_director: 80,
  manager: 70,
  hse_officer: 60,
  supervisor: 55,
  auditor: 40,
  officer: 30,
  viewer: 10,
}

// Every capability that grants entry to /admin at all — a role needs at
// least one of these to see any Admin tab (e.g. an Auditor holds only
// audit:read and lands on the Audit Log tab alone).
export const ADMIN_ENTRY_CAPS = ['org:manage', 'user:manage', 'audit:read']

export const ROLE_LABELS = {
  owner: 'System Admin',
  admin: 'Admin',
  managing_director: 'Managing Director',
  executive_director: 'Executive Director',
  manager: 'Manager',
  supervisor: 'Supervisor',
  officer: 'Officer',
  hse_officer: 'HSE / Compliance Officer',
  auditor: 'Auditor',
  viewer: 'Viewer / Guest',
}
