// Shared asset-health color + band helper — the single source of truth for the
// health thresholds used across Assets, Dashboard, and anywhere else that renders
// a score. Bands (per product spec):
//   > 50        → green  (healthy)
//   31 – 50     → yellow (attention)
//   <= 30       → red    (critical)
// The display bands here are fixed per the product spec. The *trigger*
// thresholds in the health-recompute job are org-configurable (inspection
// defaults to 50, maintenance/auto-WO defaults to 30 — Admin → Configuration);
// the color bands intentionally stay at the spec values regardless.

export const HEALTH_YELLOW_MAX = 50
export const HEALTH_RED_MAX = 30

/** Band key for a 0–100 score: 'good' | 'attention' | 'critical'. */
export function healthBand(score) {
  const s = score ?? 0
  if (s <= HEALTH_RED_MAX) return 'critical'
  if (s <= HEALTH_YELLOW_MAX) return 'attention'
  return 'good'
}

/** Solid semantic color token (for bars, gauge strokes, dots). */
export function healthColor(score) {
  return { good: 'var(--sg)', attention: 'var(--sa)', critical: 'var(--sr)' }[healthBand(score)]
}

/** Text-weight semantic color token (for numbers/labels on light backgrounds). */
export function healthTextColor(score) {
  return { good: 'var(--sgt)', attention: 'var(--sat)', critical: 'var(--srt)' }[healthBand(score)]
}

/** Human-readable condition label for a score. */
export function healthLabel(score) {
  return { good: 'Healthy', attention: 'Needs attention', critical: 'Critical condition' }[healthBand(score)]
}
