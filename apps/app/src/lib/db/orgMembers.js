import { api } from '../apiClient'

export async function listOrgMembers() {
  return api.get('/org/members')
}

export async function inviteOrgMember({ email, full_name, role_key }) {
  return api.post('/org/members/invite', { email, full_name, role_key })
}

export async function updateOrgMemberRole(id, role_key) {
  return api.patch(`/org/members/${id}/role`, { role_key })
}

export async function setOrgMemberStatus(id, enable) {
  return api.post(`/org/members/${id}/${enable ? 'enable' : 'disable'}`)
}

export async function resetOrgMemberPassword(id) {
  return api.post(`/org/members/${id}/reset-password`)
}
