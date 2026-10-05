import { describe, it, expect } from 'vitest'
import { fmtMoney, fmtMoneyExact, currencySymbol } from '../money.jsx'

describe('fmtMoney', () => {
  it('formats minor units in naira by default', () => {
    expect(fmtMoney(1_200_000)).toBe('₦12,000')
  })

  it('abbreviates millions and billions', () => {
    expect(fmtMoney(450_000_000)).toBe('₦4.5M')
    expect(fmtMoney(120_000_000_000)).toBe('₦1.2B')
  })

  it('uses the currency it is given', () => {
    expect(fmtMoney(1_200_000, { code: 'USD' })).toBe('$12,000')
  })

  it('puts the sign before the symbol', () => {
    expect(fmtMoney(-450_000_000)).toBe('-₦4.5M')
  })

  it('renders the zero placeholder for a missing value', () => {
    expect(fmtMoney(null)).toBe('₦0')
    expect(fmtMoney(undefined, { zero: 'n/a' })).toBe('n/a')
  })

  it('never shows more than two decimal places', () => {
    expect(fmtMoney(9_754_333.333, { code: 'USD' })).toBe('$97,543.33')
  })
})

describe('fmtMoneyExact', () => {
  it('always shows two decimals, unabbreviated', () => {
    expect(fmtMoneyExact(123_456_789)).toBe('₦1,234,567.89')
    expect(fmtMoneyExact(500, { code: 'GBP' })).toBe('£5.00')
  })
})

describe('currencySymbol', () => {
  it('falls back to the ISO code rather than a wrong symbol', () => {
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('CHF')).toBe('CHF ')
    expect(currencySymbol(null)).toBe('')
  })
})
