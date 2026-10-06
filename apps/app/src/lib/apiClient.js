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

/**
 * The one fetch every API call goes through. It sends the access token,
 * refreshes it once on a 401 and tries again (never for /auth/refresh
 * itself), and turns a failure into an Error carrying the API's code plus
 * any detail it sent. Returns the Response for the caller to read.
 *
 * There used to be four copies of this. They disagreed: uploads dropped the
 * shortfall detail, and photos and downloads neither refreshed the token nor
 * kept the code, so after an hour they failed with "Download failed (401)".
 */
async function send(method, path, { body, formData } = {}, retry = true) {
  const headers = { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  if (res.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await refresh()
    if (refreshed) return send(method, path, { body, formData }, false)
  }

  if (!res.ok) {
    let payload = null
    try { payload = await res.json() } catch { /* no body */ }
    const err = new Error(payload?.error || `Request failed (${res.status})`)
    err.status = res.status
    // The machine code, kept separate from the message so screens can look
    // up a sentence for it (lib/errors.js) instead of printing the code.
    err.code = payload?.error ?? fallbackCode(res.status)
    // Detail some refusals carry: which fields are missing, which parts fell
    // short and by how much. Kept so a screen can name them.
    if (payload?.missing) err.missing = payload.missing
    if (payload?.shortfalls) err.shortfalls = payload.shortfalls
    throw err
  }
  return res
}

// A failure with no error body (a proxy with no server behind it, a crash
// before the handler answered) still gets a code, so lib/errors.js can say
// something better than "Request failed (500)".
function fallbackCode(status) {
  if (status === 502 || status === 503 || status === 504) return 'unavailable'
  if (status >= 500) return 'internal_error'
  return null
}

async function json(res) {
  if (res.status === 204) return null
  try { return await res.json() } catch { return null }
}

const request = async (method, path, body) => json(await send(method, path, { body }))

const upload = async (path, formData) => json(await send('POST', path, { formData }))

/** An authenticated GET that returns the Response, for files: an <img src>
 * or <a href> cannot carry the Authorization header. */
const raw = (path) => send('GET', path)

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
