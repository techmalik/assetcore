// Fetch wrapper for apps/api. Same-origin `/api` by default (nginx/Vite proxy
// handle routing) — override with VITE_API_URL for a split-host dev setup.
const BASE = import.meta.env.VITE_API_URL || '/api'

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

/**
 * Exchanges the refresh cookie for a new access token, de-duplicating
 * concurrent callers so a burst of 401s makes one refresh, not five.
 *
 * Exported because auth.js needs it directly: a token whose exp has already
 * passed is worth refreshing without first spending a request proving it.
 */
export function refreshAccessToken() {
  return refresh()
}

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
    // The machine code, kept separate from the message so screens can look
    // up a sentence for it (lib/errors.js) instead of printing the code.
    err.code = payload?.error ?? fallbackCode(res.status)
    if (payload?.missing) err.missing = payload.missing
    // Some refusals carry detail worth showing — which parts fell short, and
    // by how much. Kept on the error so a screen can name them instead of
    // printing the generic sentence for the code.
    if (payload?.shortfalls) err.shortfalls = payload.shortfalls
    throw err
  }
  return payload
}

// A failure with no error body (a proxy with no server behind it, a crash
// before the handler answered) still gets a code, so lib/errors.js can say
// something better than "Request failed (500)".
function fallbackCode(status) {
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  if (status >= 500) return 'internal_error'
  return null
}

async function upload(path, formData, { retry = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: formData,
  })

  if (res.status === 401 && retry) {
    const refreshed = await refresh()
    if (refreshed) return upload(path, formData, { retry: false })
  }

  let payload = null
  try { payload = await res.json() } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(payload?.error || `Upload failed (${res.status})`)
    err.status = res.status
    // The machine code, kept separate from the message so screens can look
    // up a sentence for it (lib/errors.js) instead of printing the code.
    err.code = payload?.error ?? fallbackCode(res.status)
    if (payload?.missing) err.missing = payload.missing
    // A maintenance completion that closes a job is an upload, and is refused
    // with the same parts list as any other close.
    if (payload?.shortfalls) err.shortfalls = payload.shortfalls
    throw err
  }
  return payload
}

/**
 * An authenticated GET that returns the raw Response, for files: an <img src>
 * or <a href> cannot carry the Authorization header. Like request(), it
 * refreshes the token once on a 401 and throws an error with a code; the file
 * helpers used to do neither, so a photo or download failed once the access
 * token expired, and said only "Download failed (401)".
 */
async function raw(path, { retry = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
  })
  if (res.status === 401 && retry) {
    const refreshed = await refresh()
    if (refreshed) return raw(path, { retry: false })
  }
  if (!res.ok) {
    let payload = null
    try { payload = await res.json() } catch { /* not JSON */ }
    const err = new Error(payload?.error || `Download failed (${res.status})`)
    err.status = res.status
    err.code = payload?.error ?? fallbackCode(res.status)
    throw err
  }
  return res
}

/** Saves a blob through a throwaway link. The object URL is revoked a little
 * later: revoking it in the same tick can cancel the save in Firefox and
 * Safari. */
export function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

async function download(path, filename) {
  const res = await raw(path)
  saveBlob(await res.blob(), filename)
}

// For inline display (<img>, "View document"). The caller revokes the URL.
async function blobUrl(path) {
  const res = await raw(path)
  return URL.createObjectURL(await res.blob())
}

/**
 * A query string, with its '?', or '' when nothing is set. Leaves out
 * undefined, null, '', false and 'all' (every filter dropdown's "no filter"
 * value, which the API also reads as no filter), joins arrays with commas, and
 * encodes every value.
 *
 *   api.get(`/defects${qs({ status, severity, q })}`)
 */
export function qs(params = {}) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false || v === 'all') continue
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')) }
    else p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  upload,
  download,
  blobUrl,
  raw,
}
