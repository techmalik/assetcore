export declare const ROLE_CAPABILITIES: Record<string, string[]>
export declare function can(
  roleKey: string | null | undefined,
  capability: string,
  extraCaps?: string[]
): boolean
export declare const GRANTABLE_CAPS: readonly [string, ...string[]]
export declare const ROLE_KEYS: readonly [string, ...string[]]
export declare const ADMIN_ENTRY_CAPS: string[]
export declare const ROLE_LABELS: Record<string, string>
