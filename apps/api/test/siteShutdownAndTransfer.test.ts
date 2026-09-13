/**
 * Site shutdown (0027) and asset transfers.
 *
 * Every test builds its own sites and assets rather than touching SITE_A1/A2:
 * shutting a shared fixture site down would make unrelated test files fail in
 * ways that look nothing like this feature.
 */
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, USERS } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

type Api = Awaited<ReturnType<typeof apiAs>>

const suffix = () => randomBytes(4).toString('hex')

async function makeSite(api: Api) {
  const tag = suffix()
  const res = await api.post('/api/sites').send({ name: `Shutdown test ${tag}`, code: `SD-${tag}` })
  expect(res.status).toBe(201)
  return res.body.id as string
}

async function makeAsset(api: Api, siteId: string, status = 'operational') {
  const tag = suffix()
  const res = await api.post('/api/assets').send({
    ain: `SD-${tag}`, name: `Shutdown asset ${tag}`, site_id: siteId, status,
    last_maintenance_at: '2026-01-01', next_maintenance_at: '2027-01-01',
  })
  expect(res.status).toBe(201)
  return res.body
}

describe('shutting a site down', () => {
  it('marks its assets inactive, keeps each prior status, and reopens them to it', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const site = await makeSite(api)
    const running = await makeAsset(api, site, 'operational')
    const standby = await makeAsset(api, site, 'standby')

    const listed = await api.get('/api/sites')
    expect(listed.body.find((s: { id: string }) => s.id === site).asset_count).toBe(2)

    const shut = await api.post(`/api/sites/${site}/shutdown`).send({ reason: 'Field decommissioned' })
    expect(shut.status).toBe(200)
    expect(shut.body.status).toBe('shutdown')
    expect(shut.body.shutdown_reason).toBe('Field decommissioned')
    expect(shut.body.assets_affected).toBe(2)

    for (const a of [running, standby]) {
      const got = await api.get(`/api/assets/${a.id}`)
      expect(got.body.status).toBe('inactive')
    }

    const again = await api.post(`/api/sites/${site}/shutdown`).send({ reason: 'twice' })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('already_shutdown')

    const reopen = await api.post(`/api/sites/${site}/reopen`)
    expect(reopen.status).toBe(200)
    expect(reopen.body.status).toBe('active')
    expect((await api.get(`/api/assets/${running.id}`)).body.status).toBe('operational')
    expect((await api.get(`/api/assets/${standby.id}`)).body.status).toBe('standby')

    const reopenAgain = await api.post(`/api/sites/${site}/reopen`)
    expect(reopenAgain.status).toBe(409)
    expect(reopenAgain.body.error).toBe('not_shutdown')
  })

  it('requires a reason', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const site = await makeSite(api)
    const res = await api.post(`/api/sites/${site}/shutdown`).send({ reason: '   ' })
    expect(res.status).toBe(400)
  })

  it('is refused to a role without org:manage', async () => {
    const owner = await apiAs(USERS.ownerA.email)
    const site = await makeSite(owner)
    const viewer = await apiAs(USERS.viewerA.email)
    const res = await viewer.post(`/api/sites/${site}/shutdown`).send({ reason: 'no' })
    expect(res.status).toBe(403)
  })

  it('writes site.shutdown and site.reopen to the audit log', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const site = await makeSite(api)
    await api.post(`/api/sites/${site}/shutdown`).send({ reason: 'audit check' })
    await api.post(`/api/sites/${site}/reopen`)
    const log = await api.get('/api/audit-log?entity_type=site&limit=200')
    expect(log.status).toBe(200)
    const rows = log.body.rows as Array<{ action: string; entity_id: string }>
    const actions = rows.filter((r) => r.entity_id === site).map((r) => r.action)
    expect(actions).toEqual(expect.arrayContaining(['site.shutdown', 'site.reopen']))
  })
})

describe('no new work at a shut-down site', () => {
  it('refuses work orders, inspections and PM schedules for the site or an asset on it', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const site = await makeSite(api)
    const asset = await makeAsset(api, site)
    await api.post(`/api/sites/${site}/shutdown`).send({ reason: 'no work' })

    const woBySite = await api.post('/api/work-orders').send({ title: 'Should fail', site_id: site })
    expect(woBySite.status).toBe(422)
    expect(woBySite.body.error).toBe('site_shutdown')

    const woByAsset = await api.post('/api/work-orders').send({ title: 'Should fail', asset_id: asset.id })
    expect(woByAsset.status).toBe(422)

    const insp = await api.post('/api/inspections').send({ title: 'Should fail', asset_id: asset.id, scheduled_date: '2026-10-01' })
    expect(insp.status).toBe(422)
    expect(insp.body.error).toBe('site_shutdown')

    const pm = await api.post('/api/pm-schedules').send({ title: 'Should fail', site_id: site, frequency: 'monthly', next_due: '2026-10-01' })
    expect(pm.status).toBe(422)
    expect(pm.body.error).toBe('site_shutdown')
  })

  it('registers a new asset at a shut-down site as inactive, and reopening gives it the status asked for', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const site = await makeSite(api)
    await api.post(`/api/sites/${site}/shutdown`).send({ reason: 'closed' })

    const asset = await makeAsset(api, site, 'standby')
    expect(asset.status).toBe('inactive')

    await api.post(`/api/sites/${site}/reopen`)
    expect((await api.get(`/api/assets/${asset.id}`)).body.status).toBe('standby')
  })

  it('refuses to set a live status on an asset at a shut-down site', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const site = await makeSite(api)
    const asset = await makeAsset(api, site)
    await api.post(`/api/sites/${site}/shutdown`).send({ reason: 'closed' })

    const live = await api.patch(`/api/assets/${asset.id}`).send({ status: 'operational' })
    expect(live.status).toBe(422)
    expect(live.body.error).toBe('site_shutdown')

    // Saving the edit form unchanged still works: it resubmits 'inactive'.
    const unchanged = await api.patch(`/api/assets/${asset.id}`).send({ status: 'inactive', name: `${asset.name} (renamed)` })
    expect(unchanged.status).toBe(200)
  })
})

describe('transferring assets', () => {
  it('moves several assets, skips one already there, and moves their open work with them', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const from = await makeSite(api)
    const to = await makeSite(api)
    const a1 = await makeAsset(api, from)
    const a2 = await makeAsset(api, from)
    const already = await makeAsset(api, to)

    const wo = await api.post('/api/work-orders').send({ title: 'Open job travels', asset_id: a1.id, site_id: from })
    expect(wo.status).toBe(201)

    const res = await api.post('/api/assets/transfer').send({
      asset_ids: [a1.id, a2.id, already.id], to_site_id: to, reason: 'Consolidation', transferred_at: '2026-09-01',
    })
    expect(res.status).toBe(200)
    expect(res.body.transferred).toBe(2)
    expect(res.body.skipped).toEqual([{ asset_id: already.id, reason: 'same_site' }])

    expect((await api.get(`/api/assets/${a1.id}`)).body.site_id).toBe(to)
    const wos = await api.get(`/api/work-orders?asset_id=${a1.id}`)
    expect(wos.body.find((w: { id: string }) => w.id === wo.body.id).site_id).toBe(to)

    const history = await api.get(`/api/assets/${a1.id}/transfers`)
    expect(history.status).toBe(200)
    expect(history.body).toHaveLength(1)
    expect(history.body[0].from_site.id).toBe(from)
    expect(history.body[0].to_site.id).toBe(to)
    expect(history.body[0].reason).toBe('Consolidation')
    expect(String(history.body[0].transferred_at)).toContain('2026-09-01')
    expect(history.body[0].transferred_by_user.id).toBe(USERS.ownerA.id)

    const activity = await api.get(`/api/assets/${a1.id}/activity`)
    expect(activity.body.some((e: { source: string }) => e.source === 'transfer')).toBe(true)
  })

  it('brings an asset back to life when it is moved off a shut-down site', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const closed = await makeSite(api)
    const open = await makeSite(api)
    const asset = await makeAsset(api, closed, 'standby')
    await api.post(`/api/sites/${closed}/shutdown`).send({ reason: 'closed' })
    expect((await api.get(`/api/assets/${asset.id}`)).body.status).toBe('inactive')

    const res = await api.post('/api/assets/transfer').send({ asset_ids: [asset.id], to_site_id: open })
    expect(res.status).toBe(200)
    expect(res.body.transferred).toBe(1)
    expect((await api.get(`/api/assets/${asset.id}`)).body.status).toBe('standby')
  })

  it('refuses a shut-down destination, and a destination that does not exist', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const from = await makeSite(api)
    const closed = await makeSite(api)
    const asset = await makeAsset(api, from)
    await api.post(`/api/sites/${closed}/shutdown`).send({ reason: 'closed' })

    const toClosed = await api.post('/api/assets/transfer').send({ asset_ids: [asset.id], to_site_id: closed })
    expect(toClosed.status).toBe(422)
    expect(toClosed.body.error).toBe('site_shutdown')

    const nowhere = await api.post('/api/assets/transfer').send({ asset_ids: [asset.id], to_site_id: '00000000-0000-0000-0000-000000000000' })
    expect(nowhere.status).toBe(404)

    expect((await api.get(`/api/assets/${asset.id}`)).body.site_id).toBe(from)
  })

  it('reports unknown asset ids as skipped rather than failing the batch', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const from = await makeSite(api)
    const to = await makeSite(api)
    const asset = await makeAsset(api, from)
    const ghost = '00000000-0000-0000-0000-00000000dead'

    const res = await api.post('/api/assets/transfer').send({ asset_ids: [asset.id, ghost], to_site_id: to })
    expect(res.status).toBe(200)
    expect(res.body.transferred).toBe(1)
    expect(res.body.skipped).toEqual([{ asset_id: ghost, reason: 'not_found' }])
  })

  it('validates the body and requires asset:update', async () => {
    const owner = await apiAs(USERS.ownerA.email)
    const to = await makeSite(owner)
    expect((await owner.post('/api/assets/transfer').send({ asset_ids: [], to_site_id: to })).status).toBe(400)
    expect((await owner.post('/api/assets/transfer').send({ asset_ids: ['not-a-uuid'], to_site_id: to })).status).toBe(400)

    const viewer = await apiAs(USERS.viewerA.email)
    const res = await viewer.post('/api/assets/transfer').send({ asset_ids: ['00000000-0000-0000-0000-000000000001'], to_site_id: to })
    expect(res.status).toBe(403)
  })
})
