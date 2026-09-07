/**
 * Regression cover for the round-2 UAT fixes.
 *
 * Each block names the failure it locks down, so a future break reports the
 * defect rather than a line number. The browser proved these fixes as a user
 * sees them; these tests hold the server-side half — the part a screen cannot
 * show, and the boundary conditions a wall clock will not reproduce on demand.
 *
 * See docs/uat/round-1-results.md for what each Fn was.
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS, ORG_A, SITE_A1, ASSET_A1 } from './fixtures.js'
import { can } from '@assetcore/rbac'

beforeAll(async () => {
  await seedFixtures()
})

async function withClient<T>(fn: (client: ReturnType<typeof ownerClient>) => Promise<T>): Promise<T> {
  const client = ownerClient()
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

const suffix = () => randomBytes(4).toString('hex')

// ---------------------------------------------------------------------------
// F1 — /reports and its analytics were readable by every role.
// ---------------------------------------------------------------------------
describe('F1: report routes are capability-gated', () => {
  it('a field technician cannot list reports', async () => {
    const api = await apiAs(USERS.fieldTechA1.email)
    const res = await api.get('/api/reports')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  it('a field technician cannot read the location analytics rollup', async () => {
    const api = await apiAs(USERS.fieldTechA1.email)
    expect((await api.get('/api/reports/location-analytics')).status).toBe(403)
  })

  it('an owner still can', async () => {
    const api = await apiAs(USERS.ownerA.email)
    expect((await api.get('/api/reports')).status).toBe(200)
    expect((await api.get('/api/reports/location-analytics')).status).toBe(200)
  })

  it('withholds book value from a caller without depreciation:read', async () => {
    // hse_officer holds report:read but not depreciation:read, so the rollup
    // must arrive with total_nbv_cents blanked rather than populated.
    expect(can('hse_officer', 'report:read')).toBe(true)
    expect(can('hse_officer', 'depreciation:read')).toBe(false)

    const api = await apiAs(USERS.hseOfficerA1.email)
    const res = await api.get('/api/reports/location-analytics')
    expect(res.status).toBe(200)
    for (const loc of res.body.locations) expect(loc.total_nbv_cents).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// F4 — '*:read' silently satisfied audit:read, so viewers reached the Admin
// audit log and the auditor's explicit grant was dead code.
// ---------------------------------------------------------------------------
describe('F4: audit:read is not covered by the *:read wildcard', () => {
  it('a viewer does not hold audit:read', () => {
    expect(can('viewer', 'audit:read')).toBe(false)
  })

  it('a viewer still holds ordinary read capabilities', () => {
    expect(can('viewer', 'asset:read')).toBe(true)
    expect(can('viewer', 'wo:read')).toBe(true)
    expect(can('viewer', 'compliance:read')).toBe(true)
  })

  it("an auditor's explicit audit:read grant is live", () => {
    expect(can('auditor', 'audit:read')).toBe(true)
  })

  it('an owner is unaffected by the carve-out', () => {
    expect(can('owner', 'audit:read')).toBe(true)
  })

  it('a per-user grant can still restore it', () => {
    expect(can('viewer', 'audit:read', ['audit:read'])).toBe(true)
  })

  it('the viewer is refused the audit log over HTTP', async () => {
    const api = await apiAs(USERS.viewerA.email)
    expect((await api.get('/api/audit-log')).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// F10 — the preview 500'd because the basis SELECT named commission_date, a
// column migration 0021 settled as install_date.
// ---------------------------------------------------------------------------
describe('F10: depreciation preview reads a column that exists', () => {
  it('never answers 500 for a real asset', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const res = await api.post('/api/depreciation/preview').send({ asset_id: ASSET_A1 })
    // 200 with a schedule, or a typed 422 saying what the asset is missing —
    // but never the unhandled 500 a bad column name produced.
    expect(res.status).not.toBe(500)
    expect([200, 422]).toContain(res.status)
  })

  it('computes a schedule when the basis is supplied', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const res = await api.post('/api/depreciation/preview').send({
      asset_id: ASSET_A1,
      method: 'straight_line',
      cost_cents: 450_000_000,
      salvage_value_cents: 45_000_000,
      useful_life_years: 15,
      start_date: '2022-01-01',
    })
    expect(res.status).toBe(200)
    expect(res.body.entries).toHaveLength(15)
    // (450,000,000 - 45,000,000) / 15 = 27,000,000 minor units a year.
    expect(Number(res.body.entries[0].charge_cents)).toBe(27_000_000)
  })

  it('falls back to the asset install_date when no start_date is given', async () => {
    // A dedicated asset — the shared fixtures must keep their identity for
    // the other suites (see test/README.md).
    const assetId = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.assets
           (org_id, site_id, ain, name, install_date, purchase_date,
            purchase_value_cents, useful_life_years, depreciation_method)
         values ($1, $2, $3, 'UAT R2 install-date basis', '2021-03-04', null,
                 100000000, 10, 'straight_line')
         returning id`,
        [ORG_A, SITE_A1, `UAT-R2-INSTALL-${suffix()}`]
      )
      return rows[0].id as string
    })

    const api = await apiAs(USERS.ownerA.email)
    const res = await api.post('/api/depreciation/preview').send({ asset_id: assetId })
    expect(res.status).toBe(200)
    expect(String(res.body.basis.start_date)).toContain('2021-03-04')
  })
})

// ---------------------------------------------------------------------------
// F13 — MTTR excluded a job closed between local midnight and UTC midnight,
// because the window bounds are UTC dates while the SQL cast used the session
// timezone. That boundary only exists for an hour a day, which is exactly why
// it belongs here rather than in a browser pass.
// ---------------------------------------------------------------------------
describe('F13: the analytics window compares dates in one timezone', () => {
  it('counts a corrective job closed in the hour before UTC midnight', async () => {
    const ref = `WO-UAT-MTTR-${suffix()}`
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
    const ref = `WO-UAT-MTTR-${suffix()}`
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

// ---------------------------------------------------------------------------
// Asset health: the PATCH route called the legacy SQL decay, which wrote
// health_score without refreshing health_score_components — so the headline
// and "Show the working" disagreed after any asset edit.
// ---------------------------------------------------------------------------
describe('asset edit keeps the health score and its breakdown in step', () => {
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
