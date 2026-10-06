import { describe, expect, it } from 'vitest'
import { USERS, ASSET_A1 } from './fixtures.js'
import { apiAs, withClient } from './helpers.js'

// Asset edits and what they recompute.

// ---------------------------------------------------------------------------
// Asset health: the PATCH route called the legacy SQL decay, which wrote
// health_score without refreshing health_score_components — so the headline
// and "Show the working" disagreed after any asset edit.
// ---------------------------------------------------------------------------
describe('UAT round 2, asset edit keeps the health score and its breakdown in step', () => {
  it('refreshes the stored breakdown alongside the score', async () => {
    const api = await apiAs(USERS.ownerA.email)

    const before = await withClient(async (c) => {
      const { rows } = await c.query(
        'select health_score_computed_at from public.assets where id = $1',
        [ASSET_A1]
      )
      return rows[0]?.health_score_computed_at as Date | null
    })

    // The edit form always submits both maintenance dates, which is what put
    // every ordinary save through the legacy decay path.
    const res = await api.patch(`/api/assets/${ASSET_A1}`).send({
      last_maintenance_at: '2026-07-07',
      next_maintenance_at: '2026-10-05',
    })
    expect(res.status).toBe(200)

    const after = await withClient(async (c) => {
      const { rows } = await c.query(
        'select health_score, health_score_computed_at, health_score_components from public.assets where id = $1',
        [ASSET_A1]
      )
      return rows[0]
    })

    // The breakdown was rewritten by this request, not left behind.
    expect(after.health_score_computed_at).not.toBeNull()
    if (before) expect(new Date(after.health_score_computed_at).getTime()).toBeGreaterThan(new Date(before).getTime())
    expect(after.health_score_components?.components).toBeTruthy()

    // And the score reconciles with the breakdown that explains it: each
    // component's points over the weight that actually had evidence.
    const { components, weight_applied: weightApplied } = after.health_score_components
    const points = components.reduce((sum: number, c: { points: number | null }) => sum + (c.points ?? 0), 0)
    if (weightApplied > 0 && after.health_score != null) {
      expect(Math.round((points / weightApplied) * 100)).toBe(after.health_score)
    }
  })
})
