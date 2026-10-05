// ============================================================================
// @assetcore/domain — the allowed values for statuses, kinds and categories.
//
// The API validates against these (zod enums) and the app keys its labels
// and colours by them. Each used to be typed out in both places, and inside
// the API more than once, with nothing checking the copies agreed. Values
// only: labels are presentation and live in the app (apps/app/src/lib/domain.js).
//
// The database holds the same lists as check constraints. Changing a list
// here needs a migration too; apps/api/test/domain.test.ts compares a few.
//
// index.d.ts is generated from this file: run `node packages/domain/gen-dts.mjs`
// after editing. A test fails if the two disagree.
// ============================================================================

const freeze = (a) => Object.freeze(a)

// ── Work orders ──────────────────────────────────────────────────────────────
export const PRIORITIES = freeze(['low', 'medium', 'high', 'critical'])
export const WO_TYPES = freeze(['corrective', 'preventive', 'inspection', 'emergency'])
export const WO_STATUSES = freeze(['draft', 'new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed'])
// Where a job may move from each status. `draft` is where auto-generated jobs
// land (apply_asset_health, 0013): a planner approves it into `new` or closes it.
export const WO_TRANSITIONS = freeze({
  draft: freeze(['new', 'closed']),
  new: freeze(['assigned', 'in_progress', 'closed']),
  assigned: freeze(['in_progress', 'awaiting_parts', 'closed']),
  in_progress: freeze(['awaiting_parts', 'inspection', 'closed']),
  awaiting_parts: freeze(['in_progress', 'closed']),
  inspection: freeze(['closed', 'in_progress']),
  closed: freeze([]),
})

// ── Assets ───────────────────────────────────────────────────────────────────
// `attention` and `critical` are legacy statuses still carried by older rows.
export const ASSET_STATUSES = freeze(['operational', 'maintenance', 'standby', 'offline', 'attention', 'critical', 'inactive'])
export const LIFECYCLE_STATUSES = freeze(['planned', 'in_service', 'standby', 'under_maintenance', 'in_storage', 'disposed'])
export const CRITICALITIES = freeze(['low', 'medium', 'high', 'critical'])
// The per-asset override ('none' = not depreciated) ...
export const ASSET_DEPRECIATION_METHODS = freeze(['none', 'straight_line', 'declining_balance', 'sum_of_years_digits'])
// ... and the methods a depreciation schedule can be built with. Both used to
// be exported as DEPRECIATION_METHODS, with different contents.
export const SCHEDULE_DEPRECIATION_METHODS = freeze(['straight_line', 'declining_balance', 'sum_of_years_digits', 'units_of_production'])

// ── Maintenance ──────────────────────────────────────────────────────────────
export const PM_TASK_STATUSES = freeze(['pending', 'in_progress', 'completed', 'overdue', 'skipped'])
export const PM_FREQUENCIES = freeze(['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual'])

// ── Inspections ──────────────────────────────────────────────────────────────
export const INSPECTION_KINDS = freeze(['safety', 'condition', 'integrity', 'regulatory', 'environmental'])
export const INSPECTION_STATUSES = freeze(['scheduled', 'due', 'in_progress', 'completed', 'overdue'])
export const CHECKLIST_RESULTS = freeze(['pass', 'fail', 'na', 'pending'])

// ── Defects and risks ────────────────────────────────────────────────────────
export const DEFECT_SEVERITIES = freeze(['minor', 'moderate', 'major', 'critical'])
export const DEFECT_STATUSES = freeze(['open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'deferred'])
export const DEFECT_OPEN_STATUSES = freeze(['open', 'acknowledged', 'in_progress', 'deferred'])
export const RISK_CATEGORIES = freeze(['safety', 'environmental', 'operational', 'financial', 'compliance', 'security'])
export const RISK_STATUSES = freeze(['open', 'mitigating', 'accepted', 'closed'])
export const RISK_LIVE_STATUSES = freeze(['open', 'mitigating', 'accepted'])
// Worst first: the Integrity page ranks by this order.
export const INTEGRITY_STATUSES = freeze(['critical', 'at_risk', 'watch', 'sound', 'unassessed'])

// ── Compliance ───────────────────────────────────────────────────────────────
export const LICENCE_KINDS = freeze(['licence', 'permit', 'certificate', 'iso_certificate'])
export const AUDIT_KINDS = freeze(['internal', 'external', 'regulatory', 'certification'])
export const AUDIT_STATUSES = freeze(['scheduled', 'in_progress', 'completed', 'cancelled'])
export const AUDIT_OUTCOMES = freeze(['pass', 'pass_with_findings', 'fail', 'not_applicable'])
export const FINDING_SEVERITIES = freeze(['observation', 'minor', 'major', 'critical'])
export const FINDING_STATUSES = freeze(['open', 'closed'])

// ── Approvals and escalations ────────────────────────────────────────────────
export const APPROVAL_ENTITY_TYPES = freeze(['work_order', 'defect', 'compliance_licence', 'pm_task', 'inspection', 'maintenance_event'])
export const APPROVAL_KINDS = freeze([
  'wo_closure',         // sign-off that a job is genuinely finished
  'wo_cost',            // spend on a job above a threshold
  'defect_deferral',    // accepting a defect rather than fixing it
  'licence_renewal',
  'pm_signoff',
  'wo_approval',        // letting a drafted job go ahead (0028)
  'inspection_report',  // a completed inspection sent up for review (0028)
  'maintenance_report', // a completed maintenance record sent up for review (0028)
])
export const ESCALATION_ENTITY_TYPES = freeze(['work_order', 'pm_task', 'defect', 'inspection', 'approval', 'compliance_licence'])
export const ESCALATION_TRIGGERS = freeze(['overdue', 'unassigned', 'unacknowledged', 'stale'])
// Not every trigger makes sense for every entity, and run_escalations() has no
// query for the pairs left out, so the same table gates the API and the form.
export const VALID_TRIGGERS = freeze({
  work_order: freeze(['overdue', 'unassigned', 'stale']),
  pm_task: freeze(['overdue', 'unassigned']),
  defect: freeze(['overdue', 'unacknowledged', 'stale']),
  inspection: freeze(['overdue', 'unassigned']),
  approval: freeze(['overdue', 'unacknowledged']),
  compliance_licence: freeze(['overdue']),
})

// ── Parts ────────────────────────────────────────────────────────────────────
export const STOCK_MOVEMENT_KINDS = freeze(['receipt', 'issue', 'adjustment', 'return'])
