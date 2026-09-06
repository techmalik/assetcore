import { useEffect, useState, useCallback } from 'react'
import AuthImage from './AuthImage.jsx'

/**
 * Full-size photo viewer.
 *
 * Asset photos have been stored since 0001 and rendered at 90px ever since,
 * which is not big enough to see the corrosion someone photographed. This is
 * the other half: arrow keys and Escape, because anyone flicking through a set
 * of site photos will reach for them before they reach for the mouse.
 */
export default function Lightbox({ items = [], index = 0, onClose }) {
  const [current, setCurrent] = useState(index)

  const go = useCallback((delta) => {
    setCurrent((i) => (i + delta + items.length) % items.length)
  }, [items.length])

  useEffect(() => { setCurrent(index) }, [index])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    // The page behind must not scroll while this is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [go, onClose])

  if (items.length === 0) return null
  const item = items[current]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(8,12,20,.88)',
        display: 'flex', flexDirection: 'column',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', color: '#fff', flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.caption || item.name || 'Photo'}
          </div>
          {items.length > 1 && (
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.6)', fontFamily: 'var(--ff-m)' }}>
              {current + 1} of {items.length}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} title="Close (Esc)"
          style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 16px 20px' }}>
        {items.length > 1 && (
          <button onClick={() => go(-1)} title="Previous (←)"
            style={{ width: 40, height: 40, flexShrink: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.08)', color: '#fff', cursor: 'pointer', fontSize: 18 }}>‹</button>
        )}

        {/* AuthImage fetches through the files API, which needs the bearer
            token an <img src> cannot carry. */}
        <AuthImage
          key={item.path}
          relPath={item.path}
          alt={item.caption || item.name || ''}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,.04)' }}
        />

        {items.length > 1 && (
          <button onClick={() => go(1)} title="Next (→)"
            style={{ width: 40, height: 40, flexShrink: 0, borderRadius: '50%', border: '1px solid rgba(255,255,255,.25)', background: 'rgba(255,255,255,.08)', color: '#fff', cursor: 'pointer', fontSize: 18 }}>›</button>
        )}
      </div>

      {items.length > 1 && (
        <div onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', gap: 6, padding: '0 20px 18px', overflowX: 'auto', flexShrink: 0, justifyContent: 'center' }}>
          {items.map((it, i) => (
            <button key={it.path} onClick={() => setCurrent(i)}
              style={{
                width: 54, height: 40, flexShrink: 0, padding: 0, borderRadius: 4, cursor: 'pointer', overflow: 'hidden',
                border: i === current ? '2px solid #fff' : '1px solid rgba(255,255,255,.25)',
                background: 'rgba(255,255,255,.06)', opacity: i === current ? 1 : 0.6,
              }}>
              <AuthImage relPath={it.path} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
