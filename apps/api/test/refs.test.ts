import { beforeAll, describe, expect, it } from 'vitest'
import { USERS, SITE_A1, SITE_A2 } from './fixtures.js'
import { apiAs, type Api } from './helpers.js'

let owner: Api

beforeAll(async () => {
  owner = await apiAs(USERS.ownerA.email)
})

// DEF/RSK/AUD references were "count this year's rows, add one".
describe('reference numbers', () => {
  it('ten defects raised at once all get distinct references', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      owner.post('/api/defects').send({ title: `Concurrent defect ${i}`, severity: 'minor', site_id: SITE_A1 })
    ))
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201))
    const refs = results.map((r) => r.body.ref as string)
    expect(new Set(refs).size).toBe(10)
    for (const ref of refs) expect(ref).toMatch(/^DEF-\d{4}-\d{4,}$/)
  })

  // The count ran under site-scoped RLS, so a site-scoped user saw fewer
  // audits than exist and drew a number already taken: a 500 every time.
  it('a site-scoped user can create an audit while another site has audits', async () => {
    expect((await owner.post('/api/compliance-audits').send({ title: 'Audit at A2', audit_date: '2026-02-01', site_id: SITE_A2 })).status).toBe(201)
    const hse = await apiAs(USERS.hseOfficerA1.email) // scoped to SITE_A1
    const res = await hse.post('/api/compliance-audits').send({ title: 'Audit at A1', audit_date: '2026-02-02', site_id: SITE_A1 })
    expect(res.status).toBe(201)
    expect(res.body.ref).toMatch(/^AUD-\d{4}-\d{4,}$/)
  })
})
