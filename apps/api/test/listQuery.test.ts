import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, USERS } from './fixtures.js'

let owner: Awaited<ReturnType<typeof apiAs>>

beforeAll(async () => {
  await seedFixtures()
  owner = await apiAs(USERS.ownerA.email)
})

// These lists took any limit: a negative one reached SQL (500) and a huge one
// returned the whole table.
describe.each(['/api/notifications', '/api/pm-tasks', '/api/inspections'])('%s query string', (path) => {
  it('refuses a negative or oversized limit with 400 and names the field', async () => {
    for (const limit of ['-1', '100000', 'abc']) {
      const res = await owner.get(`${path}?limit=${limit}`)
      expect(res.status).toBe(400)
      expect(res.body.fields).toHaveProperty('limit')
    }
  })

  it('still answers a normal request', async () => {
    const res = await owner.get(`${path}?limit=20`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeLessThanOrEqual(20)
  })
})

describe('pm-tasks filters', () => {
  it('refuses a malformed date instead of passing it to SQL', async () => {
    const res = await owner.get('/api/pm-tasks?dueBefore=tomorrow')
    expect(res.status).toBe(400)
    expect(res.body.fields).toHaveProperty('dueBefore')
  })
})
