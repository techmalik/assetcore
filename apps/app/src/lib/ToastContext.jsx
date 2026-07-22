import { createContext, useContext, useCallback, useRef, useState } from 'react'

const ToastContext = createContext({ toast: { success() {}, error() {}, info() {} } })

const AUTO_DISMISS_MS = 3500

const KIND_STYLE = {
  success: { border: 'var(--sg)', icon: '✓' },
  error:   { border: 'var(--sr)', icon: '✕' },
  info:    { border: 'var(--sl)', icon: 'ℹ' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(1)

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((kind, message) => {
    const id = nextId.current++
    setToasts((cur) => [...cur, { id, kind, message }])
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
  }, [dismiss])

  const toast = useRef({
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    info: (message) => push('info', message),
  }).current

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8, width: 320, maxWidth: 'calc(100vw - 40px)' }}
      >
        {toasts.map((t) => {
          const s = KIND_STYLE[t.kind] || KIND_STYLE.info
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px',
                background: 'var(--n0)', border: 'var(--bdr)', borderLeft: `3px solid ${s.border}`,
                borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.12)', fontSize: 13, color: 'var(--n900)',
              }}
            >
              <span style={{ color: s.border, fontWeight: 700, flexShrink: 0, lineHeight: '18px' }}>{s.icon}</span>
              <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext).toast
