import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS, ORG_A, SITE_A1 } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

// Deterministic-enough uniqueness without Date.now()/Math.random() (avoided
// per repo convention for anything that could run inside a replayed
// workflow) — a few random hex bytes per test asset's `ain`.
function uniqueSuffix(): string {
  return randomBytes(4).toString('hex')
}

async function createHealthTestAsset(overrides: { healthScore?: number | null } = {}): Promise<string> {
  const client = ownerClient()
  await client.connect()
  try {
    const { rows } = await client.query(
      `insert into public.assets (org_id, site_id, ain, name, status, health_score)
       values ($1, $2, $3, 'Health Test Asset', 'operational', $4)
       returning id`,
      [ORG_A, SITE_A1, `HEALTH-TEST-${uniqueSuffix()}`, overrides.healthScore ?? 100]
    )
    return rows[0].id
  } finally {
    await client.end()
  }
}

async function withClient<T>(fn: (client: Awaited<ReturnType<typeof ownerClient>>) => Promise<T>): Promise<T> {
  const client = ownerClient()
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

describe('decay math', () => {
  it('recompute_asset_health computes a linear value over a 100-day maintenance window', async () => {
    // 50 days elapsed of a 100-day window (last=-50, next=+50) => 50% left.
    // createHealthTestAsset only binds literal values, so the interval dates
    // are set via a follow-up update using real SQL date arithmetic instead.
    const assetId = await createHealthTestAsset({ healthScore: 100 })
    await withClient(async (c) => {
      await c.query(
        `update public.assets set last_maintenance_at = current_date - 50, next_maintenance_at = current_date + 50 where id = $1`,
        [assetId]
      )
      await c.query('select public.recompute_asset_health($1)', [ORG_A])
      const { rows } = await c.query('select health_score from public.assets where id = $1', [assetId])
      expect(rows[0].health_score).toBe(50)
    })
  })
})

describe('threshold crossing: inspection (configurable, default 50%)', () => {
  it('crossing down through the threshold creates exactly one Auto: inspection', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 60 })
    await withClient(async (c) => {
      await c.query('select public.apply_asset_health($1, 45, null)', [assetId])

      const { rows: inspections } = await c.query(
        `select 1 from public.inspections where asset_id = $1 and title like 'Auto:%'`,
        [assetId]
      )
      expect(inspections.length).toBe(1)

      const { rows: notifs } = await c.query(
        `select 1 from public.notifications where entity_id = $1 and kind = 'inspection_due'`,
        [assetId]
      )
      expect(notifs.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('re-crossing the same threshold before the inspection is resolved does not create a second one', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 60 })
    await withClient(async (c) => {
      await c.query('select public.apply_asset_health($1, 45, null)', [assetId]) // first crossing
      await c.query('update public.assets set health_score = 60 where id = $1', [assetId]) // bump back up, bypassing crossing logic
      await c.query('select public.apply_asset_health($1, 44, null)', [assetId]) // cross again

      const { rows } = await c.query(
        `select count(*)::int as n from public.inspections where asset_id = $1 and title like 'Auto:%'`,
        [assetId]
      )
      expect(rows[0].n).toBe(1)
    })
  })
})

describe('threshold crossing: maintenance / auto work order (configurable, default 30%)', () => {
  it('crossing down through 30% drafts exactly one Auto: work order, in draft status', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 40 })
    await withClient(async (c) => {
      await c.query('select public.apply_asset_health($1, 25, null)', [assetId])

      const { rows } = await c.query(
        `select status from public.work_orders where asset_id = $1 and title like 'Auto:%' and status <> 'closed'`,
        [assetId]
      )
      expect(rows.length).toBe(1)
      // Auto-generated WOs land as a literal draft awaiting approval, not 'new'.
      expect(rows[0].status).toBe('draft')
    })
  })

  it('respects an org-configured maintenanceThreshold instead of the 30 default', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 45 })
    await withClient(async (c) => {
      // jsonb_set can't create the intermediate 'health' object, so merge it in.
      await c.query(
        `update public.organizations
         set settings = coalesce(settings, '{}'::jsonb)
           || jsonb_build_object('health', coalesce(settings->'health', '{}'::jsonb) || '{"maintenanceThreshold": 40}'::jsonb)
         where id = $1`,
        [ORG_A]
      )
      try {
        // 45 -> 38 crosses the configured 40 (but not the default 30) — WO fires.
        await c.query('select public.apply_asset_health($1, 38, null)', [assetId])
        const { rows } = await c.query(
          `select count(*)::int as n from public.work_orders where asset_id = $1 and title like 'Auto:%' and status <> 'closed'`,
          [assetId]
        )
        expect(rows[0].n).toBe(1)
      } finally {
        await c.query(
          `update public.organizations set settings = settings #- '{health,maintenanceThreshold}' where id = $1`,
          [ORG_A]
        )
      }
    })
  })

  it('re-crossing 30% before the auto-WO is resolved does not draft a second one', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 40 })
    await withClient(async (c) => {
      await c.query('select public.apply_asset_health($1, 25, null)', [assetId])
      await c.query('update public.assets set health_score = 40 where id = $1', [assetId])
      await c.query('select public.apply_asset_health($1, 24, null)', [assetId])

      const { rows } = await c.query(
        `select count(*)::int as n from public.work_orders where asset_id = $1 and title like 'Auto:%' and status <> 'closed'`,
        [assetId]
      )
      expect(rows[0].n).toBe(1)
    })
  })
})

describe('manual PATCH crossing fires triggers synchronously (no waiting for the cron)', () => {
  it('PATCHing health_score down through 30% drafts the auto-WO within the same request/response cycle', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 40 })
    const api = await apiAs(USERS.ownerA.email)

    const res = await api.patch(`/api/assets/${assetId}`).send({ health_score: 20 })
    expect(res.status).toBe(200)

    // No delay, no cron wait — assert immediately after the response returns.
    await withClient(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from public.work_orders where asset_id = $1 and title like 'Auto:%' and status <> 'closed'`,
        [assetId]
      )
      expect(rows[0].n).toBe(1)
    })
  })
})

describe('maintenance completion resets health to 100 and restarts decay', () => {
  it('POST /assets/:id/maintenance-completions resets health_score to 100 and sets a forward-looking next_maintenance_at', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 20 })
    const api = await apiAs(USERS.opsManagerA.email) // has maintenance:complete

    const today = new Date().toISOString().slice(0, 10)
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    const res = await api.post(`/api/assets/${assetId}/maintenance-completions`)
      .field('source', 'manual')
      .field('completed_at', today)
      .field('next_maintenance_at', nextWeek)
    expect(res.status).toBe(201)

    await withClient(async (c) => {
      const { rows } = await c.query(
        'select health_score, last_maintenance_at, next_maintenance_at from public.assets where id = $1',
        [assetId]
      )
      expect(rows[0].health_score).toBe(100)
      expect(rows[0].next_maintenance_at > rows[0].last_maintenance_at).toBe(true)

      // Decay has genuinely restarted: recomputing right after completion,
      // with next_maintenance_at a week out, should not have dropped health.
      await c.query('select public.recompute_asset_health($1)', [ORG_A])
      const { rows: after } = await c.query('select health_score from public.assets where id = $1', [assetId])
      expect(after[0].health_score).toBe(100)
    })
  })
})

describe('dead-zone rows are not skipped', () => {
  it('completing a PM task whose schedule is already overdue still leaves next_maintenance_at > last_maintenance_at', async () => {
    const assetId = await createHealthTestAsset({ healthScore: 80 })
    const suffix = uniqueSuffix()

    const scheduleId = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.pm_schedules (org_id, asset_id, title, frequency, next_due)
         values ($1, $2, $3, 'monthly', current_date - 5) returning id`,
        [ORG_A, assetId, `Dead-zone test schedule ${suffix}`]
      )
      return rows[0].id as string
    })

    const taskId = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.pm_tasks (org_id, schedule_id, asset_id, site_id, title, status, due_date)
         values ($1, $2, $3, $4, $5, 'pending', current_date - 3) returning id`,
        [ORG_A, scheduleId, assetId, SITE_A1, `Dead-zone test task ${suffix}`]
      )
      return rows[0].id as string
    })

    const api = await apiAs(USERS.opsManagerA.email)
    const res = await api.patch(`/api/pm-tasks/${taskId}`).send({ status: 'completed' })
    expect(res.status).toBe(200)

    await withClient(async (c) => {
      const { rows } = await c.query(
        'select last_maintenance_at, next_maintenance_at from public.assets where id = $1',
        [assetId]
      )
      // Without the dead-zone fix, next_maintenance_at would inherit the
      // schedule's already-past next_due (current_date - 5), leaving it <=
      // last_maintenance_at (current_date) — permanently excluding the
      // asset from every future recompute_asset_health() run.
      expect(rows[0].next_maintenance_at > rows[0].last_maintenance_at).toBe(true)

      const { rows: eligible } = await c.query(
        `select 1 from public.assets
         where id = $1 and last_maintenance_at is not null and next_maintenance_at is not null
           and next_maintenance_at > last_maintenance_at`,
        [assetId]
      )
      expect(eligible.length).toBe(1)
    })
  })
})
