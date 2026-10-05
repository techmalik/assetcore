/**
 * Regression cover for the round-3 UAT fixes.
 *
 * The browser proved each of these as a user sees it; these hold the
 * server-side half. See docs/uat/round-3-results.md for what each card was.
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, USERS } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

const suffix = () => randomBytes(4).toString('hex')

async function makeRule(api: Awaited<ReturnType<typeof apiAs>>, min: number, max: number | null) {
  const res = await api.post('/api/approval-rules').send({
    name: `UAT R3 band ${suffix()}`,
    entity_type: 'work_order',
    kind: 'wo_cost',
    min_amount_cents: min,
    max_amount_cents: max,
    levels: [{ role_key: 'manager', label: null }],
  })
  expect(res.status).toBe(201)
  return res.body.id as string
}

// ---------------------------------------------------------------------------
// Card 09 — editing a rule into an impossible band answered 500, because only
// the create path validated it and the DB check constraint raised instead.
// ---------------------------------------------------------------------------
describe('approval rule bands are validated on update, not just on create', () => {
  it('refuses a ceiling at or below the floor with 422 invalid_band', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const id = await makeRule(api, 100_000, 5_000_000)

    const res = await api.patch(`/api/approval-rules/${id}`)
      .send({ min_amount_cents: 9_000_000, max_amount_cents: 500_000 })

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('invalid_band')
  })

  it('refuses a floor raised above the STORED ceiling, with only the floor in the patch', async () => {
    // The half a naive check misses: the patch on its own looks fine, and it
    // is the rule's existing ceiling that makes it invalid.
    const api = await apiAs(USERS.ownerA.email)
    const id = await makeRule(api, 100_000, 5_000_000)

    const res = await api.patch(`/api/approval-rules/${id}`).send({ min_amount_cents: 9_000_000 })

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('invalid_band')
  })

  it('still accepts a valid edit, and the new band reads back', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const id = await makeRule(api, 100_000, 5_000_000)

    const res = await api.patch(`/api/approval-rules/${id}`).send({ max_amount_cents: 7_500_000 })

    expect(res.status).toBe(200)
    expect(Number(res.body.max_amount_cents)).toBe(7_500_000)
  })

  it('accepts clearing the ceiling entirely — null means no upper bound', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const id = await makeRule(api, 100_000, 5_000_000)

    const res = await api.patch(`/api/approval-rules/${id}`).send({ max_amount_cents: null })

    expect(res.status).toBe(200)
    expect(res.body.max_amount_cents).toBeNull()
  })

  it('leaves an unrelated patch alone — renaming does not re-run the band check', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const id = await makeRule(api, 100_000, 5_000_000)

    const res = await api.patch(`/api/approval-rules/${id}`).send({ name: `renamed ${suffix()}` })

    expect(res.status).toBe(200)
  })
})

