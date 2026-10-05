import { describe, expect, it } from 'vitest'
import { pool, ownerPool, withOrgContext } from '../src/db.js'
import { config } from '../src/config.js'

// Every connection works in the instance's timezone, so "today" in SQL is the
// local day everywhere, not only in exports.
describe('database sessions use the instance timezone', () => {
  it('the tenant pool, inside a request transaction', async () => {
    const tz = await withOrgContext({ userId: null, orgId: null, roleKey: null, siteIds: null }, (c) =>
      c.query("select current_setting('TimeZone') as tz").then((r) => r.rows[0].tz)
    )
    expect(tz).toBe(config.TZ)
  })

  it('the owner pool, which runs the scheduled jobs', async () => {
    const { rows } = await ownerPool.query("select current_setting('TimeZone') as tz")
    expect(rows[0].tz).toBe(config.TZ)
  })

  it('current_date is the local date', async () => {
    const { rows } = await pool.query('select current_date::text as d')
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: config.TZ }).format(new Date())
    expect(rows[0].d).toBe(local)
  })
})
