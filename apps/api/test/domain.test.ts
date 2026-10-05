import { describe, expect, it } from 'vitest'
import * as domain from '@assetcore/domain'
import { ownerClient } from './fixtures.js'

// The database keeps its own copy of each list as a check constraint. The API
// validates against @assetcore/domain before a write reaches the database, so
// the two must agree: a value the package allows and the constraint refuses
// is a 500 waiting to happen, and the reverse is a value nobody can set.
const SAME: Array<[string, readonly string[]]> = [
  ['work_orders_priority_check', domain.PRIORITIES],
  ['work_orders_type_check', domain.WO_TYPES],
  ['work_orders_status_check', domain.WO_STATUSES],
  ['assets_status_check', domain.ASSET_STATUSES],
  ['assets_lifecycle_status_check', domain.LIFECYCLE_STATUSES],
  ['assets_criticality_check', domain.CRITICALITIES],
  ['assets_depreciation_method_check', domain.ASSET_DEPRECIATION_METHODS],
  ['depreciation_schedules_method_check', domain.SCHEDULE_DEPRECIATION_METHODS],
  ['pm_tasks_status_check', domain.PM_TASK_STATUSES],
  ['pm_schedules_frequency_check', domain.PM_FREQUENCIES],
  ['inspections_kind_check', domain.INSPECTION_KINDS],
  ['inspections_status_check', domain.INSPECTION_STATUSES],
  ['defects_severity_check', domain.DEFECT_SEVERITIES],
  ['defects_status_check', domain.DEFECT_STATUSES],
  ['risk_assessments_category_check', domain.RISK_CATEGORIES],
  ['risk_assessments_status_check', domain.RISK_STATUSES],
  ['compliance_licences_kind_check', domain.LICENCE_KINDS],
  ['compliance_audits_kind_check', domain.AUDIT_KINDS],
  ['compliance_audits_status_check', domain.AUDIT_STATUSES],
  ['compliance_audits_outcome_check', domain.AUDIT_OUTCOMES],
  ['compliance_audit_findings_severity_check', domain.FINDING_SEVERITIES],
  ['compliance_audit_findings_status_check', domain.FINDING_STATUSES],
  ['escalation_rules_entity_type_check', domain.ESCALATION_ENTITY_TYPES],
  ['escalation_rules_trigger_check', domain.ESCALATION_TRIGGERS],
]
// Lists a client may set, where the database also allows system-only values.
const SUBSET: Array<[string, readonly string[]]> = [
  ['stock_movements_kind_check', domain.STOCK_MOVEMENT_KINDS], // + 'consumption', written when a job closes
]

async function constraintValues(): Promise<Map<string, string[]>> {
  const c = ownerClient()
  await c.connect()
  try {
    const { rows } = await c.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
       where contype = 'c' and connamespace = 'public'::regnamespace`
    )
    return new Map(rows.map((r) => [r.conname as string, [...(r.def as string).matchAll(/'([^']*)'::text/g)].map((m) => m[1])]))
  } finally {
    await c.end()
  }
}

describe('@assetcore/domain agrees with the database', () => {
  it.each(SAME)('%s', async (name, list) => {
    const values = (await constraintValues()).get(name)
    expect(values, `no constraint ${name}`).toBeTruthy()
    expect([...values!].sort()).toEqual([...list].sort())
  })

  it.each(SUBSET)('%s (client-settable subset)', async (name, list) => {
    const values = (await constraintValues()).get(name)
    expect(values, `no constraint ${name}`).toBeTruthy()
    for (const v of list) expect(values).toContain(v)
  })
})
