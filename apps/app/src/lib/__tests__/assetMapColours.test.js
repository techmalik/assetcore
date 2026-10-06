// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { MAP_COLOUR_MODES } from '../../components/AssetMap.jsx'
import { healthColor } from '../health.js'

// The map coloured health on its own bands (70 and 40), so an asset at 60
// was green on the map and amber in its panel (OOS-24).
describe('the asset map colours health on the product bands', () => {
  it.each([0, 30, 31, 50, 51, 60, 69, 70, 100])('score %i', (score) => {
    expect(MAP_COLOUR_MODES.health.of({ health_score: score })).toBe(healthColor(score))
  })

  it('greys an asset with no score', () => {
    expect(MAP_COLOUR_MODES.health.of({ health_score: null })).toBe('var(--n300)')
  })
})
