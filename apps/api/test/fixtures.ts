import pg from 'pg'
import argon2 from 'argon2'

// Fixed UUIDs (not gen_random_uuid()) so every test file that imports this
// module refers to the exact same rows — seed() is idempotent (ON CONFLICT
// DO NOTHING/UPDATE), so re-seeding across test files in the same run, or
// across repeated `npm test` invocations against a kept-around test DB, is
// safe and cheap.
export const ORG_A = 'a0000000-0000-0000-0000-00000000000a'
export const ORG_B = 'b0000000-0000-0000-0000-00000000000b'

export const SITE_A1 = 'a0000000-0000-0000-0000-0000000000a1'
export const SITE_A2 = 'a0000000-0000-0000-0000-0000000000a2'
export const SITE_B1 = 'b0000000-0000-0000-0000-0000000000b1'

export const ASSET_A1 = 'a0000000-0000-0000-0000-00000000aa01' // in SITE_A1
export const ASSET_A2 = 'a0000000-0000-0000-0000-00000000aa02' // in SITE_A2
export const ASSET_B1 = 'b0000000-0000-0000-0000-00000000bb01' // in SITE_B1, org B

export const FIXTURE_PASSWORD = 'TestPass123!'

// One user per role in ORG_A (all unscoped, i.e. site_scope null) plus a
// dedicated field_tech scoped to SITE_A1 only, and one owner in ORG_B for
// tenant-isolation checks.
export const USERS = {
  ownerA:        { id: 'a1000000-0000-0000-0000-000000000001', email: 'owner-a@test.assetcore.local', role: 'owner', org: ORG_A, siteScope: null as string[] | null },
  opsManagerA:   { id: 'a1000000-0000-0000-0000-000000000002', email: 'ops-a@test.assetcore.local', role: 'ops_manager', org: ORG_A, siteScope: null as string[] | null },
  viewerA:       { id: 'a1000000-0000-0000-0000-000000000003', email: 'viewer-a@test.assetcore.local', role: 'viewer', org: ORG_A, siteScope: null as string[] | null },
  fieldTechA1:   { id: 'a1000000-0000-0000-0000-000000000004', email: 'tech-a1@test.assetcore.local', role: 'field_tech', org: ORG_A, siteScope: [SITE_A1] as string[] | null },
  // Scoped to SITE_A1 (not unscoped) so TASK-1.2's compliance_audits
  // site-scope write test has a user who both holds compliance:create and
  // is actually restricted to one site.
  hseOfficerA1:  { id: 'a1000000-0000-0000-0000-000000000005', email: 'hse-a1@test.assetcore.local', role: 'hse_officer', org: ORG_A, siteScope: [SITE_A1] as string[] | null },
  ownerB:        { id: 'b1000000-0000-0000-0000-000000000001', email: 'owner-b@test.assetcore.local', role: 'owner', org: ORG_B, siteScope: null as string[] | null },
  // Dedicated to the TASK-2.6 revocation test, which mutates this
  // membership's role mid-test — never reused as a stable fixture elsewhere.
  revocable:     { id: 'a1000000-0000-0000-0000-000000000006', email: 'revocable@test.assetcore.local', role: 'owner', org: ORG_A, siteScope: null as string[] | null },
} as const

let seeded = false

/** Idempotently inserts the fixed fixture set (2 orgs, 3 sites, 2 assets in
 * org A + 1 in org B, one membership per role above) via the owner pool
 * (bypasses RLS — this is setup, not the thing under test). Safe to call
 * from every test file's beforeAll; only does real work once per process. */
export async function seedFixtures(): Promise<void> {
  if (seeded) return
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER })
  await client.connect()
  try {
    await client.query('begin')

    await client.query(
      `insert into public.organizations (id, name, short_name, industry, region, plan, billing_status)
       values ($1, 'Test Org A', 'ORGA', 'Oil & Gas', 'Nigeria', 'licensed', 'licensed'),
              ($2, 'Test Org B', 'ORGB', 'Oil & Gas', 'Nigeria', 'licensed', 'licensed')
       on conflict (id) do nothing`,
      [ORG_A, ORG_B]
    )

    await client.query(
      `insert into public.sites (id, org_id, name, code) values
         ($1, $2, 'Site A1', 'A1'),
         ($3, $2, 'Site A2', 'A2'),
         ($4, $5, 'Site B1', 'B1')
       on conflict (id) do nothing`,
      [SITE_A1, ORG_A, SITE_A2, SITE_B1, ORG_B]
    )

    const passwordHash = await argon2.hash(FIXTURE_PASSWORD)
    for (const u of Object.values(USERS)) {
      await client.query(
        `insert into public.users (id, email, password_hash, full_name, status)
         values ($1, $2, $3, $4, 'active')
         on conflict (id) do nothing`,
        [u.id, u.email, passwordHash, u.email.split('@')[0]]
      )
    }

    for (const u of Object.values(USERS)) {
      await client.query(
        `insert into public.memberships (org_id, user_id, role_key, site_scope, status)
         values ($1, $2, $3, $4::uuid[], 'active')
         on conflict (org_id, user_id) do update set role_key = excluded.role_key, site_scope = excluded.site_scope, status = 'active'`,
        [u.org, u.id, u.role, u.siteScope]
      )
    }

    await client.query(
      `insert into public.assets (id, org_id, site_id, ain, name, status, health_score) values
         ($1, $2, $3, 'A1-AIN-001', 'Asset in Site A1', 'operational', 90),
         ($4, $2, $5, 'A2-AIN-001', 'Asset in Site A2', 'operational', 90),
         ($6, $7, $8, 'B1-AIN-001', 'Asset in Site B1 (org B)', 'operational', 90)
       on conflict (id) do nothing`,
      [ASSET_A1, ORG_A, SITE_A1, ASSET_A2, SITE_A2, ASSET_B1, ORG_B, SITE_B1]
    )

    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    await client.end()
  }
  seeded = true
}

/** Owner-pool client for tests that need to reach around RLS — e.g. to flip
 * a membership's role mid-test (TASK-2.6 revocation) or assert row counts
 * that a scoped API response wouldn't show. Caller must release/end. */
export function ownerClient(): pg.Client {
  return new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER })
}
