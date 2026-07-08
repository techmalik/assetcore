import { rawApi, getAccessToken, setAccessToken, onTokenChange } from './apiClient'

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(payload))))
  } catch {
    return {}
  }
}

function sessionFromToken(token) {
  if (!token) return null
  const claims = decodeJwt(token)
  return { access_token: token, user: { id: claims.sub, email: claims.email } }
}

export function getSession() {
  return sessionFromToken(getAccessToken())
}

export function onAuthStateChange(cb) {
  const unsubscribe = onTokenChange((token) => cb(sessionFromToken(token)))
  return { unsubscribe }
}

export async function signIn(email, password) {
  const data = await rawApi.post('/auth/login', { email, password })
  setAccessToken(data.accessToken)
  return sessionFromToken(data.accessToken)
}

export async function signOut() {
  try { await rawApi.post('/auth/logout') } catch { /* already signed out */ }
  setAccessToken(null)
}
