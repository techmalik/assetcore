import { api } from '../apiClient'

export async function listNotifications({ limit = 60 } = {}) {
  return api.get(`/notifications?limit=${limit}`)
}

export async function countUnread() {
  const { count } = await api.get('/notifications/unread-count')
  return count
}

export async function markRead(id) {
  await api.post(`/notifications/${id}/read`)
}

export async function markAllRead() {
  await api.post('/notifications/read-all')
}

export async function getPreferences() {
  return api.get('/notification-preferences')
}

export async function upsertPreference({ kind, in_app, email }) {
  await api.put('/notification-preferences', { kind, in_app, email })
}
