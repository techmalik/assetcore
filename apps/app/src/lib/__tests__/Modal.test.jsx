// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import Modal from '../../components/Modal.jsx'

describe('Modal', () => {
  it('closes on Escape, on the backdrop and on its close button', () => {
    const onClose = vi.fn()
    const { container } = render(<Modal title="Raise a defect" onClose={onClose}><input /></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(container.querySelector('.modal-backdrop'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('Escape closes only the modal on top', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(<>
      <Modal title="Outer" onClose={outer}><span /></Modal>
      <Modal title="Inner" nested onClose={inner}><span /></Modal>
    </>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('moves focus to the first field', () => {
    render(<Modal title="Edit" onClose={() => {}}><input aria-label="Title" /></Modal>)
    expect(document.activeElement).toBe(screen.getByLabelText('Title'))
  })
})
