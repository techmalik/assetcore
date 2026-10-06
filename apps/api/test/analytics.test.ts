import { describe, expect, it } from 'vitest'
import { USERS, ORG_A, SITE_A1 } from './fixtures.js'
import { apiAs, uniqueSuffix, withClient } from './helpers.js'

// Analytics KPIs: the window and the figures over it.

// ---------------------------------------------------------------------------
// F13 — MTTR excluded a job closed between local midnight and UTC midnight,
// because the window bounds are UTC dates while the SQL cast used the session
// timezone. That boundary only exists for an hour a day, which is exactly why
// it belongs here rather than in a browser pass.
// ---------------------------------------------------------------------------
describe('UAT round 2, F13: the analytics window compares dates in one timezone', () => {
  it('counts a corrective job closed in the hour before UTC midnight', async () => {
    const ref = `WO-UAT-MTTR-${uniqueSuffix()}`
    const id = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.work_orders
           (org_id, site_id, ref, title, type, status, priority, created_by,
            actual_start, actual_end)
         values ($1, $2, $3, 'UAT R2 MTTR boundary', 'corrective', 'closed', 'high', $4,
                 now() - interval '2 hours', now() - interval '1 hour')
         returning id`,
        [ORG_A, SITE_A1, ref, USERS.ownerA.id]
      )
      return rows[0].id as string
    })

    try {
      const api = await apiAs(USERS.ownerA.email)
      const res = await api.get('/api/analytics/kpis')
      expect(res.status).toBe(200)
      expect(res.body.mttr.sample_size).toBeGreaterThan(0)
      expect(res.body.mttr.hours).not.toBeNull()
    } finally {
      await withClient((c) => c.query('delete from public.work_orders where id = $1', [id]))
    }
  })

  it('accepts an explicit window without dropping the same job', async () => {
    const ref = `WO-UAT-MTTR-${uniqueSuffix()}`
    const id = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.work_orders
           (org_id, site_id, ref, title, type, status, priority, created_by,
            actual_start, actual_end)
         values ($1, $2, $3, 'UAT R2 MTTR window', 'corrective', 'closed', 'high', $4,
                 timestamptz '2026-05-10 08:00+00', timestamptz '2026-05-10 12:00+00')
         returning id`,
        [ORG_A, SITE_A1, ref, USERS.ownerA.id]
      )
      return rows[0].id as string
    })

    try {
      const api = await apiAs(USERS.ownerA.email)
      const res = await api.get('/api/analytics/kpis?from=2026-05-01&to=2026-05-31')
      expect(res.status).toBe(200)
      expect(res.body.mttr.sample_size).toBe(1)
      expect(res.body.mttr.hours).toBeCloseTo(4, 1)
    } finally {
      await withClient((c) => c.query('delete from public.work_orders where id = $1', [id]))
    }
  })
})
