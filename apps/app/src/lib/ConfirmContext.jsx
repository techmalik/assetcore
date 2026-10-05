import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal.jsx'

const ConfirmContext = createContext(null)

/**
 * In-app confirmation: `const confirm = useConfirm(); if (!(await confirm('Archive this asset?'))) return`.
 *
 * Replaces window.confirm(), which cannot be styled, ignores dark mode and
 * reads poorly on a phone. Options: { title, confirmLabel, danger }.
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback((message, { title = 'Are you sure?', confirmLabel = 'Continue', danger = false } = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve
      setRequest({ message, title, confirmLabel, danger })
    })
  }, [])

  const answer = useCallback((ok) => {
    resolver.current?.(ok)
    resolver.current = null
    setRequest(null)
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request && (
        <Modal
          title={request.title}
          width={420}
          nested
          onClose={() => answer(false)}
          footer={(
            <>
              <button type="button" className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }} onClick={() => answer(false)}>Cancel</button>
              <button type="button" autoFocus className={`btn ${request.danger ? 'btn-danger-soft' : 'btn-primary'}`} style={{ height: 36, padding: '0 18px', fontSize: 13 }} onClick={() => answer(true)}>
                {request.confirmLabel}
              </button>
            </>
          )}
        >
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--n700)' }}>{request.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
