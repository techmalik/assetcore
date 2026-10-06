import { afterAll, describe, expect, it } from 'vitest'
import { USERS, ORG_A, SITE_A1, ASSET_A1 } from './fixtures.js'
import { apiAs, uniqueSuffix, withClient } from './helpers.js'

/** An asset with a known purchase value and in-service age, created straight
 * through the owner pool so the test controls every depreciation input. */
async function createAsset(opts: {
  purchaseValueCents?: number | null
  yearsInService?: number | null
  method?: string | null
  usefulLifeYears?: number | null
  salvageValueCents?: number | null
  decliningRatePct?: number | null
} = {}): Promise<string> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `insert into public.assets (
         org_id, site_id, ain, name, status, purchase_value_cents, install_date,
         depreciation_method, useful_life_years, salvage_value_cents, declining_rate_pct
       )
       values ($1, $2, $3, 'Depreciation Test Asset', 'operational', $4,
               -- Calendar years, not N*365: leap days would otherwise land the
               -- asset a month short of the anniversary and skew every expectation.
               case when $5::int is null then null else (current_date - make_interval(years => $5::int))::date end,
               $6, $7, $8, $9)
       returning id`,
      [ORG_A, SITE_A1, `DEP-TEST-${uniqueSuffix()}`,
        opts.purchaseValueCents === undefined ? 10_000_000 : opts.purchaseValueCents,
        opts.yearsInService === undefined ? 5 : opts.yearsInService,
        opts.method ?? null, opts.usefulLifeYears ?? null,
        opts.salvageValueCents ?? null, opts.decliningRatePct ?? null]
    )
    return rows[0].id as string
  })
}

async function recompute(assetId: string): Promise<{ nbv: number | null; accumulated: number | null }> {
  return withClient(async (c) => {
    await c.query('select public.recompute_asset_depreciation_for($1)', [assetId])
    const { rows } = await c.query(
      'select nbv_cents, accumulated_depreciation_cents from public.assets where id = $1',
      [assetId]
    )
    return {
      nbv: rows[0].nbv_cents === null ? null : Number(rows[0].nbv_cents),
      accumulated: rows[0].accumulated_depreciation_cents === null ? null : Number(rows[0].accumulated_depreciation_cents),
    }
  })
}

/** Org-wide policy, restored to the org's original settings after each block. */
async function setOrgDepreciation(policy: Record<string, unknown> | null): Promise<void> {
  await withClient(async (c) => {
    await c.query(
      `update public.organizations
       set settings = case when $2::jsonb is null then settings - 'depreciation'
                           else jsonb_set(coalesce(settings, '{}'::jsonb), '{depreciation}', $2::jsonb) end
       where id = $1`,
      [ORG_A, policy === null ? null : JSON.stringify(policy)]
    )
  })
}

afterAll(async () => {
  await setOrgDepreciation(null)
})

describe('straight-line', () => {
  it('is half written down at half of useful life', async () => {
    await setOrgDepreciation({ method: 'straight_line', usefulLifeYears: 10, salvageRatePct: 0 })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 5 })
    const { nbv, accumulated } = await recompute(id)
    expect(nbv).toBe(5_000_000)
    expect(accumulated).toBe(5_000_000)
  })

  it('stops at the salvage value instead of running negative', async () => {
    // 20 years into a 10-year life: without clamping this would be -100%.
    await setOrgDepreciation({ method: 'straight_line', usefulLifeYears: 10, salvageRatePct: 10 })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 20 })
    const { nbv, accumulated } = await recompute(id)
    expect(nbv).toBe(1_000_000)
    expect(accumulated).toBe(9_000_000)
  })
})

describe('declining balance', () => {
  it('compounds the rate over the years in service', async () => {
    // 10,000,000 * 0.8^5 = 3,276,800
    await setOrgDepreciation({ method: 'declining_balance', decliningRatePct: 20, salvageRatePct: 0 })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 5 })
    const { nbv, accumulated } = await recompute(id)
    expect(nbv).toBe(3_276_800)
    expect(accumulated).toBe(6_723_200)
  })

  it('never falls below the salvage floor', async () => {
    await setOrgDepreciation({ method: 'declining_balance', decliningRatePct: 40, salvageRatePct: 25 })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 30 })
    const { nbv } = await recompute(id)
    expect(nbv).toBe(2_500_000)
  })
})

// The single most important behaviour here: an asset we can't value must read
// as "unknown", never as "worth nothing". Null renders as "—"; zero renders as
// a fully written-down asset, which is a claim the data doesn't support.
describe('missing inputs produce null, not zero', () => {
  it('an asset with no purchase value has a null book value', async () => {
    await setOrgDepreciation({ method: 'straight_line', usefulLifeYears: 10 })
    const id = await createAsset({ purchaseValueCents: null, yearsInService: 5 })
    const { nbv, accumulated } = await recompute(id)
    expect(nbv).toBeNull()
    expect(accumulated).toBeNull()
  })

  it('an asset with no install or purchase date has a null book value', async () => {
    await setOrgDepreciation({ method: 'straight_line', usefulLifeYears: 10 })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: null })
    const { nbv } = await recompute(id)
    expect(nbv).toBeNull()
  })

  it("method 'none' means no book value at all", async () => {
    await setOrgDepreciation({ method: 'none' })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 5 })
    const { nbv } = await recompute(id)
    expect(nbv).toBeNull()
  })
})

describe('per-asset overrides beat the org policy', () => {
  it('uses the asset\'s own method, life and salvage', async () => {
    await setOrgDepreciation({ method: 'declining_balance', decliningRatePct: 20, salvageRatePct: 0 })
    const id = await createAsset({
      purchaseValueCents: 10_000_000, yearsInService: 5,
      method: 'straight_line', usefulLifeYears: 20, salvageValueCents: 0,
    })
    // 5 of 20 years straight-line => 75% remaining, not the org's 0.8^5.
    const { nbv } = await recompute(id)
    expect(nbv).toBe(7_500_000)
  })
})

describe('API surface', () => {
  it('rejects a client attempt to set the derived book value', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 5 })
    const res = await api.patch(`/api/assets/${id}`).send({ nbv_cents: 999 })
    expect(res.status).toBe(400)
  })

  it('recomputes on write, without waiting for the nightly job', async () => {
    await setOrgDepreciation({ method: 'straight_line', usefulLifeYears: 10, salvageRatePct: 0 })
    const api = await apiAs(USERS.ownerA.email)
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 5 })
    await recompute(id)

    const res = await api.patch(`/api/assets/${id}`).send({ purchase_value_cents: 20_000_000 })
    expect(res.status).toBe(200)
    expect(Number(res.body.nbv_cents)).toBe(10_000_000)
  })

  it('changing the org policy recomputes the whole register immediately', async () => {
    await setOrgDepreciation({ method: 'straight_line', usefulLifeYears: 10, salvageRatePct: 0 })
    const id = await createAsset({ purchaseValueCents: 10_000_000, yearsInService: 5 })
    await recompute(id)
    expect((await recompute(id)).nbv).toBe(5_000_000)

    const api = await apiAs(USERS.ownerA.email)
    const org = await api.get('/api/org')
    const res = await api.patch('/api/org/settings').send({
      settings: {
        ...org.body.settings,
        depreciation: { method: 'declining_balance', decliningRatePct: 20, salvageRatePct: 0 },
      },
    })
    expect(res.status).toBe(200)

    // No recompute_asset_depreciation_for() call here — the settings write did it.
    const after = await withClient(async (c) => {
      const { rows } = await c.query('select nbv_cents from public.assets where id = $1', [id])
      return Number(rows[0].nbv_cents)
    })
    expect(after).toBe(3_276_800)
  })
})

// ---------------------------------------------------------------------------
// F10 — the preview 500'd because the basis SELECT named commission_date, a
// column migration 0021 settled as install_date.
// ---------------------------------------------------------------------------
describe('UAT round 2, F10: depreciation preview reads a column that exists', () => {
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
        [ORG_A, SITE_A1, `UAT-R2-INSTALL-${uniqueSuffix()}`]
      )
      return rows[0].id as string
    })

    const api = await apiAs(USERS.ownerA.email)
    const res = await api.post('/api/depreciation/preview').send({ asset_id: assetId })
    expect(res.status).toBe(200)
    expect(String(res.body.basis.start_date)).toContain('2021-03-04')
  })
})
