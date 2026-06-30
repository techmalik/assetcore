import { supabase, isConfigured } from './supabase'

// --- session ---------------------------------------------------------------
export async function getSession() {
  if (!isConfigured) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export function onAuthStateChange(cb) {
  if (!isConfigured) return { unsubscribe() {} }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session))
  return data.subscription
}

// --- claims (org_id + role_key live in the JWT, injected by the auth hook) ---
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(escape(atob(payload))))
  } catch {
    return {}
  }
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
  if (!isConfigured) throw new Error('Backend not configured')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  if (isConfigured) await supabase.auth.signOut()
}

// Register a new organization: create the auth user, create the org via the
// security-definer RPC, then refresh the session so the JWT carries org_id.
export async function registerOrg({ fullName, email, password, orgName, shortName, industry, region }) {
  if (!isConfigured) throw new Error('Backend not configured')

  const { data: signUp, error: signErr } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (signErr) throw signErr

  // With email confirmations off a session is returned immediately; otherwise
  // the user must confirm before they can sign in.
  if (!signUp.session) {
    throw new Error('Check your email to confirm your account, then sign in.')
  }

  const { error: rpcErr } = await supabase.rpc('create_organization', {
    p_name: orgName,
    p_short_name: shortName || null,
    p_industry: industry || null,
    p_region: region || null,
  })
  if (rpcErr) throw rpcErr

  // Mint a fresh token that now includes the org_id/role_key claims.
  await supabase.auth.refreshSession()
}

// SSO/SAML (Azure AD) is a fast-follow — this boundary keeps the call site stable.
export async function signInWithSSO(/* domain */) {
  throw new Error('SSO is not enabled yet')
}
