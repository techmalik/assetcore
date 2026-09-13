import { beforeAll, describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { apiAs } from './helpers.js'
import { seedFixtures, USERS, SITE_A1 } from './fixtures.js'

// Supertest buffers text but not binary bodies; collect the raw bytes so the
// CSV BOM and the xlsx zip survive intact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supertest types `res` as its own Response, which is the raw stream here
function binary(res: any, cb: (err: Error | null, body: any) => void) {
  const chunks: Buffer[] = []
  res.on('data', (chunk: Buffer) => chunks.push(chunk))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

/** Minimal RFC 4180 reader — enough to check a column's value when a cell
 * (an audit label, a JSON before/after) contains commas or quotes. */
function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); out.push(row); row = []; field = ''; i++ }
    else field += ch
  }
  if (field || row.length) { row.push(field); out.push(row) }
  return out
}

let owner: Awaited<ReturnType<typeof apiAs>>
let viewer: Awaited<ReturnType<typeof apiAs>>

beforeAll(async () => {
  await seedFixtures()
  owner = await apiAs(USERS.ownerA.email)
  viewer = await apiAs(USERS.viewerA.email)
})

describe('export catalogue', () => {
  it('lists only what the caller may export', async () => {
    const own = await owner.get('/api/exports')
    expect(own.status).toBe(200)
    const ownKeys = own.body.map((d: { key: string }) => d.key)
    expect(ownKeys).toEqual(expect.arrayContaining(['assets', 'work_orders', 'audit_log']))

    // '*:read' deliberately does not cover audit:read.
    const view = await viewer.get('/api/exports')
    expect(view.status).toBe(200)
    const viewKeys = view.body.map((d: { key: string }) => d.key)
    expect(viewKeys).toContain('assets')
    expect(viewKeys).not.toContain('audit_log')
  })
})

describe('assets export', () => {
  it('downloads a CSV attachment with a BOM, scoped to the org', async () => {
    const res = await owner.get('/api/exports/assets?format=csv').buffer(true).parse(binary)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="assetcore-assets-\d{4}-\d{2}-\d{2}\.csv"$/)

    const text = (res.body as Buffer).toString('utf8')
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const [header, ...lines] = parseCsv(text.slice(1))
    expect(header[0]).toBe('AIN')
    const ains = lines.map((l) => l[0])
    expect(ains).toContain('A1-AIN-001')
    expect(ains).toContain('A2-AIN-001')
    expect(ains).not.toContain('B1-AIN-001')
  })

  it('honours the site filter', async () => {
    const res = await owner.get(`/api/exports/assets?format=csv&site_id=${SITE_A1}`).buffer(true).parse(binary)
    expect(res.status).toBe(200)
    const ains = parseCsv((res.body as Buffer).toString('utf8').slice(1)).slice(1).map((l) => l[0])
    expect(ains).toContain('A1-AIN-001')
    expect(ains).not.toContain('A2-AIN-001')
  })

  it('downloads a workbook with a bold, frozen, filterable header', async () => {
    const res = await owner.get('/api/exports/assets?format=xlsx').buffer(true).parse(binary)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers['content-disposition']).toMatch(/\.xlsx"$/)

    const wb = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- exceljs's Buffer type predates Buffer<ArrayBufferLike>
    await wb.xlsx.load(res.body as any)
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).getCell(1).value).toBe('AIN')
    expect(ws.getRow(1).font?.bold).toBe(true)
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(ws.autoFilter).toBeTruthy()

    const ains: unknown[] = []
    ws.eachRow((row, n) => { if (n > 1) ains.push(row.getCell(1).value) })
    expect(ains).toContain('A1-AIN-001')

    // A number column holds numbers, not strings.
    const healthCol = (ws.getRow(1).values as unknown[]).indexOf('Health Score')
    expect(typeof ws.getRow(2).getCell(healthCol).value).toBe('number')
  })

  it('records the download in the audit log', async () => {
    await owner.get('/api/exports/assets?format=csv').buffer(true).parse(binary)
    const log = await owner.get('/api/audit-log?action=export.download&entity_type=export&limit=5')
    expect(log.status).toBe(200)
    const entry = log.body.rows[0]
    expect(entry.entity_label).toBe('Asset register')
    expect(entry.after).toMatchObject({ dataset: 'assets', format: 'csv' })
    expect(typeof entry.after.row_count).toBe('number')
  })
})

describe('export refusals', () => {
  it('403s a dataset whose capability the role lacks', async () => {
    const res = await viewer.get('/api/exports/audit_log?format=csv')
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('forbidden')
  })

  it('404s an unknown dataset and 400s an unknown format', async () => {
    expect((await owner.get('/api/exports/payroll?format=csv')).status).toBe(404)
    expect((await owner.get('/api/exports/assets?format=pdf')).status).toBe(400)
  })
})

describe('audit log export', () => {
  it('applies the same filters as the on-screen log', async () => {
    // Guarantee at least one matching event exists.
    await owner.get('/api/exports/assets?format=csv').buffer(true).parse(binary)

    const res = await owner.get('/api/exports/audit_log?format=csv&action=export.download').buffer(true).parse(binary)
    expect(res.status).toBe(200)
    const [header, ...lines] = parseCsv((res.body as Buffer).toString('utf8').slice(1))
    const actionIdx = header.indexOf('Action')
    expect(actionIdx).toBeGreaterThanOrEqual(0)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line[actionIdx]).toBe('export.download')
  })
})
