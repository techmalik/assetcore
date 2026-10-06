import { expect } from 'vitest'
import { uniqueSuffix, type Api } from './helpers.js'

// Records created through the API, as a user would, for tests that need a
// fresh one rather than a shared fixture.

/** A new site in the caller's org. Resolves with its id. */
export async function makeSite(api: Api, name = 'Test site') {
  const tag = uniqueSuffix()
  const res = await api.post('/api/sites').send({ name: `${name} ${tag}`, code: `SD-${tag}` })
  expect(res.status).toBe(201)
  return res.body.id as string
}

/** A new asset at `siteId`, with maintenance dates so it has a health score. */
export async function makeAsset(api: Api, siteId: string, status = 'operational') {
  const tag = uniqueSuffix()
  const res = await api.post('/api/assets').send({
    ain: `SD-${tag}`, name: `Test asset ${tag}`, site_id: siteId, status,
    last_maintenance_at: '2026-01-01', next_maintenance_at: '2027-01-01',
  })
  expect(res.status).toBe(201)
  return res.body
}
