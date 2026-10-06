import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { ownerClient, USERS, ORG_A, SITE_A1 } from './fixtures.js'
import { apiAs, type Api } from './helpers.js'

// Every upload route goes through uploadRoute() in files.ts. Six of them used
// to accept anything, under any name, at any size the default allowed, and
// answer an oversized file with a 500.
const PDF = Buffer.from('%PDF-1.4\n%test\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
const NOT_A_PDF = Buffer.from('<html><script>alert(1)</script></html>')

type Target = { name: string; url: () => string; field: string; good: [Buffer, string]; extra?: Record<string, string>; limitMb: number }

let owner: Api
const ids: Record<string, string> = {}

async function sql<T = Record<string, string>>(text: string, params: unknown[]): Promise<T> {
  const c = ownerClient()
  await c.connect()
  try {
    return (await c.query(text, params)).rows[0] as T
  } finally {
    await c.end()
  }
}

beforeAll(async () => {
  owner = await apiAs(USERS.ownerA.email)
  const tag = randomUUID().slice(0, 8)
  ids.asset = (await sql(
    `insert into public.assets (org_id, site_id, ain, name, status, last_maintenance_at, next_maintenance_at)
     values ($1, $2, $3, 'Upload test asset', 'operational', current_date - 30, current_date + 60) returning id`,
    [ORG_A, SITE_A1, `UPLOAD-${tag}`]
  )).id
  ids.pmTask = (await sql(
    `insert into public.pm_tasks (org_id, site_id, asset_id, title, status, due_date)
     values ($1, $2, $3, 'Upload test task', 'pending', current_date) returning id`,
    [ORG_A, SITE_A1, ids.asset]
  )).id
  ids.wo = (await owner.post('/api/work-orders').send({ title: `Upload test ${tag}`, type: 'corrective' })).body.id
  ids.inspection = (await owner.post('/api/inspections').send({ title: `Upload test ${tag}`, kind: 'safety', scheduled_date: '2026-01-01', site_id: SITE_A1 })).body.id
  ids.licence = (await owner.post('/api/compliance-licences').send({ name: `Upload test ${tag}`, issued_date: '2026-01-01', expiry_date: '2030-01-01' })).body.id
  ids.audit = (await owner.post('/api/compliance-audits').send({ title: `Upload test ${tag}`, audit_date: '2026-01-01', site_id: null })).body.id
  const done = await owner.post(`/api/assets/${ids.asset}/maintenance-completions`)
    .field('completed_at', '2026-01-02').field('next_maintenance_at', '2026-06-01')
  ids.event = done.body.id
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`setup failed for ${k}`)
})

const completion = { completed_at: '2026-01-03', next_maintenance_at: '2026-07-01' }

const targets: Target[] = [
  { name: 'asset photo', url: () => `/api/assets/${ids.asset}/photos`, field: 'photo', good: [PNG, 'p.png'], limitMb: 10 },
  { name: 'asset document', url: () => `/api/assets/${ids.asset}/documents`, field: 'document', good: [PDF, 'd.pdf'], limitMb: 25 },
  { name: 'work order attachment', url: () => `/api/work-orders/${ids.wo}/attachments`, field: 'file', good: [PDF, 'a.pdf'], limitMb: 25 },
  { name: 'PM task report', url: () => `/api/pm-tasks/${ids.pmTask}/report`, field: 'report', good: [PDF, 'r.pdf'], limitMb: 25 },
  { name: 'inspection report', url: () => `/api/inspections/${ids.inspection}/report`, field: 'report', good: [PDF, 'r.pdf'], limitMb: 25 },
  { name: 'licence document', url: () => `/api/compliance-licences/${ids.licence}/document`, field: 'document', good: [PDF, 'l.pdf'], limitMb: 25 },
  { name: 'audit document', url: () => `/api/compliance-audits/${ids.audit}/document`, field: 'document', good: [PDF, 'a.pdf'], limitMb: 25 },
  { name: 'maintenance completion', url: () => `/api/assets/${ids.asset}/maintenance-completions`, field: 'report', good: [PDF, 'm.pdf'], extra: completion, limitMb: 25 },
  { name: 'maintenance report replace', url: () => `/api/maintenance-completions/${ids.event}/report`, field: 'report', good: [PDF, 'm.pdf'], limitMb: 25 },
]

function send(t: Target, buf: Buffer, filename: string) {
  let req = owner.post(t.url())
  for (const [k, v] of Object.entries(t.extra ?? {})) req = req.field(k, v)
  return req.attach(t.field, buf, filename)
}

describe.each(targets)('$name upload', (t) => {
  it('accepts a real file', async () => {
    const res = await send(t, ...t.good)
    expect(res.status).toBe(201)
  })

  it('refuses a file whose content is not what its name says', async () => {
    const res = await send(t, NOT_A_PDF, 'invoice.pdf')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unsupported_type')
  })

  it('answers an oversized file with 400, not 500', async () => {
    const big = Buffer.alloc((t.limitMb + 1) * 1024 * 1024, 0x25)
    const res = await send(t, big, 'big.pdf')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('file_too_large')
  })
})
