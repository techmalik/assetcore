import { api, isConfigured, getAccessToken, setAccessToken, onTokenChange } from './apiClient'

export { isConfigured }

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

// --- session ---------------------------------------------------------------
export async function getSession() {
  const token = getAccessToken()
  if (!token) return null
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
  if (!session?.access_token) return { orgId: null, roleKey: null }
  const c = decodeJwt(session.access_token)
  return { orgId: c.org_id ?? null, roleKey: c.role_key ?? null }
}

export async function currentOrgId() {
  const session = await getSession()
  return session ? getOrgRole(session).orgId : null
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

// SSO/SAML (Azure AD) is parked backlog — this boundary keeps the call site stable
// for when it's picked up, even with no caller today.
export async function signInWithSSO(/* domain */) {
  throw new Error('SSO is not enabled yet')
}
