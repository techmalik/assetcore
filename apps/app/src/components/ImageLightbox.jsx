import { useState, useEffect, useCallback } from 'react'
import AuthImage from './AuthImage.jsx'
import { api } from '../lib/apiClient'

// Full-screen viewer for asset images. Click a thumbnail to open; supports
// keyboard navigation, prev/next across the asset's images, and a real
// authenticated download (a plain <a download> can't carry the auth header).
export default function ImageLightbox({ images, index = 0, onClose }) {
  const list = Array.isArray(images) ? images : [images]
  const [i, setI] = useState(index)
  const [busy, setBusy] = useState(false)

  const prev = useCallback(() => setI((n) => (n - 1 + list.length) % list.length), [list.length])
  const next = useCallback(() => setI((n) => (n + 1) % list.length), [list.length])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  const rel = list[i]
  const name = String(rel || '').split('/').pop() || 'image'

  async function downloadImage() {
    setBusy(true)
    try { await api.download(`/files/${rel}`, name) } catch (e) { alert(e.message || 'Download failed.') }
    finally { setBusy(false) }
  }

  const roundBtn = { width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.14)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 24 }}>
      {/* Top bar */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 16, left: 20, right: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ color: '#fff', fontSize: 13, fontFamily: 'var(--ff-m)', opacity: .85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}{list.length > 1 ? `  ·  ${i + 1} / ${list.length}` : ''}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={downloadImage} disabled={busy} title="Download" style={{ height: 34, padding: '0 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.1)', color: '#fff', fontSize: 13, fontFamily: 'var(--ff-u)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3M3 13h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {busy ? 'Downloading…' : 'Download'}
        </button>
        <button onClick={onClose} title="Close" style={roundBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {list.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); prev() }} title="Previous" style={{ ...roundBtn, position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)' }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}

      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '92vw', maxHeight: '82vh' }}>
        <AuthImage key={rel} relPath={rel} alt={name} style={{ maxWidth: '92vw', maxHeight: '82vh', objectFit: 'contain', borderRadius: 6, boxShadow: '0 12px 48px rgba(0,0,0,.5)' }} />
      </div>

      {list.length > 1 && (
        <button onClick={(e) => { e.stopPropagation(); next() }} title="Next" style={{ ...roundBtn, position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)' }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
    </div>
  )
}
