import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { isConfigured } from './apiClient'
import { getSession, onAuthStateChange, signOut as doSignOut } from './auth'
import { api } from './api'
import { can as canCap } from './rbac'

const Ctx = createContext(null)

export function AdminAuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [admin, setAdmin] = useState(null) // { role, fullName }, or null
  const [adminLoaded, setAdminLoaded] = useState(false)

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return }
    setSession(getSession())
    setLoading(false)
    const sub = onAuthStateChange((s) => setSession(s))
    return () => sub.unsubscribe()
  }, [])

  // Whenever the session changes, resolve whether this user is a platform
  // admin via GET /api/admin/me (a 403 there means "not staff").
  const loadAdmin = useCallback(async (s) => {
    if (!s?.user) { setAdmin(null); setAdminLoaded(true); return }
    try {
      const data = await api.get('/me')
      setAdmin({ role: data.role, full_name: data.fullName })
    } catch {
      setAdmin(null)
    }
    setAdminLoaded(true)
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    setAdminLoaded(false)
    loadAdmin(session)
  }, [session, loadAdmin])

  const signOut = useCallback(async () => {
    if (isConfigured) await doSignOut()
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
