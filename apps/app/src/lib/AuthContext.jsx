import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, isConfigured } from './apiClient'
import { getSession, onAuthStateChange, getOrgRole, signOut as doSignOut } from './auth'

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

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    getSession().then((s) => { setSession(s); setLoading(false) })
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

  const { orgId, roleKey, extraCaps } = getOrgRole(session)

  // Load org and check if onboarding is needed (no sites yet).
  useEffect(() => {
    if (!isConfigured || !orgId) { setOrg(null); setNeedsOnboarding(false); return }
    let cancelled = false
    Promise.all([api.get('/org'), api.get('/sites')]).then(([orgData, sites]) => {
      if (cancelled) return
      setOrg(orgData || null)
      const alreadyOnboarded = orgData?.settings?.onboarded === true
      setNeedsOnboarding(!alreadyOnboarded && (sites?.length ?? 0) === 0)
    })
    return () => { cancelled = true }
  }, [orgId])

  const user = session?.user ?? null
  const fullName = user?.user_metadata?.full_name || user?.email || ''

  const value = {
    loading,
    authed: Boolean(session),
    session,
    user,
    orgId,
    roleKey,
    extraCaps: extraCaps ?? [],
    org,
    fullName,
    initials: initialsOf(fullName),
    needsOnboarding,
    mustChangePassword: Boolean(user?.must_change_password),
    signOut: doSignOut,
    refreshSession,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
