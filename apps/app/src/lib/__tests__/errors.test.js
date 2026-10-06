import { describe, it, expect } from 'vitest'
import { errorText, ERROR_MESSAGES } from '../errors.js'

describe('errorText', () => {
  it('turns a known code on an Error into its sentence', () => {
    const err = Object.assign(new Error('forbidden'), { code: 'forbidden' })
    expect(errorText(err)).toBe(ERROR_MESSAGES.forbidden)
  })

  it('reads the code from the message when there is no code property', () => {
    expect(errorText(new Error('site_shutdown'))).toBe(ERROR_MESSAGES.site_shutdown)
  })

  it('accepts a bare code string', () => {
    expect(errorText('invalid_credentials')).toBe(ERROR_MESSAGES.invalid_credentials)
  })

  it('never shows an unknown snake_case code; it falls back instead', () => {
    expect(errorText(new Error('some_new_code'), 'Save failed.')).toBe('Save failed.')
  })

  it('shows prose that is already a sentence, such as a network failure', () => {
    expect(errorText(new Error('Failed to fetch'), 'Save failed.')).toBe('Failed to fetch')
  })

  it('falls back for values with no code at all', () => {
    expect(errorText(null, 'Could not load.')).toBe('Could not load.')
    expect(errorText({}, 'Could not load.')).toBe('Could not load.')
  })
})

describe('errorText overrides', () => {
  it('a screen-specific sentence wins over the shared one', () => {
    const err = Object.assign(new Error('forbidden'), { code: 'forbidden' })
    expect(errorText(err, 'Failed.', { forbidden: 'Your role cannot see the parts store.' })).toBe('Your role cannot see the parts store.')
  })

  it('codes without an override still get the shared sentence', () => {
    expect(errorText('site_shutdown', 'Failed.', { forbidden: 'x' })).toBe(ERROR_MESSAGES.site_shutdown)
  })
})

describe('errorText for a close refused for stock', () => {
  it('names each part that fell short', () => {
    const err = Object.assign(new Error('insufficient_stock'), {
      code: 'insufficient_stock',
      shortfalls: [{ part_number: 'GSK-10', name: 'Gasket', needed: 3, in_stock: 1 }],
    })
    expect(errorText(err, 'Failed.')).toBe('Not enough stock to close the job: GSK-10 — need 3, 1 on hand.')
  })

  it('falls back to the shared sentence without a parts list', () => {
    expect(errorText('insufficient_stock', 'Failed.')).toBe(ERROR_MESSAGES.insufficient_stock)
  })
})
