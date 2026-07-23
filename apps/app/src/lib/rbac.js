// Role → capability map. UI gates with can(); the API enforces the same
// boundaries via requireCap + RLS. The map itself lives in @assetcore/rbac —
// one shared workspace package consumed by both this app and the API — so the
// two sides can no longer drift apart. This module just re-exports it to keep
// existing '../lib/rbac' import paths working.
export {
  ROLE_CAPABILITIES,
  can,
  GRANTABLE_CAPS,
  ROLE_KEYS,
  ADMIN_ENTRY_CAPS,
  ROLE_LABELS,
} from '@assetcore/rbac'
