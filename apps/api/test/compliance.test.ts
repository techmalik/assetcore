import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

describe('archiving a compliance audit', () => {
  // DELETE /compliance-audits/:id used to be registered twice. Express ran the
  // first copy, which had no `deleted_at is null` guard, so archiving an audit
  // a second time answered 204, moved deleted_at and wrote a second audit row.
  it('archives once; a second archive answers 404 and writes nothing', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const created = await api.post('/api/compliance-audits').send({
      title: `TEST archive-once ${Date.now()}`, audit_date: '2026-01-01', site_id: null,
    })
    expect(created.status).toBe(201)
    const id = created.body.id as string

    expect((await api.delete(`/api/compliance-audits/${id}`)).status).toBe(204)
    expect((await api.delete(`/api/compliance-audits/${id}`)).status).toBe(404)

    const client = ownerClient()
    await client.connect()
    try {
      const { rows } = await client.query(
        `select count(*)::int as n from public.audit_log
         where action = 'compliance_audit.archive' and entity_id = $1`,
        [id]
      )
      expect(rows[0].n).toBe(1)
    } finally {
      await client.end()
    }
  })
})
