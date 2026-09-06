import { describe, it, expect } from 'vitest'
import { computeHealth, HEALTH_WEIGHTS, type HealthSignals } from './health.js'

/**
 * The claim this module makes, and the one worth defending, is that a signal
 * with no evidence behind it is left out rather than scored zero — because
 * "never inspected" is not the same as "in poor condition", and a score that
 * conflates them is the unexplained number Phase 3 set out to replace.
 *
 * Most of these tests are about that distinction, and about the breakdown
 * saying which input it actually used.
 */

const signals = (over: Partial<HealthSignals> = {}): HealthSignals => ({
  condition_rating: null,
  condition_rated_on: null,
  open_defects: {},
  overdue_pm: 0,
  overdue_work_orders: 0,
  criticality: 'medium',
  worst_risk_score: null,
  worst_risk_ref: null,
  in_service_date: null,
  useful_life_years: null,
  as_of: '2026-09-06',
  ...over,
})

const component = (result: ReturnType<typeof computeHealth>, key: string) =>
  result.components.find((c) => c.key === key)!

describe('computeHealth', () => {
  it('weights sum to 100, so a fully-evidenced asset is scored out of the whole', () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  describe('missing evidence', () => {
    it('leaves an unscored signal out rather than counting it as zero', () => {
      const result = computeHealth(signals())
      const inspection = component(result, 'inspection')
      expect(inspection.score).toBeNull()
      expect(inspection.points).toBeNull()
      // 25 for inspection and 15 for age are both unavailable here.
      expect(result.weight_applied).toBe(60)
    })

    it('scores out of the weight that was available, not out of 100', () => {
      // Defects 100 x 25 + maintenance 100 x 20 + risk 80 x 15 = 57 points of
      // the 60 available, which renormalises to 95. Counting the two missing
      // signals as zero would report 57 — the same asset, told it is failing.
      const result = computeHealth(signals())
      expect(result.score).toBe(95)
    })

    it('is null overall only when no signal has anything to read', () => {
      // Defects and maintenance always have evidence — zero is a real answer —
      // so this can only happen if criticality is missing too, and even then
      // those two still carry it.
      const result = computeHealth(signals({ criticality: null }))
      expect(result.weight_applied).toBe(45)
      expect(result.score).not.toBeNull()
    })
  })

  describe('inspection condition', () => {
    it.each([[1, 0], [2, 25], [3, 50], [4, 75], [5, 100]])(
      'maps a rating of %i onto %i, using the full range',
      (rating, expected) => {
        expect(component(computeHealth(signals({ condition_rating: rating })), 'inspection').score).toBe(expected)
      }
    )

    it('names the date it was rated, so the score can be aged by eye', () => {
      const c = component(computeHealth(signals({ condition_rating: 3, condition_rated_on: '2026-03-12' })), 'inspection')
      expect(c.detail).toContain('3 of 5')
      expect(c.detail).toContain('12 Mar 2026')
    })
  })

  describe('open defects', () => {
    it('treats no open defects as evidence, not as a gap', () => {
      const c = component(computeHealth(signals()), 'defects')
      expect(c.score).toBe(100)
      expect(c.detail).toBe('No open defects.')
    })

    it('weights the penalty by severity', () => {
      expect(component(computeHealth(signals({ open_defects: { minor: 1 } })), 'defects').score).toBe(96)
      expect(component(computeHealth(signals({ open_defects: { critical: 1 } })), 'defects').score).toBe(60)
    })

    it('floors at zero rather than going negative', () => {
      const c = component(computeHealth(signals({ open_defects: { critical: 5 } })), 'defects')
      expect(c.score).toBe(0)
    })

    it('counts them in the explanation', () => {
      const c = component(computeHealth(signals({ open_defects: { major: 2, minor: 1 } })), 'defects')
      expect(c.detail).toContain('3 open defects')
      expect(c.score).toBe(100 - (20 * 2 + 4))
    })
  })

  describe('overdue maintenance', () => {
    it('counts PM tasks and past-SLA jobs alike', () => {
      expect(component(computeHealth(signals({ overdue_pm: 1 })), 'maintenance').score).toBe(80)
      expect(component(computeHealth(signals({ overdue_work_orders: 1 })), 'maintenance').score).toBe(80)
      expect(component(computeHealth(signals({ overdue_pm: 1, overdue_work_orders: 1 })), 'maintenance').score).toBe(60)
    })

    it('says which kind is overdue', () => {
      const c = component(computeHealth(signals({ overdue_pm: 2, overdue_work_orders: 1 })), 'maintenance')
      expect(c.detail).toContain('2 overdue PM tasks')
      expect(c.detail).toContain('1 work order past SLA')
    })
  })

  describe('risk', () => {
    it('prefers a real assessment over the asset-level guess', () => {
      // Criticality says medium (80). The matrix says 20 of 25, which is far
      // worse — and the matrix has weighed likelihood, which criticality has not.
      const c = component(computeHealth(signals({ criticality: 'medium', worst_risk_score: 20, worst_risk_ref: 'RSK-2026-0001' })), 'risk')
      expect(c.score).toBe(21)
      expect(c.detail).toContain('RSK-2026-0001')
      expect(c.detail).toContain('20 of 25')
      expect(c.detail).toContain('extreme')
    })

    it.each([[1, 100], [25, 0]])('maps a matrix score of %i onto %i', (matrix, expected) => {
      expect(component(computeHealth(signals({ worst_risk_score: matrix })), 'risk').score).toBe(expected)
    })

    it('falls back to criticality, and says that is what it did', () => {
      const c = component(computeHealth(signals({ criticality: 'high' })), 'risk')
      expect(c.score).toBe(50)
      // The wording matters: a reader must not take this for an assessment.
      expect(c.detail).toContain('No risk assessment yet')
      expect(c.detail).toContain('high')
    })

    it('has nothing to say when there is neither', () => {
      const c = component(computeHealth(signals({ criticality: null })), 'risk')
      expect(c.score).toBeNull()
      expect(c.points).toBeNull()
    })
  })

  describe('age against useful life', () => {
    const aged = (over: Partial<HealthSignals>) =>
      component(computeHealth(signals({ useful_life_years: 10, ...over })), 'age')

    it('scores a brand new asset at full marks', () => {
      expect(aged({ in_service_date: '2026-09-06' }).score).toBe(100)
    })

    it('scores an asset halfway through its life at about half', () => {
      expect(aged({ in_service_date: '2021-09-06' }).score).toBe(50)
    })

    it('floors at zero once the asset is past its useful life', () => {
      // Twenty years into a ten-year life is not minus one hundred.
      expect(aged({ in_service_date: '2006-09-06' }).score).toBe(0)
    })

    it('needs both a date and a life, and says which is missing', () => {
      expect(aged({ in_service_date: null }).score).toBeNull()
      expect(aged({ in_service_date: null }).detail).toContain('commission or purchase date')

      const noLife = component(computeHealth(signals({ in_service_date: '2020-01-01', useful_life_years: null })), 'age')
      expect(noLife.score).toBeNull()
      expect(noLife.detail).toContain('useful life')
    })
  })

  it('produces the worked example from the Phase 3 verification', () => {
    // The asset as it stood in the browser: rated 2 of 5, one critical defect,
    // nothing overdue, medium criticality, 3.4 of 10 years used.
    const result = computeHealth(signals({
      condition_rating: 2,
      condition_rated_on: '2026-09-05',
      open_defects: { critical: 1 },
      criticality: 'medium',
      in_service_date: '2023-04-01',
      useful_life_years: 10,
    }))
    expect(result.weight_applied).toBe(100)
    // 25*.25 + 60*.25 + 100*.20 + 80*.15 + 66*.15 = 63.15
    expect(result.score).toBe(63)
  })

  it('gives every component a sentence saying where it came from', () => {
    const result = computeHealth(signals())
    for (const c of result.components) {
      expect(c.detail).toBeTruthy()
      expect(c.detail.endsWith('.')).toBe(true)
    }
  })
})
