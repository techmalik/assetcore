import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isConfigured } from './supabase'
import { getSession, onAuthStateChange, getOrgRole, signOut as doSignOut } from './auth'

const AuthCtx = createContext(null)

export function initialsOf(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase()
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

  const { orgId, roleKey } = getOrgRole(session)

  // Load org and check if onboarding is needed (no sites yet).
  useEffect(() => {
    if (!isConfigured || !orgId) { setOrg(null); setNeedsOnboarding(false); return }
    let cancelled = false
    Promise.all([
      supabase.from('organizations').select('id,name,short_name,region,plan,settings').eq('id', orgId).single(),
      supabase.from('sites').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    ]).then(([{ data: orgData }, { count }]) => {
      if (cancelled) return
      setOrg(orgData || null)
      const alreadyOnboarded = orgData?.settings?.onboarded === true
      setNeedsOnboarding(!alreadyOnboarded && (count ?? 0) === 0)
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
    org,
    fullName,
    initials: initialsOf(fullName),
    needsOnboarding,
    signOut: doSignOut,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
