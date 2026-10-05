// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, fireEvent, screen } from '@testing-library/react'
import { Field, FormError, useForm } from '../../components/form.jsx'

afterEach(cleanup)

function TitleForm() {
  const { form, set } = useForm({ title: '' })
  return (
    <Field label="Title" required>
      <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} />
    </Field>
  )
}

describe('Field', () => {
  it('ties the label to its input', () => {
    render(<TitleForm />)
    expect(screen.getByLabelText('Title *').tagName).toBe('INPUT')
  })

  it('keeps the same input, and focus, while typing', () => {
    render(<TitleForm />)
    const input = screen.getByLabelText('Title *')
    input.focus()
    fireEvent.change(input, { target: { value: 'S' } })
    fireEvent.change(input, { target: { value: 'St' } })
    expect(screen.getByLabelText('Title *')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('St')
  })
})

describe('FormError', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<FormError>{''}</FormError>)
    expect(container.innerHTML).toBe('')
  })
})
