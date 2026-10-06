// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, fireEvent, screen } from '@testing-library/react'
import Modal from '../../components/Modal.jsx'

afterEach(cleanup)

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

describe('an image lightbox over a modal', () => {
  it('Escape closes the lightbox and leaves the modal open', async () => {
    const { default: ImageLightbox } = await import('../../components/ImageLightbox.jsx')
    const modalClose = vi.fn()
    const lightboxClose = vi.fn()
    render(<>
      <Modal title="Edit Asset" onClose={modalClose}><span /></Modal>
      <ImageLightbox images={['org/a.png']} index={0} onClose={lightboxClose} />
    </>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(lightboxClose).toHaveBeenCalledTimes(1)
    expect(modalClose).not.toHaveBeenCalled()
  })
})
