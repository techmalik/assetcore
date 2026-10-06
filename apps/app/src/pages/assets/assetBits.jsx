import StatusBadge from '../../components/StatusBadge.jsx'
import { ASSET_STATUS, toneOf, labelOf } from '../../lib/domain'

// Asset status labels and colours live in lib/domain.js (ASSET_STATUS).
// operational/maintenance/standby/offline say what the asset is doing now;
// attention/critical are legacy values some older rows still carry, so they
// still render, but the Add/Edit picker below no longer offers them.

// The set offered on the Add/Edit picker going forward. An asset already
// carrying a legacy status (attention/critical) still shows that as its
// current option too, so opening Edit and saving unrelated fields doesn't
// silently reassign its status.
// `maintenance` is deliberately absent. It's an operational state the system
// derives: a work order moving to in_progress puts its asset under maintenance
// and closing the last one takes it back out (syncAssetStatusForWorkOrder in
// apps/api/src/routes/workOrders.ts). Hand-picking it on a form produced a
// status that immediately disagreed with the work. Still a legal value — the
// spread below keeps it selectable on a row that already has it.
export const STATUS_PICKER_KEYS = ['operational', 'standby', 'offline']

// Status values kept legal by 0012 for backwards compatibility but no longer
// written by anything — they described health, which now has its own filter.
export const LEGACY_STATUS_KEYS = ['attention', 'critical']
export const STATE_FILTERS = [
  ['all', 'All'],
  ...['operational', 'maintenance', 'standby', 'offline', 'inactive', 'attention', 'critical'].map((k) => [k, labelOf(ASSET_STATUS, k)]),
]

export const MAX_PHOTOS = 5

export function AssetStatusBadge({ status }) {
  return <StatusBadge tone={toneOf(ASSET_STATUS, status, 'muted')} label={labelOf(ASSET_STATUS, status)} size="md" />
}

// Next-maintenance cell color: red once past due, amber inside the next 14
// days, default text color otherwise — mirrors the overdue/expiring color
// convention already used on Maintenance and Compliance (var(--srt)/var(--sat)).
export function nextMaintColor(d) {
  if (!d) return 'var(--n500)'
  const days = Math.floor((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return 'var(--srt)'
  if (days < 14) return 'var(--sat)'
  return 'var(--n700)'
}
