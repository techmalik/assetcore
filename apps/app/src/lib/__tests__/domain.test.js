import { describe, expect, it } from 'vitest'
import * as lists from '@assetcore/domain'
import {
  TONES, WO_STATUS, PRIORITY, WO_TYPE, ASSET_STATUS, CRITICALITY, PM_TASK_STATUS, INSPECTION_STATUS,
  ASSET_DEPRECIATION_METHOD,
} from '../domain.js'
import { DEFECT_SEVERITIES, DEFECT_STATUSES } from '../db/defects.js'
import { RISK_CATEGORIES, RISK_STATUSES } from '../db/risks.js'
import { ESCALATION_ENTITY_TYPES } from '../db/escalations.js'
import { APPROVAL_ENTITY_TYPES, APPROVAL_KINDS } from '../db/approvals.js'
import { AUDIT_OUTCOMES, FINDING_SEVERITIES } from '../db/complianceLicences.js'
import { CHECKLIST_RESULTS } from '../db/inspections.js'
import { DEPRECIATION_METHODS } from '../db/depreciation.js'
import { INTEGRITY_STATUSES } from '../db/integrity.js'

// Every value the API accepts has a label and a tone here, so a new status
// cannot reach a screen as a raw key or an unstyled badge.
describe.each([
  ['WO_STATUS', WO_STATUS, lists.WO_STATUSES],
  ['PRIORITY', PRIORITY, lists.PRIORITIES],
  ['WO_TYPE', WO_TYPE, lists.WO_TYPES],
  ['ASSET_STATUS', ASSET_STATUS, lists.ASSET_STATUSES],
  ['CRITICALITY', CRITICALITY, lists.CRITICALITIES],
  ['PM_TASK_STATUS', PM_TASK_STATUS, lists.PM_TASK_STATUSES],
  ['INSPECTION_STATUS', INSPECTION_STATUS, lists.INSPECTION_STATUSES],
  ['ASSET_DEPRECIATION_METHOD', ASSET_DEPRECIATION_METHOD, lists.ASSET_DEPRECIATION_METHODS],
])('%s', (_, map, values) => {
  it('covers exactly the shared list, each with a label and a known tone', () => {
    expect(Object.keys(map).sort()).toEqual([...values].sort())
    for (const m of Object.values(map)) {
      expect(m.label).toBeTruthy()
      expect(TONES[m.tone]).toBeTruthy()
    }
  })
})

// The older per-module tuples ([value, label, ...]) still carry their own
// keys. They must stay the same set as the shared lists.
const keys = (tuples) => tuples.map((t) => t[0])
describe.each([
  ['defect severities', keys(DEFECT_SEVERITIES), lists.DEFECT_SEVERITIES],
  ['defect statuses', keys(DEFECT_STATUSES), lists.DEFECT_STATUSES],
  ['risk categories', keys(RISK_CATEGORIES), lists.RISK_CATEGORIES],
  ['risk statuses', keys(RISK_STATUSES), lists.RISK_STATUSES],
  ['escalation entities', keys(ESCALATION_ENTITY_TYPES), lists.ESCALATION_ENTITY_TYPES],
  ['approval entities', keys(APPROVAL_ENTITY_TYPES), lists.APPROVAL_ENTITY_TYPES],
  ['approval kinds', Object.values(APPROVAL_KINDS).flat().map((t) => t[0]), lists.APPROVAL_KINDS],
  ['audit outcomes', keys(AUDIT_OUTCOMES), lists.AUDIT_OUTCOMES],
  ['finding severities', keys(FINDING_SEVERITIES), lists.FINDING_SEVERITIES],
  ['checklist results', keys(CHECKLIST_RESULTS), lists.CHECKLIST_RESULTS],
  ['schedule depreciation methods', keys(DEPRECIATION_METHODS), lists.SCHEDULE_DEPRECIATION_METHODS],
])('%s', (_, appKeys, shared) => {
  it('match the shared list', () => {
    expect([...new Set(appKeys)].sort()).toEqual([...shared].sort())
  })
})

describe('integrity statuses', () => {
  it('keep the shared worst-first order, which the page ranks by', () => {
    expect(INTEGRITY_STATUSES).toEqual([...lists.INTEGRITY_STATUSES])
  })
})
