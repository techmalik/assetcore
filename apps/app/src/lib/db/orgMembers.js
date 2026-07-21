import { api } from '../apiClient'

export async function listOrgMembers() {
  return api.get('/org/members')
}

// Active-member roster (id/full_name/email) for assignee/operator pickers —
// readable by any member, unlike listOrgMembers (owner-only management).
export async function listOrgUsers() {
  return api.get('/org/users')
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
