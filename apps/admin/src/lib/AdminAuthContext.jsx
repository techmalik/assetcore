import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabaseAdmin, isConfigured } from './supabaseAdmin'
import { can as canCap } from './rbac'

const Ctx = createContext(null)

export function AdminAuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [admin, setAdmin] = useState(null) // platform_admins row, or null
  const [adminLoaded, setAdminLoaded] = useState(false)

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    supabaseAdmin.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabaseAdmin.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Whenever the session changes, resolve whether this user is a platform admin.
  // RLS on platform_admins permits self-read only.
  const loadAdmin = useCallback(async (s) => {
    if (!s?.user) { setAdmin(null); setAdminLoaded(true); return }
    const { data } = await supabaseAdmin
      .from('platform_admins')
      .select('role,full_name,status')
      .eq('user_id', s.user.id)
      .maybeSingle()
    setAdmin(data && data.status === 'active' ? data : null)
    setAdminLoaded(true)
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    setAdminLoaded(false)
    loadAdmin(session)
  }, [session, loadAdmin])

  const signOut = useCallback(async () => {
    if (isConfigured) await supabaseAdmin.auth.signOut()
    setAdmin(null)
  }, [])

  const value = {
    loading,
    adminLoaded,
    session,
    user: session?.user ?? null,
    admin,
    isAdmin: Boolean(admin),
    adminRole: admin?.role ?? null,
    adminName: admin?.full_name || session?.user?.email || '',
    can: (cap) => canCap(admin?.role, cap),
    signOut,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider')
  return ctx
}
