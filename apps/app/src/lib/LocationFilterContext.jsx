import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { listMyLocations } from './db/locations'

// Named LocationFilterContext (not LocationContext) and useLocationFilter
// (not useLocation) specifically to avoid colliding with react-router-dom's
// own useLocation hook.
const LocationFilterContext = createContext({
  locationId: null, setLocationId: () => {}, locations: [], loading: true,
})

// Per-user key so switching accounts on the same browser doesn't leak one
// user's last-picked location into another's session.
const storeKey = (userId) => `assetcore.locationFilter.${userId || 'anon'}`

export function LocationFilterProvider({ children }) {
  const { user, authed } = useAuth()
  const [locations, setLocations] = useState([])
  const [locationId, setLocationIdState] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authed) { setLocations([]); setLocationIdState(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    listMyLocations().then((locs) => {
      if (cancelled) return
      setLocations(locs)
      let stored = null
      try { stored = localStorage.getItem(storeKey(user?.id)) } catch { /* ignore */ }
      // Validate the stored id still exists (and is still in the user's
      // permitted scope, since listLocations() is already RLS-scoped) before
      // trusting it — a location can be deleted, or scope can narrow, between
      // sessions.
      setLocationIdState(stored && locs.some((l) => l.id === stored) ? stored : null)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [authed, user?.id])

  const setLocationId = useCallback((id) => {
    setLocationIdState(id)
    try {
      if (id) localStorage.setItem(storeKey(user?.id), id)
      else localStorage.removeItem(storeKey(user?.id))
    } catch { /* ignore */ }
  }, [user?.id])

  return (
    <LocationFilterContext.Provider value={{ locationId, setLocationId, locations, loading }}>
      {children}
    </LocationFilterContext.Provider>
  )
}

export const useLocationFilter = () => useContext(LocationFilterContext)
