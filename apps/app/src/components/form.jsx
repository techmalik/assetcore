import { Children, cloneElement, isValidElement, useCallback, useId, useState } from 'react'

/**
 * A labelled form field. The label uses .label (12px, weight 500), and when
 * the field holds a single input, select or textarea the label is tied to it,
 * so clicking the label focuses the input and a screen reader names it.
 *
 * Declare fields with this, not with a component defined inside another
 * component's body: a component declared there is a new type on every render,
 * so React rebuilds its input on each keystroke and the cursor drops out.
 */
export function Field({ label, required, hint, span, style, children }) {
  const id = useId()
  const only = Children.count(children) === 1 && isValidElement(children) && typeof children.type === 'string' ? children : null
  const inputId = only ? (only.props.id ?? id) : undefined
  return (
    <div style={span ? { gridColumn: `span ${span}`, ...style } : style}>
      <label className="label" htmlFor={inputId}>{label}{required && ' *'}</label>
      {only ? cloneElement(only, { id: inputId }) : children}
      {hint && <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 5 }}>{hint}</p>}
    </div>
  )
}

/** The message under a form when a save fails. Renders nothing without one. */
export function FormError({ children, style }) {
  if (!children) return null
  return <p role="alert" style={{ fontSize: 12, color: 'var(--srt)', ...style }}>{children}</p>
}

/** Form state with a one-field setter: `set('title', value)`. */
export function useForm(initial) {
  const [form, setForm] = useState(initial)
  const set = useCallback((key, value) => setForm((f) => ({ ...f, [key]: value })), [])
  return { form, set, setForm }
}
