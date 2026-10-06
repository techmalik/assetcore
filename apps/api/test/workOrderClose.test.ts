import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { ownerClient, USERS, ASSET_A1 } from './fixtures.js'
import { apiAs, type Api } from './helpers.js'

// A work order can be closed three ways: the board or detail panel
// (/transition), completing maintenance against it, and (until TASK-5.1) a
// PATCH carrying `status`. Closing has to do the same work whichever way it
// happens: draw the reserved parts out of stock, resolve the defect the job
// was raised for, stamp actual_end, and tell the person who raised it.

let owner: Api
let manager: Api
let db: pg.Client

beforeAll(async () => {
  owner = await apiAs(USERS.ownerA.email)
  manager = await apiAs(USERS.opsManagerA.email)
  db = ownerClient()
  await db.connect()
})

afterAll(async () => {
  await db.end()
})

/** A part with stock, a defect raised by the manager, the job raised from it,
 * and part lines reserving `reserve` of each part on that job. */
async function jobWithPartsAndDefect({ stock = [10], reserve = [3] } = {}) {
  const tag = Math.random().toString(36).slice(2, 8)
  const parts: string[] = []
  for (const [i, opening] of stock.entries()) {
    const part = await owner.post('/api/spare-parts').send({
      part_number: `CLOSE-${tag}-${i}`, name: `Gasket ${tag} ${i}`, unit_cost_cents: 500, opening_stock: opening,
    })
    expect(part.status).toBe(201)
    parts.push(part.body.id)
  }

  const defect = await manager.post('/api/defects').send({ title: `Flange weep ${tag}`, severity: 'moderate', asset_id: ASSET_A1 })
  expect(defect.status).toBe(201)
  const wo = await manager.post(`/api/defects/${defect.body.id}/work-order`).send({})
  expect(wo.status).toBe(201)
  const woId: string = wo.body.work_order?.id ?? wo.body.id

  for (const [i, partId] of parts.entries()) {
    const line = await owner.post(`/api/work-orders/${woId}/parts`).send({ part_id: partId, quantity_required: reserve[i] })
    expect(line.status).toBe(201)
  }
  return { woId, defectId: defect.body.id as string, parts }
}

async function stockOf(partId: string) {
  const { rows } = await db.query('select quantity_in_stock from public.spare_parts where id = $1', [partId])
  return Number(rows[0].quantity_in_stock)
}

/** Everything a close must have done. */
async function expectClosedProperly(woId: string, defectId: string, partId: string, stockAfter: number) {
  const { rows: [wo] } = await db.query('select status, actual_end from public.work_orders where id = $1', [woId])
  expect(wo.status).toBe('closed')
  expect(wo.actual_end).not.toBeNull()

  expect(await stockOf(partId)).toBe(stockAfter)
  const { rows: ledger } = await db.query(
    `select quantity from public.stock_movements where part_id = $1 and kind = 'consumption' and work_order_id = $2`,
    [partId, woId]
  )
  expect(ledger.map((r) => Number(r.quantity))).toEqual([stockAfter - 10])

  const { rows: [defect] } = await db.query('select status, resolved_at from public.defects where id = $1', [defectId])
  expect(defect.status).toBe('resolved')
  expect(defect.resolved_at).not.toBeNull()

  const { rows: notes } = await db.query(
    `select 1 from public.notifications where user_id = $1 and entity_id = $2 and kind = 'work_completed'`,
    [USERS.opsManagerA.id, woId]
  )
  expect(notes).toHaveLength(1)
}

describe('closing a work order', () => {
  it('through /transition consumes parts, resolves the defect, stamps actual_end and notifies', async () => {
    const { woId, defectId, parts } = await jobWithPartsAndDefect()
    const res = await owner.post(`/api/work-orders/${woId}/transition`).send({ status: 'closed' })
    expect(res.status).toBe(200)
    await expectClosedProperly(woId, defectId, parts[0], 7)
  })

  it('through a maintenance completion does the same', async () => {
    const { woId, defectId, parts } = await jobWithPartsAndDefect()
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    const res = await owner.post(`/api/assets/${ASSET_A1}/maintenance-completions`)
      .field('source', 'work_order').field('work_order_id', woId)
      .field('completed_at', today).field('next_maintenance_at', '2099-01-01')
    expect(res.status).toBe(201)
    await expectClosedProperly(woId, defectId, parts[0], 7)
  })

  it('through a maintenance completion is refused when the stock is short, and records nothing', async () => {
    const { woId, parts } = await jobWithPartsAndDefect({ stock: [2], reserve: [3] })
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' })
    const res = await owner.post(`/api/assets/${ASSET_A1}/maintenance-completions`)
      .field('source', 'work_order').field('work_order_id', woId)
      .field('completed_at', today).field('next_maintenance_at', '2099-01-01')
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('insufficient_stock')
    const { rows: [wo] } = await db.query('select status from public.work_orders where id = $1', [woId])
    expect(wo.status).not.toBe('closed')
    const { rows: events } = await db.query('select 1 from public.maintenance_events where work_order_id = $1', [woId])
    expect(events).toHaveLength(0)
    expect(await stockOf(parts[0])).toBe(2)
  })

  it('draws nothing when one of several parts is short', async () => {
    const { woId, parts } = await jobWithPartsAndDefect({ stock: [10, 1], reserve: [3, 2] })
    const res = await owner.post(`/api/work-orders/${woId}/transition`).send({ status: 'closed' })
    expect(res.status).toBe(409)
    expect(res.body.shortfalls).toHaveLength(1)
    // The first part had enough, but the job did not close, so none of it
    // left the store.
    expect(await stockOf(parts[0])).toBe(10)
    const { rows: consumed } = await db.query(
      'select 1 from public.work_order_parts where work_order_id = $1 and consumed_at is not null', [woId]
    )
    expect(consumed).toHaveLength(0)
  })

  it('cannot be done with a PATCH', async () => {
    const { woId } = await jobWithPartsAndDefect()
    const res = await owner.patch(`/api/work-orders/${woId}`).send({ status: 'closed' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('use_transition')
    const { rows: [wo] } = await db.query('select status from public.work_orders where id = $1', [woId])
    expect(wo.status).not.toBe('closed')
  })
})

describe('creating a work order', () => {
  it('starts it as new, assigned or draft only', async () => {
    const ok = await owner.post('/api/work-orders').send({ title: 'Starts new', status: 'new' })
    expect(ok.status).toBe(201)
    const closed = await owner.post('/api/work-orders').send({ title: 'Born closed', status: 'closed' })
    expect(closed.status).toBe(400)
    expect(closed.body.error).toBe('invalid_initial_status')
  })
})
