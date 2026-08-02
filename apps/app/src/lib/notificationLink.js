// Turns a notification's (entity_type, entity_id) pair into an in-app route.
//
// Every notification producer — the API routes, the WO activity trigger, and
// the threshold/expiry SQL functions — has always populated these two columns,
// but nothing in the frontend ever read them, so a notification was a dead end:
// you could see that a work order had been assigned to you and had no way to
// reach it. This is the missing half.
//
// Returns null for an unknown or absent entity type, and callers render the
// item as non-clickable rather than navigating somewhere arbitrary. A wrong
// destination is worse than no destination.

const ROUTES = {
  work_order: (id) => `/work-orders?id=${id}`,
  pm_task: (id) => `/maintenance?tab=pm&id=${id}`,
  inspection: (id) => `/inspections?id=${id}`,
  asset: (id) => `/assets?id=${id}`,
  compliance_licence: (id) => `/compliance?id=${id}`,
}

// Human label for the button that opens the target.
const LABELS = {
  work_order: 'Open work order',
  pm_task: 'Open maintenance task',
  inspection: 'Open inspection',
  asset: 'Open asset',
  compliance_licence: 'Open licence',
}

/** Route for a notification, or null when it isn't linkable. */
export function notificationHref(n) {
  if (!n?.entity_type || !n?.entity_id) return null
  const build = ROUTES[n.entity_type]
  return build ? build(n.entity_id) : null
}

/** Label for the "open it" action, or null when the notification isn't linkable. */
export function notificationLinkLabel(n) {
  if (!notificationHref(n)) return null
  return LABELS[n.entity_type] || 'Open'
}
