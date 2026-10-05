// How the app shows each status, priority and kind: a label and a tone.
//
// The values themselves come from @assetcore/domain, the same lists the API
// validates against. This file adds only presentation. Every page used to keep
// its own map, and they had drifted: a low-priority job was green in the asset
// panel and grey on Work Orders, Analytics wrote "In progress" where every
// other screen wrote "In Progress", and the asset map coloured a standby or
// maintenance asset as if it were offline. src/lib/__tests__/domain.test.js
// fails if a value has no entry here.
import {
  WO_STATUSES, WO_TYPES, PRIORITIES, ASSET_STATUSES, CRITICALITIES,
  PM_TASK_STATUSES, INSPECTION_STATUSES,
} from '@assetcore/domain'

export {
  WO_STATUSES, WO_TYPES, PRIORITIES, ASSET_STATUSES, CRITICALITIES,
  PM_TASK_STATUSES, INSPECTION_STATUSES,
}
export { WO_TRANSITIONS } from '@assetcore/domain'

/**
 * The colour families a badge, a dot or a chart bar can take. `bg`/`c`/`br`
 * draw a pill (StatusBadge), `c` alone colours text, `solid` fills a dot or a
 * bar. All are design tokens, so dark mode follows.
 */
export const TONES = {
  good:    { bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', solid: 'var(--sg)' },
  warn:    { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', solid: 'var(--sa)' },
  bad:     { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', solid: 'var(--sr)' },
  info:    { bg: 'var(--slb)', c: 'var(--slt)', br: 'var(--slbr)', solid: 'var(--sl)' },
  blue:    { bg: 'var(--b50)', c: 'var(--b700)', br: 'var(--b200)', solid: 'var(--b500)' },
  neutral: { bg: 'var(--n100)', c: 'var(--n600)', br: 'var(--n300)', solid: 'var(--n300)' },
  muted:   { bg: 'var(--n100)', c: 'var(--n500)', br: 'var(--n300)', solid: 'var(--n400)' },
  faint:   { bg: 'var(--n50)', c: 'var(--n500)', br: 'var(--n200)', solid: 'var(--n300)' },
}

const meta = (entries) => Object.fromEntries(entries.map(([key, label, tone]) => [key, { key, label, tone }]))

// Work order status reads by position on the board, not colour, so every
// status is the same blue. Draft is the exception: a system-proposed job
// waiting for approval is muted so it does not look like real work yet.
export const WO_STATUS = meta([
  ['draft', 'Draft', 'neutral'],
  ['new', 'New', 'blue'],
  ['assigned', 'Assigned', 'blue'],
  ['in_progress', 'In Progress', 'blue'],
  ['awaiting_parts', 'Awaiting Parts', 'blue'],
  ['inspection', 'Inspection', 'blue'],
  ['closed', 'Closed', 'blue'],
])

// Low is grey wherever a priority is shown (owner decision Q7).
export const PRIORITY = meta([
  ['low', 'Low', 'neutral'],
  ['medium', 'Medium', 'blue'],
  ['high', 'High', 'warn'],
  ['critical', 'Critical', 'bad'],
])

export const WO_TYPE = meta([
  ['corrective', 'Corrective', 'neutral'],
  ['preventive', 'Preventive', 'neutral'],
  ['inspection', 'Inspection', 'neutral'],
  ['emergency', 'Emergency', 'bad'],
])

// attention/critical are legacy statuses some older rows still carry.
export const ASSET_STATUS = meta([
  ['operational', 'Operational', 'good'],
  ['maintenance', 'Maintenance', 'warn'],
  ['standby', 'Standby', 'info'],
  ['offline', 'Offline', 'muted'],
  ['inactive', 'Inactive', 'faint'], // at a shut-down site (0027)
  ['attention', 'Attention', 'warn'],
  ['critical', 'Critical', 'bad'],
])

export const CRITICALITY = meta([
  ['low', 'Low', 'good'],
  ['medium', 'Medium', 'info'],
  ['high', 'High', 'warn'],
  ['critical', 'Critical', 'bad'],
])

export const PM_TASK_STATUS = meta([
  ['pending', 'Pending', 'info'],
  ['in_progress', 'In Progress', 'warn'],
  ['completed', 'Completed', 'good'],
  ['overdue', 'Overdue', 'bad'],
  ['skipped', 'Skipped', 'faint'],
])

export const INSPECTION_STATUS = meta([
  ['scheduled', 'Scheduled', 'info'],
  ['due', 'Due', 'warn'],
  ['in_progress', 'In Progress', 'warn'],
  ['completed', 'Completed', 'good'],
  ['overdue', 'Overdue', 'bad'],
])

export const ASSET_DEPRECIATION_METHOD = meta([
  ['none', 'Not depreciated', 'neutral'],
  ['straight_line', 'Straight line', 'neutral'],
  ['declining_balance', 'Declining balance', 'neutral'],
  ['sum_of_years_digits', "Sum of years' digits", 'neutral'],
])

/** The tone for a value in a meta map, with a fallback for an unknown value. */
export function toneOf(map, key, fallback = 'muted') {
  return TONES[map[key]?.tone ?? fallback]
}

/** The label for a value, or the raw value when there is none. */
export function labelOf(map, key) {
  return map[key]?.label ?? key
}

/** { key: { bg, c, br, solid, label } } for every entry: the shape StatusBadge
 * and the older page-local maps take, so a call site can switch over as is. */
export function badgeMap(map) {
  return Object.fromEntries(Object.values(map).map((m) => [m.key, { ...TONES[m.tone], label: m.label }]))
}
