import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS, ORG_A, SITE_A1, SITE_A2, ASSET_A1, ASSET_A2, ASSET_B1 } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

describe('tenant isolation', () => {
  it('org A cannot read org B assets by id', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const res = await api.get(`/api/assets/${ASSET_B1}`)
    expect(res.status).toBe(404)
  })

  it('org A asset list never includes an org B asset', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const res = await api.get('/api/assets')
    expect(res.status).toBe(200)
    const ids = res.body.map((a: { id: string }) => a.id)
    expect(ids).not.toContain(ASSET_B1)
    expect(ids).toContain(ASSET_A1)
  })
})

describe('site scoping', () => {
  it('a tech scoped to one site only sees that site\'s assets from GET /assets', async () => {
    const api = await apiAs(USERS.fieldTechA1.email)
    const res = await api.get('/api/assets')
    expect(res.status).toBe(200)
    const ids = res.body.map((a: { id: string }) => a.id)
    expect(ids).toContain(ASSET_A1)
    expect(ids).not.toContain(ASSET_A2)
  })

  it('an unscoped owner in the same org sees both sites\' assets', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const res = await api.get('/api/assets')
    const ids = res.body.map((a: { id: string }) => a.id)
    expect(ids).toContain(ASSET_A1)
    expect(ids).toContain(ASSET_A2)
  })
})

describe('TASK-1.1: org:manage gate on sites/locations/categories', () => {
  it('viewer cannot create a site', async () => {
    const api = await apiAs(USERS.viewerA.email)
    const res = await api.post('/api/sites').send({ name: 'Should Not Be Created' })
    expect(res.status).toBe(403)
  })

  it('ops_manager (granted org:manage) can create a site', async () => {
    const api = await apiAs(USERS.opsManagerA.email)
    const res = await api.post('/api/sites').send({ name: 'Created By Ops Manager Test' })
    expect(res.status).toBe(201)
  })
})

describe('TASK-1.2: compliance_audits RLS enforces site scope on write', () => {
  it('a site-scoped HSE officer cannot create an audit for a site outside their scope', async () => {
    const api = await apiAs(USERS.hseOfficerA1.email) // scoped to SITE_A1 only
    const title = 'TEST out-of-scope audit (should fail)'
    const res = await api.post('/api/compliance-audits').send({
      title, audit_date: '2026-01-01', site_id: SITE_A2,
    })
    expect(res.status).toBeGreaterThanOrEqual(400)

    const client = ownerClient()
    await client.connect()
    try {
      const { rows } = await client.query('select 1 from public.compliance_audits where title = $1', [title])
      expect(rows.length).toBe(0)
    } finally {
      await client.end()
    }
  })

  it('the same HSE officer CAN create an audit for their own scoped site', async () => {
    const api = await apiAs(USERS.hseOfficerA1.email)
    const res = await api.post('/api/compliance-audits').send({
      title: 'TEST in-scope audit', audit_date: '2026-01-01', site_id: SITE_A1,
    })
    expect(res.status).toBe(201)
  })

  it('an unscoped owner can still create an org-wide audit with site_id null', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const res = await api.post('/api/compliance-audits').send({
      title: 'TEST org-wide audit', audit_date: '2026-01-01', site_id: null,
    })
    expect(res.status).toBe(201)
  })
})

describe('TASK-2.6: revocation takes effect on the very next request, not at token expiry', () => {
  it('downgrading a role mid-session denies a gated write on the next request with the SAME (stale) token', async () => {
    const api = await apiAs(USERS.revocable.email) // logged in while still 'owner'

    // Sanity: still owner, so org:manage-gated action succeeds right now.
    const before = await api.post('/api/sites').send({ name: 'Pre-Revocation Site' })
    expect(before.status).toBe(201)

    // Downgrade the membership directly in the DB — no new token is issued,
    // so the JWT this test keeps using still encodes role_key: 'owner'.
    const client = ownerClient()
    await client.connect()
    try {
      await client.query(`update public.memberships set role_key = 'viewer' where org_id = $1 and user_id = $2`, [ORG_A, USERS.revocable.id])
    } finally {
      await client.end()
    }

    // Same token, same process — if the API trusted the JWT's baked-in role
    // this would still succeed. It must not: the live membership is now
    // 'viewer', which lacks org:manage.
    const after = await api.post('/api/sites').send({ name: 'Post-Revocation Site (should fail)' })
    expect(after.status).toBe(403)
  })
})
