import { api } from '../apiClient'

export async function listIntegrations() {
  return api.get('/integrations')
}

export async function getIntegration(kind) {
  return api.get(`/integrations/${kind}`)
}

export async function upsertIntegration(kind, { label, config, enabled }) {
  return api.put(`/integrations/${kind}`, { label, config, enabled })
}

// No sync trigger: connector wiring (SAP/Termii/SCADA) is commissioned per
// client engagement — see the disabled Sync button in Integrations.jsx.
