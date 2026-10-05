import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { api } from './apiClient'
import { getSession, onAuthStateChange, getOrgRole, signOut as doSignOut } from './auth'
import { can } from './rbac'
import { useToast } from './ToastContext'
import { errorText } from './errors'

const AuthCtx = createContext(null)

export function initialsOf(name) {
  if (!name) return '?'
  // Keep only word-initial letters/digits so names like "Malik (Admin)" or
  // "O'Brien" yield clean initials instead of punctuation ("M(").
  const parts = name.trim().split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (!parts.length) return name.trim()[0]?.toUpperCase() || '?'
  return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [org, setOrg] = useState(null)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const toast = useToast()

  useEffect(() => {
    // If the server cannot be reached while an expired token is being
    // refreshed, getSession() rejects. Without the catch, loading never ended
    // and the app sat on the splash screen; now it lands on sign-in, with the
    // offline banner saying why.
    getSession()
      .then((s) => setSession(s))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
    const sub = onAuthStateChange((s) => setSession(s))
    return () => sub.unsubscribe()
  }, [])

  // Re-fetches /auth/me so DB-side flags (e.g. must_change_password clearing
  // after a successful change) are reflected without a full re-login.
  const refreshSession = useCallback(async () => {
    const s = await getSession()
    setSession(s)
    return s
  }, [])

  // Re-fetches /org so a settings change — currency above all, which every
  // money figure in the app reads through useMoney() — takes effect without a
  // reload.
  const refreshOrg = useCallback(async () => {
    const o = await api.get('/org')
    setOrg(o || null)
    return o
  }, [])

  // Decoded once per session, so extraCaps keeps one identity between renders
  // and hooks keyed on it (useCan) stay stable.
  const { orgId, roleKey, extraCaps } = useMemo(() => getOrgRole(session), [session])

  // Load org and check if onboarding is needed (no sites yet).
  useEffect(() => {
    if (!orgId) { setOrg(null); setNeedsOnboarding(false); return }
    let cancelled = false
    Promise.all([api.get('/org'), api.get('/sites')]).then(([orgData, sites]) => {
      if (cancelled) return
      setOrg(orgData || null)
      const alreadyOnboarded = orgData?.settings?.onboarded === true
      setNeedsOnboarding(!alreadyOnboarded && (sites?.length ?? 0) === 0)
    }).catch((e) => {
      // Every money figure reads the currency from org, so say it is missing
      // rather than quietly showing the default.
      if (!cancelled) toast.error(errorText(e, 'Could not load your organisation. Some figures may show default settings until you reload.'))
    })
    return () => { cancelled = true }
  }, [orgId, toast])

  const user = session?.user ?? null
  const fullName = user?.user_metadata?.full_name || user?.email || ''

  // One value object per change, not per render: every useAuth() consumer
  // re-renders when it changes identity.
  const value = useMemo(() => ({
    loading,
    authed: Boolean(session),
    user,
    orgId,
    roleKey,
    extraCaps,
    org,
    fullName,
    initials: initialsOf(fullName),
    needsOnboarding,
    mustChangePassword: Boolean(user?.must_change_password),
    signOut: doSignOut,
    refreshSession,
    refreshOrg,
  }), [loading, session, user, orgId, roleKey, extraCaps, org, fullName, needsOnboarding, refreshSession, refreshOrg])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * The permission check for UI gating: `const can = useCan(); can('risk:create')`.
 *
 * Always applies the caller's per-user grants on top of their role. Pages used
 * to call can(roleKey, cap) themselves, and thirteen of those calls left out
 * the grants, so a member granted risk:create never saw New Risk although the
 * API would have accepted it.
 */
export function useCan() {
  const { roleKey, extraCaps } = useAuth()
  return useCallback((capability) => can(roleKey, capability, extraCaps), [roleKey, extraCaps])
}
