import { api } from '../apiClient'

export const ESCALATION_ENTITY_TYPES = [
  ['work_order', 'Work order'],
  ['pm_task', 'PM task'],
  ['defect', 'Defect'],
  ['inspection', 'Inspection'],
  ['approval', 'Approval'],
  ['compliance_licence', 'Licence'],
]

// Mirrors VALID_TRIGGERS in apps/api/src/routes/escalations.ts. Only the pairs
// the evaluator has a query for are offered; anything else would be accepted
// by the form and then skipped every night without a word.
export const VALID_TRIGGERS = {
  work_order: ['overdue', 'unassigned', 'stale'],
  pm_task: ['overdue', 'unassigned'],
  defect: ['overdue', 'unacknowledged', 'stale'],
  inspection: ['overdue', 'unassigned'],
  approval: ['overdue', 'unacknowledged'],
  compliance_licence: ['overdue'],
}

export const TRIGGER_LABEL = {
  overdue: 'Past its due date',
  unassigned: 'Nobody assigned',
  unacknowledged: 'Raised but not picked up',
  stale: 'Nothing has happened to it',
}

export async function listEscalationRules() {
  return api.get('/escalation-rules')
}

export async function listEscalationEvents(limit = 50) {
  return api.get(`/escalation-events?limit=${limit}`)
}

export async function createEscalationRule(input) {
  return api.post('/escalation-rules', input)
}

export async function updateEscalationRule(id, patch) {
  return api.patch(`/escalation-rules/${id}`, patch)
}

export async function retireEscalationRule(id) {
  await api.del(`/escalation-rules/${id}`)
}

// Runs the rules for this org now rather than waiting for the 07:15 cron —
// the only way to see whether a new rule catches anything. Escalations fire
// once per entity, so this makes a notification early, never twice.
export async function runEscalationsNow() {
  return api.post('/escalation-rules/run', {})
}
