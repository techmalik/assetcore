import { randomInt, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ownerClient, USERS, ORG_A } from './fixtures.js'
import { apiAs } from './helpers.js'

describe('matrix approvals decide on the live role, not the token', () => {
  // A token carries the role it was issued with for up to an hour. Approve
  // used to check "is this waiting on you" against that copy, after the
  // capability check had used the live role, so a demoted approver could
  // still sign off on their old role's queue until the token expired.
  it('an approver demoted after signing in cannot approve their old role\'s request', async () => {
    const owner = await apiAs(USERS.ownerA.email)
    const officer = await apiAs(USERS.fieldTechA1.email)
    const manager = await apiAs(USERS.opsManagerA.email) // token says 'manager'

    // A band of its own, far above anything other tests create.
    const min = 900_000_000_000 + randomInt(0, 1_000_000) * 1_000
    const rule = await owner.post('/api/approval-rules').send({
      name: `Live-role test ${randomUUID().slice(0, 8)}`,
      entity_type: 'work_order', kind: 'wo_cost',
      min_amount_cents: min, max_amount_cents: min + 1_000,
      levels: [{ role_key: 'manager', label: null }],
    })
    expect(rule.status).toBe(201)

    const submitted = await officer.post('/api/approvals').send({
      entity_type: 'work_order', entity_id: randomUUID(), kind: 'wo_cost',
      title: 'Live-role test', amount_cents: min + 1,
    })
    expect(submitted.status).toBe(201)
    expect(submitted.body.current_role_key).toBe('manager')

    const c = ownerClient()
    await c.connect()
    try {
      await c.query(`update public.memberships set role_key = 'supervisor' where user_id = $1 and org_id = $2`, [USERS.opsManagerA.id, ORG_A])
      const res = await manager.post(`/api/approvals/${submitted.body.id}/approve`).send({})
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('wrong_approver')
    } finally {
      await c.query(`update public.memberships set role_key = 'manager' where user_id = $1 and org_id = $2`, [USERS.opsManagerA.id, ORG_A])
      await c.end()
    }
  })
})

describe('approval notifications follow the notification rules', () => {
  const countFor = async (userId: string, approvalId: string) => {
    const c = ownerClient()
    await c.connect()
    try {
      const { rows } = await c.query(
        `select actor_id from public.notifications where user_id = $1 and entity_type = 'approval' and entity_id = $2`,
        [userId, approvalId]
      )
      return rows
    } finally {
      await c.end()
    }
  }

  // They were raw inserts: no preference check, no actor on the notice.
  it('respect a recipient who turned approval notices off, and name the actor otherwise', async () => {
    const officer = await apiAs(USERS.fieldTechA1.email)
    const manager = await apiAs(USERS.opsManagerA.email)
    const send = () => officer.post('/api/approvals').send({
      entity_type: 'inspection', entity_id: randomUUID(), kind: 'inspection_report',
      title: 'Notification rules test', assignee_id: USERS.opsManagerA.id,
    })

    const on = await send()
    expect(on.status).toBe(201)
    const delivered = await countFor(USERS.opsManagerA.id, on.body.id)
    expect(delivered.length).toBe(1)
    expect(delivered[0].actor_id).toBe(USERS.fieldTechA1.id)

    expect((await manager.put('/api/notification-preferences').send({ kind: 'approval_pending', in_app: false, email: false })).status).toBe(204)
    try {
      const off = await send()
      expect(off.status).toBe(201)
      expect((await countFor(USERS.opsManagerA.id, off.body.id)).length).toBe(0)
    } finally {
      await manager.put('/api/notification-preferences').send({ kind: 'approval_pending', in_app: true, email: false })
    }
  })
})
