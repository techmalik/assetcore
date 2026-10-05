export type Capability =
  'approval:create' |
  'approval:decide' |
  'approval:manage' |
  'approval:read' |
  'asset:create' |
  'asset:read' |
  'asset:update' |
  'audit:read' |
  'compliance:create' |
  'compliance:read' |
  'compliance:update' |
  'defect:create' |
  'defect:read' |
  'defect:update' |
  'depreciation:manage' |
  'depreciation:read' |
  'escalation:manage' |
  'escalation:read' |
  'inspection:create' |
  'inspection:read' |
  'inspection:update' |
  'integration:manage' |
  'maintenance:complete' |
  'org:manage' |
  'parts:adjust' |
  'parts:create' |
  'parts:read' |
  'parts:update' |
  'pm:create' |
  'pm:read' |
  'pm:update' |
  'report:read' |
  'risk:create' |
  'risk:read' |
  'risk:update' |
  'user:manage' |
  'user:read' |
  'wo:assign' |
  'wo:create' |
  'wo:read' |
  'wo:transition' |
  'wo:update'
export declare const CAPABILITIES: readonly Capability[]
export declare const ROLE_CAPABILITIES: Record<string, string[]>
export declare function can(
  roleKey: string | null | undefined,
  capability: string,
  extraCaps?: string[]
): boolean
export declare const GRANTABLE_CAPS: readonly [string, ...string[]]
export declare const ROLE_KEYS: readonly [string, ...string[]]
export declare const ROLE_RANK: Record<string, number>
export declare const ADMIN_ENTRY_CAPS: string[]
export declare const ROLE_LABELS: Record<string, string>
export declare const ROLE_DESCRIPTIONS: Record<string, { summary: string; covers: string[] }>
