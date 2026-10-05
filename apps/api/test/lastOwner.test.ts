import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, FIXTURE_PASSWORD } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

/** A fresh org with exactly two active owners, so the last-owner rule bites. */
async function orgWithTwoOwners() {
  const orgId = randomUUID()
  const owners = [randomUUID(), randomUUID()]
  const tag = orgId.slice(0, 8)
  const c = ownerClient()
  await c.connect()
  try {
    const hash = await argon2.hash(FIXTURE_PASSWORD)
    await c.query(
      `insert into public.organizations (id, name, short_name, plan, billing_status) values ($1, $2, $3, 'licensed', 'licensed')`,
      [orgId, `Last-owner test ${tag}`, `LO${tag.slice(0, 4)}`]
    )
    const memberships: string[] = []
    for (const [i, id] of owners.entries()) {
      await c.query(
        `insert into public.users (id, email, password_hash, full_name, status) values ($1, $2, $3, $4, 'active')`,
        [id, `owner${i}-${tag}@test.assetcore.local`, hash, `Owner ${i}`]
      )
      const { rows } = await c.query(
        `insert into public.memberships (org_id, user_id, role_key, status) values ($1, $2, 'owner', 'active') returning id`,
        [orgId, id]
      )
      memberships.push(rows[0].id)
    }
    return { orgId, emails: owners.map((_, i) => `owner${i}-${tag}@test.assetcore.local`), memberships }
  } finally {
    await c.end()
  }
}

async function activeOwners(orgId: string): Promise<number> {
  const c = ownerClient()
  await c.connect()
  try {
    const { rows } = await c.query(
      "select count(*)::int as n from public.memberships where org_id = $1 and role_key = 'owner' and status = 'active'",
      [orgId]
    )
    return rows[0].n
  } finally {
    await c.end()
  }
}

describe('an organisation always keeps an owner', () => {
  // The last-owner check used to read outside the transaction with no lock, so
  // two owners demoting each other at the same moment both saw "2 owners" and
  // both succeeded, leaving none.
  it('two owners demoting each other at once: one succeeds, one is refused', async () => {
    for (let round = 0; round < 3; round++) {
      const { orgId, emails, memberships } = await orgWithTwoOwners()
      const [a, b] = await Promise.all(emails.map((e) => apiAs(e)))

      const results = await Promise.all([
        a.patch(`/api/org/members/${memberships[1]}/role`).send({ role_key: 'admin' }),
        b.patch(`/api/org/members/${memberships[0]}/role`).send({ role_key: 'admin' }),
      ])
      // The loser is refused either by the last-owner rule or, if the
      // winner's change landed before its gate ran, because it is no longer
      // an owner itself. Either way exactly one owner is left.
      const won = results.filter((r) => r.status === 200)
      const lost = results.filter((r) => r.status !== 200)
      expect(won.length).toBe(1)
      expect(lost.length).toBe(1)
      expect(['cannot_demote_last_owner', 'owner_only']).toContain(lost[0].body.error)
      expect(await activeOwners(orgId)).toBe(1)
    }
  })
})
