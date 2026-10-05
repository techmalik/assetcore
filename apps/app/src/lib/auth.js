import { api, getAccessToken, setAccessToken, onTokenChange, refreshAccessToken } from './apiClient'

// --- claims (org_id + role_key live in the JWT, same claim names as before) ---
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(payload))))
  } catch {
    return {}
  }
}

// Reconstructs the session shape the frontend already expects, so
// AuthContext/Sidebar/rbac call sites (session.access_token,
// session.user.user_metadata.full_name) survive unchanged.
function sessionFromToken(token, user) {
  if (!token) return null
  const claims = decodeJwt(token)
  return {
    access_token: token,
    user: user ?? { id: claims.sub, email: claims.email, user_metadata: {} },
  }
}

// Treat a token as spent slightly before its exp, so one that dies in flight
// isn't sent on a round trip that was always going to fail.
const EXPIRY_SKEW_MS = 10_000

/** True only when the token says so itself. A token with no exp claim is left
 * for the server to judge — guessing on its behalf would sign people out. */
function isExpired(token) {
  const { exp } = decodeJwt(token)
  if (typeof exp !== 'number') return false
  return exp * 1000 - EXPIRY_SKEW_MS <= Date.now()
}

// --- session ---------------------------------------------------------------
export async function getSession() {
  let token = getAccessToken()
  if (!token) return null

  // An access token past its exp will 401 without fail, and the recovery is
  // the refresh cookie either way. Going straight there saves a request that
  // could only ever have failed — which is also the request that put a 401 in
  // the console on the first load of every morning.
  if (isExpired(token)) {
    const refreshed = await refreshAccessToken()
    if (!refreshed) { setAccessToken(null); return null }
    token = getAccessToken()
  }

  try {
    const me = await api.get('/auth/me')
    return sessionFromToken(token, {
      id: me.id,
      email: me.email,
      user_metadata: { full_name: me.fullName },
      must_change_password: me.mustChangePassword,
    })
  } catch {
    setAccessToken(null)
    return null
  }
}

export function onAuthStateChange(cb) {
  const unsubscribe = onTokenChange((token) => {
    if (!token) { cb(null); return }
    getSession().then(cb)
  })
  return { unsubscribe }
}

export function getOrgRole(session) {
  if (!session?.access_token) return { orgId: null, roleKey: null, extraCaps: [] }
  const c = decodeJwt(session.access_token)
  return { orgId: c.org_id ?? null, roleKey: c.role_key ?? null, extraCaps: c.extra_caps ?? [] }
}

// --- email/password ---------------------------------------------------------
export async function signIn(email, password) {
  const data = await api.post('/auth/login', { email, password })
  setAccessToken(data.accessToken)
  return sessionFromToken(data.accessToken, {
    id: data.user.id,
    email: data.user.email,
    user_metadata: { full_name: data.user.fullName },
    must_change_password: data.user.mustChangePassword,
  })
}

export async function signOut() {
  try { await api.post('/auth/logout') } catch { /* already signed out */ }
  setAccessToken(null)
}

// --- passwords ----------------------------------------------------------------
export async function changePassword(currentPassword, newPassword) {
  return api.post('/auth/change-password', { currentPassword, newPassword })
}

/** Always answers ok, whether or not the address has an account. */
export async function forgotPassword(email) {
  return api.post('/auth/forgot-password', { email })
}

export async function resetPassword(token, password) {
  return api.post('/auth/reset-password', { token, password })
}
