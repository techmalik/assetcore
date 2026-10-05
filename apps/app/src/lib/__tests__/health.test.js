import { describe, it, expect } from 'vitest'
import { healthBand, healthLabel } from '../health.js'

// Bands per product spec: > 50 good, 31-50 attention, <= 30 critical.
describe('healthBand', () => {
  it.each([
    [0, 'critical'], [30, 'critical'],
    [31, 'attention'], [50, 'attention'],
    [51, 'good'], [100, 'good'],
  ])('score %i is %s', (score, band) => {
    expect(healthBand(score)).toBe(band)
  })

  it('treats a missing score as critical, not healthy', () => {
    expect(healthBand(null)).toBe('critical')
  })

  it('labels follow the band', () => {
    expect(healthLabel(75)).toBe('Healthy')
    expect(healthLabel(40)).toBe('Needs attention')
    expect(healthLabel(10)).toBe('Critical condition')
  })
})
