import { useState, useEffect } from 'react'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine)
  const [wasOffline, setWasOffline] = useState(false)
  const [showRestored, setShowRestored] = useState(false)

  useEffect(() => {
    const goOffline = () => { setOffline(true); setWasOffline(true) }
    const goOnline  = () => {
      setOffline(false)
      if (wasOffline) {
        setShowRestored(true)
        setTimeout(() => setShowRestored(false), 3000)
      }
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline) }
  }, [wasOffline])

  if (!offline && !showRestored) return null

  return (
    <div style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      zIndex: 500, display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 18px', borderRadius: 6, boxShadow: 'var(--sh-lg)',
      background: offline ? 'var(--n900)' : 'var(--sgt)',
      color: '#fff', fontSize: 13, fontWeight: 500,
      animation: 'fadeInUp .2s ease',
    }}>
      {offline ? (
        <>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M8 4a6 6 0 015.3 3.2M4.3 5.5A6 6 0 002 8" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/><circle cx="8" cy="12" r="1" fill="#fff"/></svg>
          You're offline — changes will not be saved
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Connection restored
        </>
      )}
    </div>
  )
}
