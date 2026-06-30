import { supabaseAdmin, adminApiBase } from './supabaseAdmin'

// Thin fetch wrapper around the admin-api Edge Function. Attaches the current
// session's access token as a Bearer; the Edge function re-checks platform-admin
// identity + capability server-side (never trust the client). Throws an Error
// carrying the server message + status so callers can render error states.
async function request(method, path, body) {
  if (!supabaseAdmin) throw new Error('Backend not configured')
  const { data } = await supabaseAdmin.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(`${adminApiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  let payload = null
  try { payload = await res.json() } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(payload?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return payload
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
}
