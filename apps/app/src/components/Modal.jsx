import { useEffect, useId, useRef } from 'react'

// Which modal is on top, so Escape closes only that one when two are open.
const stack = []

/**
 * The one modal frame: backdrop, card, header with a close button, scrolling
 * body, optional footer.
 *
 *   <Modal title="Raise a defect" width={580} as="form" onSubmit={submit} onClose={onClose}
 *          footer={<><button type="button" ...>Cancel</button><button type="submit" ...>Save</button></>}>
 *     ...fields...
 *   </Modal>
 *
 * Every page used to draw its own: 33 modals with their own backdrop, z-index,
 * width and footer, none of which closed on Escape, and eight with a fixed
 * width that only fitted a phone by accident. This one closes on Escape and on
 * a backdrop click, caps its width at 92vw, moves focus into the card when it
 * opens and back to where it was when it closes. `nested` lifts it above
 * another open modal.
 */
export default function Modal({ title, width = 520, onClose, as: As = 'div', onSubmit, footer, nested = false, bodyStyle, children }) {
  const cardRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const titleId = useId()

  useEffect(() => {
    const token = {}
    stack.push(token)
    const previous = document.activeElement
    const first = cardRef.current?.querySelector('input:not([type=hidden]), select, textarea')
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === token) {
        e.stopPropagation()
        onCloseRef.current?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(token), 1)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [])

  return (
    <div className={`modal-overlay${nested ? ' is-nested' : ''}`}>
      <div className="modal-backdrop" onClick={() => onCloseRef.current?.()} />
      <As
        ref={cardRef}
        className="modal-card"
        style={{ '--modal-w': `${width}px` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onSubmit={onSubmit}
      >
        {title != null && (
          <div className="modal-head">
            <h3 id={titleId} className="modal-title">{title}</h3>
            <button type="button" className="modal-close" aria-label="Close" onClick={() => onCloseRef.current?.()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
        <div className="modal-body" style={bodyStyle}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </As>
    </div>
  )
}
