// Plain-English rendering for audit_log rows.
//
// The Admin audit tab used to print the raw machine strings: an admin read
// `wo.transition`, `pm_task.attachment.add`, `asset_category` and the first
// eight hex characters of a UUID. This maps the 40-odd action strings actually
// written by the API to sentences a person can read.
//
// Deliberately maps the historical inconsistencies rather than trying to
// normalise them — renaming actions would rewrite past entries, and an audit
// log that changes retroactively is worth less than one that reads slightly
// unevenly. The known quirks: `wo.*` sits alongside `work_order.attachment.add`;
// `category.*` is filed under entity type `asset_category`; `user.*` under
// `membership`; and `maintenance.complete` under `asset`.

export const ACTION_LABEL = {
  // Work orders
  'wo.create': 'Created work order',
  'wo.update': 'Updated work order',
  'wo.transition': 'Changed work order status',
  'wo.delete': 'Deleted work order',
  'work_order.attachment.add': 'Attached a file to work order',

  // Assets
  'asset.create': 'Registered asset',
  'asset.import': 'Imported asset',
  'asset.update': 'Updated asset',
  'asset.archive': 'Archived asset',
  'asset.restore': 'Restored asset',
  'asset.attachment.add': 'Attached a file to asset',
  'asset.attachment.remove': 'Removed a file from asset',
  'maintenance.complete': 'Completed maintenance on',

  // Maintenance
  'maintenance_event.attachment.add': 'Uploaded a maintenance report for',
  'pm_task.complete': 'Completed PM task',
  'pm_task.assign': 'Assigned PM task',
  'pm_task.attachment.add': 'Uploaded a report for PM task',
  'pm_schedule.create': 'Created PM schedule',
  'pm_schedule.update': 'Updated PM schedule',
  'pm_schedule.archive': 'Archived PM schedule',

  // Inspections
  'inspection.create': 'Scheduled inspection',
  'inspection.update': 'Updated inspection',
  'inspection.assign': 'Assigned inspection',
  'inspection.attachment.add': 'Uploaded a report for inspection',

  // Compliance
  'compliance_licence.create': 'Added licence',
  'compliance_licence.update': 'Updated licence',
  'compliance_licence.archive': 'Archived licence',
  'compliance_licence.attachment.add': 'Attached a document to licence',
  'compliance_licence.attachment.remove': 'Removed a document from licence',
  'compliance_audit.create': 'Created compliance audit',
  'compliance_audit.update': 'Updated compliance audit',
  'compliance_audit.archive': 'Archived compliance audit',
  'compliance_audit.attachment.add': 'Attached a document to compliance audit',

  // Structure
  'site.create': 'Created site',
  'site.update': 'Updated site',
  'site.delete': 'Deleted site',
  'location.create': 'Created location',
  'location.update': 'Updated location',
  'location.archive': 'Archived location',
  'category.create': 'Created asset category',
  'category.update': 'Updated asset category',
  'category.delete': 'Deleted asset category',
  'device.create': 'Added device',
  'device.update': 'Updated device',
  'device.delete': 'Removed device',

  // People
  'user.invite': 'Invited',
  'user.role': 'Changed the role of',
  'user.access': 'Changed access for',
  'user.disable': 'Disabled',
  'user.enable': 'Re-enabled',
  'user.reset_password': 'Reset the password for',
}

/** Human label for an action, degrading gracefully for anything unmapped. */
export function actionLabel(action) {
  if (!action) return 'Unknown action'
  if (ACTION_LABEL[action]) return ACTION_LABEL[action]
  // A future action string should still read as words rather than vanishing:
  // "quote.approve" -> "Quote approve".
  const words = String(action).replace(/[._]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Readable form of an entity_type, for the muted prefix beside the label. */
export function entityTypeLabel(entityType) {
  if (!entityType) return ''
  return String(entityType).replace(/_/g, ' ')
}

/** Colour by verb rather than by exact string — the old map covered 9 of 40. */
export function actionColor(action) {
  const a = String(action || '')
  if (/\.(create|import|invite|enable|restore)$/.test(a)) return 'var(--sgt)'
  if (/\.(delete|archive|disable|remove)$/.test(a) || a.endsWith('.attachment.remove')) return 'var(--srt)'
  if (/\.(complete|transition)$/.test(a)) return 'var(--b600)'
  return 'var(--sat)'
}
