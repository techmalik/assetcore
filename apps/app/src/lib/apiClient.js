// Fetch wrapper for apps/api. Same-origin `/api` by default (nginx/Vite proxy
// handle routing) — override with VITE_API_URL for a split-host dev setup.
const BASE = import.meta.env.VITE_API_URL || '/api'

// No external keys are needed anymore — same-origin (or VITE_API_URL) always
// works. Kept as a named export so call sites that still branch on it don't
// need to change shape (removed entirely in Phase 2's copy sweep).
export const isConfigured = true

const TOKEN_KEY = 'ac_access_token'
let accessToken = localStorage.getItem(TOKEN_KEY) || null
const listeners = new Set()

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = token
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  listeners.forEach((fn) => fn(token))
}

// Fires whenever the token changes — sign in, sign out, or a silent refresh.
export function onTokenChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let refreshPromise = null

function refresh() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) { setAccessToken(null); return null }
        const data = await res.json()
        setAccessToken(data.accessToken)
        return data
      })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function request(method, path, body, { retry = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // Transparent refresh-and-retry: a request made with a stale/expired access
  // token gets one silent retry after a successful cookie-backed refresh.
  if (res.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await refresh()
    if (refreshed) return request(method, path, body, { retry: false })
  }

  if (res.status === 204) return null
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
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
}
