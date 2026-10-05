import request from 'supertest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app.js'
import { ownerPool } from '../src/db.js'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS, ORG_A } from './fixtures.js'

let owner: Awaited<ReturnType<typeof apiAs>>

beforeAll(async () => {
  await seedFixtures()
  owner = await apiAs(USERS.ownerA.email)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const isMembershipQuery = (args: unknown[]) =>
  typeof args[0] === 'string' && args[0].includes('from public.users u') && args[0].includes('public.memberships m')

describe('the tenant gate runs once per request', () => {
  // Every tenant router used to carry its own blanket gate and is mounted with
  // no path prefix, so a request re-ran the gate of every router it passed:
  // about 28 membership queries for a write to the last-mounted router.
  it('a write to a late-mounted router checks membership exactly once', async () => {
    const spy = vi.spyOn(ownerPool, 'query')
    // escalations is mounted near the end; an empty body is refused with a
    // 400, which is after the gate has run.
    const res = await owner.post('/api/escalation-rules').send({})
    expect(res.status).toBe(400)
    const membershipCalls = spy.mock.calls.filter((args) => isMembershipQuery(args as unknown[]))
    expect(membershipCalls.length).toBe(1)
  })

  it('/api/health stays public', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200)
  })

  it('an unknown path answers 404 to a signed-in member', async () => {
    const res = await owner.get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  // Unauthenticated callers get 401 for any non-public /api path, known or
  // not, so the gate does not reveal which routes exist.
  it('an unknown path answers 401 without a token', async () => {
    expect((await request(app).get('/api/does-not-exist')).status).toBe(401)
  })
})

describe('a disabled member', () => {
  // A disabled member's access token stays valid until it expires; the gate
  // reads the membership fresh on every write so the token stops working now.
  it('cannot write with a token issued before they were disabled', async () => {
    const ops = await apiAs(USERS.opsManagerA.email)
    const c = ownerClient()
    await c.connect()
    try {
      await c.query(`update public.memberships set status = 'disabled' where user_id = $1 and org_id = $2`, [USERS.opsManagerA.id, ORG_A])
      const res = await ops.post('/api/escalation-rules').send({})
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('account_disabled')
    } finally {
      await c.query(`update public.memberships set status = 'active' where user_id = $1 and org_id = $2`, [USERS.opsManagerA.id, ORG_A])
      await c.end()
    }
  })
})
