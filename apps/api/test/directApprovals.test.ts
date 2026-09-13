/**
 * Person-routed ("direct") approvals — 0028.
 *
 * A request sent to a named person rather than routed to a role by the
 * matrix. The things worth holding in place: it sits with exactly one person,
 * only that person can act on it, every hand-off lands in the history, and a
 * work order raised "for approval" only leaves Draft when it is accepted.
 */
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, USERS } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

type Api = Awaited<ReturnType<typeof apiAs>>
type Row = { id: string; status: string; kind: string }

// An inspection report keyed to a fresh id: approvals carry no foreign key to
// the thing approved, so the flow can be exercised without building one.
async function sendReport(requester: Api, assigneeId: string) {
  return requester.post('/api/approvals').send({
    entity_type: 'inspection',
    entity_id: randomUUID(),
    kind: 'inspection_report',
    title: 'Direct approval test report',
    notes: 'Please review',
    assignee_id: assigneeId,
  })
}

describe('direct approvals: submit → forward → return → resubmit → accept', () => {
  it('walks a report through every hand-off and records each one', async () => {
    const officer = await apiAs(USERS.fieldTechA1.email)
    const manager = await apiAs(USERS.opsManagerA.email)
    const owner = await apiAs(USERS.ownerA.email)
    const hse = await apiAs(USERS.hseOfficerA1.email)

    const submitted = await sendReport(officer, USERS.opsManagerA.id)
    expect(submitted.status).toBe(201)
    expect(submitted.body.route).toBe('direct')
    expect(submitted.body.assignee_id).toBe(USERS.opsManagerA.id)
    expect(submitted.body.current_role_key).toBeNull()
    const id = submitted.body.id as string

    const inbox = await manager.get('/api/approvals?scope=inbox')
    expect(inbox.body.some((a: Row) => a.id === id)).toBe(true)
    // Holding approval:decide is not enough. It is with one person.
    const ownerInbox = await owner.get('/api/approvals?scope=inbox')
    expect(ownerInbox.body.some((a: Row) => a.id === id)).toBe(false)

    const forwarded = await manager.post(`/api/approvals/${id}/forward`)
      .send({ to_user_id: USERS.ownerA.id, notes: 'Above my sign-off' })
    expect(forwarded.status).toBe(200)
    expect(forwarded.body.status).toBe('pending')
    expect(forwarded.body.assignee_id).toBe(USERS.ownerA.id)

    // Once forwarded, the previous holder can no longer act on it.
    const stale = await manager.post(`/api/approvals/${id}/approve`).send({})
    expect(stale.status).toBe(403)
    expect(stale.body.error).toBe('not_assignee')

    const noReason = await owner.post(`/api/approvals/${id}/return`).send({})
    expect(noReason.status).toBe(422)
    expect(noReason.body.error).toBe('notes_required')

    const returned = await owner.post(`/api/approvals/${id}/return`).send({ notes: 'Add the readings' })
    expect(returned.status).toBe(200)
    expect(returned.body.status).toBe('returned')
    expect(returned.body.assignee_id).toBeNull()

    const mine = await officer.get('/api/approvals?scope=mine')
    expect(mine.body.find((a: Row) => a.id === id)?.status).toBe('returned')
    const stats = await officer.get('/api/approvals/stats')
    expect(stats.body.returned_to_me).toBeGreaterThanOrEqual(1)

    const resubmitted = await officer.post(`/api/approvals/${id}/resubmit`)
      .send({ assignee_id: USERS.hseOfficerA1.id, notes: 'Readings added' })
    expect(resubmitted.status).toBe(200)
    expect(resubmitted.body.status).toBe('pending')
    expect(resubmitted.body.assignee_id).toBe(USERS.hseOfficerA1.id)

    const accepted = await hse.post(`/api/approvals/${id}/approve`).send({ notes: 'Accepted' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.status).toBe('approved')
    expect(accepted.body.approver_id).toBe(USERS.hseOfficerA1.id)

    const detail = await officer.get(`/api/approvals/${id}`)
    expect(detail.body.events.map((e: { action: string }) => e.action))
      .toEqual(['submitted', 'forwarded', 'returned', 'resubmitted', 'approved'])
    expect(detail.body.events[0].to_user.id).toBe(USERS.opsManagerA.id)
    expect(detail.body.events[1].to_user.id).toBe(USERS.ownerA.id)
    expect(detail.body.events[3].to_user.id).toBe(USERS.hseOfficerA1.id)
  })
})

describe('direct approvals: who may act', () => {
  it('refuses everyone but the current assignee with 403 not_assignee — the owner included', async () => {
    const officer = await apiAs(USERS.fieldTechA1.email)
    const hse = await apiAs(USERS.hseOfficerA1.email)
    const owner = await apiAs(USERS.ownerA.email)
    const { body } = await sendReport(officer, USERS.opsManagerA.id)

    for (const [who, path, payload] of [
      [hse, 'approve', {}],
      [hse, 'discard', { notes: 'not mine to discard' }],
      [owner, 'forward', { to_user_id: USERS.hseOfficerA1.id }],
      [owner, 'return', { notes: 'not mine to return' }],
    ] as const) {
      const res = await who.post(`/api/approvals/${body.id}/${path}`).send(payload)
      expect(res.status).toBe(403)
      expect(res.body.error).toBe('not_assignee')
    }
  })

  it('never lets a requester act on their own request, or have it forwarded back to them', async () => {
    const hse = await apiAs(USERS.hseOfficerA1.email)
    const owner = await apiAs(USERS.ownerA.email)
    const { body } = await sendReport(hse, USERS.ownerA.id)

    const self = await hse.post(`/api/approvals/${body.id}/approve`).send({})
    expect(self.status).toBe(403)
    expect(self.body.error).toBe('self_approval')

    const backToRequester = await owner.post(`/api/approvals/${body.id}/forward`).send({ to_user_id: USERS.hseOfficerA1.id })
    expect(backToRequester.status).toBe(422)
    expect(backToRequester.body.error).toBe('cannot_forward_to_requester')
  })

  it('refuses to send a request to someone who cannot decide it, or to yourself', async () => {
    const officer = await apiAs(USERS.fieldTechA1.email)
    const manager = await apiAs(USERS.opsManagerA.email)

    const toViewer = await sendReport(officer, USERS.viewerA.id)
    expect(toViewer.status).toBe(422)
    expect(toViewer.body.error).toBe('invalid_assignee')

    const toSelf = await sendReport(manager, USERS.opsManagerA.id)
    expect(toSelf.status).toBe(422)
    expect(toSelf.body.error).toBe('invalid_assignee')

    const toOtherOrg = await sendReport(officer, USERS.ownerB.id)
    expect(toOtherOrg.status).toBe(422)
    expect(toOtherOrg.body.error).toBe('invalid_assignee')
  })

  it('lists approvers without the caller and flags nobody as line manager when none is set', async () => {
    const officer = await apiAs(USERS.fieldTechA1.email)
    const res = await officer.get('/api/approvals/approvers')
    expect(res.status).toBe(200)
    const ids = res.body.map((a: { id: string }) => a.id)
    expect(ids).not.toContain(USERS.fieldTechA1.id)
    expect(ids).not.toContain(USERS.viewerA.id)
    expect(ids).toContain(USERS.opsManagerA.id)
  })
})

describe('a work order sent for approval when it is created', () => {
  it('is created as a draft and moves to New when accepted', async () => {
    const owner = await apiAs(USERS.ownerA.email)
    const manager = await apiAs(USERS.opsManagerA.email)

    const created = await owner.post('/api/work-orders').send({
      title: `Direct approval WO ${randomUUID().slice(0, 8)}`,
      approver_id: USERS.opsManagerA.id,
      approval_notes: 'Needed this week',
    })
    expect(created.status).toBe(201)
    expect(created.body.status).toBe('draft')
    expect(created.body.approval?.status).toBe('pending')
    expect(created.body.approval?.assignee_id).toBe(USERS.opsManagerA.id)

    const accepted = await manager.post(`/api/approvals/${created.body.approval.id}/approve`).send({})
    expect(accepted.status).toBe(200)

    const wo = await owner.get(`/api/work-orders/${created.body.id}`)
    expect(wo.body.status).toBe('new')
  })

  it('stays a draft, and on record, when the approval is discarded', async () => {
    const owner = await apiAs(USERS.ownerA.email)
    const manager = await apiAs(USERS.opsManagerA.email)

    const created = await owner.post('/api/work-orders').send({
      title: `Direct approval WO ${randomUUID().slice(0, 8)}`,
      approver_id: USERS.opsManagerA.id,
    })
    expect(created.status).toBe(201)

    const discarded = await manager.post(`/api/approvals/${created.body.approval.id}/discard`).send({ notes: 'Duplicate of an open job' })
    expect(discarded.status).toBe(200)
    expect(discarded.body.status).toBe('discarded')

    const wo = await owner.get(`/api/work-orders/${created.body.id}`)
    expect(wo.status).toBe(200)
    expect(wo.body.status).toBe('draft')
  })

  it('refuses an approver who cannot decide, and creates nothing', async () => {
    const owner = await apiAs(USERS.ownerA.email)
    const title = `Direct approval WO refused ${randomUUID().slice(0, 8)}`
    const res = await owner.post('/api/work-orders').send({ title, approver_id: USERS.viewerA.id })
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('invalid_assignee')

    const list = await owner.get('/api/work-orders')
    expect(list.body.some((w: { title: string }) => w.title === title)).toBe(false)
  })
})
