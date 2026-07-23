import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS, ORG_A, ORG_B, SITE_A1, SITE_A2 } from './fixtures.js'

// One login per user for the whole file (not per test/per it()) — the login
// route is rate-limited to 10 requests/15min per IP (apps/api/src/auth/routes.ts),
// and every supertest call in this process shares one IP. This file exercises
// 4 distinct actors across a dozen scenarios, so each is logged in exactly
// once here and every test below reuses the same client.
let ownerApi: Awaited<ReturnType<typeof apiAs>>
let opsApi: Awaited<ReturnType<typeof apiAs>>
let techApi: Awaited<ReturnType<typeof apiAs>>
let hseApi: Awaited<ReturnType<typeof apiAs>>

beforeAll(async () => {
  await seedFixtures()
  ownerApi = await apiAs(USERS.ownerA.email)
  opsApi = await apiAs(USERS.opsManagerA.email)
  techApi = await apiAs(USERS.fieldTechA1.email)
  hseApi = await apiAs(USERS.hseOfficerA1.email)
})

// Same convention health.test.ts uses for unique-enough titles without
// Date.now()/Math.random().
function suffix(): string {
  return randomBytes(4).toString('hex')
}

const today = () => new Date().toISOString().slice(0, 10)

async function createPendingTask(extra: Record<string, unknown> = {}) {
  const sched = await ownerApi.post('/api/pm-schedules').send({
    title: `Test PM schedule ${suffix()}`, frequency: 'monthly', next_due: today(), ...extra,
  })
  expect(sched.status).toBe(201)
  await ownerApi.post('/api/pm/generate')
  const tasksRes = await ownerApi.get('/api/pm-tasks?statuses=pending&limit=200')
  const task = tasksRes.body.find((t: any) => t.schedule_id === sched.body.id)
  expect(task).toBeTruthy()
  return task
}

describe('wo_assigned notification + assignment activity', () => {
  it('assigning a WO notifies the new assignee and records an assignment activity row', async () => {
    const created = await opsApi.post('/api/work-orders').send({ title: `Test WO assign ${suffix()}`, type: 'corrective' })
    expect(created.status).toBe(201)
    const woId = created.body.id

    const patched = await opsApi.patch(`/api/work-orders/${woId}`).send({ assignee_id: USERS.fieldTechA1.id })
    expect(patched.status).toBe(200)

    const detail = await opsApi.get(`/api/work-orders/${woId}`)
    expect(detail.body.activity.some((a: any) => a.kind === 'assignment')).toBe(true)

    const notifs = await techApi.get('/api/notifications?limit=200')
    expect(notifs.body.some((n: any) => n.kind === 'wo_assigned' && n.entity_id === woId)).toBe(true)
  })

  it('self-assigning a WO does not notify the actor', async () => {
    const created = await ownerApi.post('/api/work-orders')
      .send({ title: `Test WO self-assign ${suffix()}`, type: 'corrective', assignee_id: USERS.ownerA.id })
    expect(created.status).toBe(201)
    const woId = created.body.id

    const notifs = await ownerApi.get('/api/notifications?limit=200')
    expect(notifs.body.some((n: any) => n.kind === 'wo_assigned' && n.entity_id === woId)).toBe(false)
  })

  it('a wo:update-only holder (field_tech) cannot reassign a work order', async () => {
    // site_id required: work_orders' RLS hides site_id-null (org-wide) rows
    // from site-scoped callers (0004_locations_rbac.sql) — fieldTechA1 is
    // scoped to SITE_A1, so the WO must live there for them to see it at all.
    const created = await opsApi.post('/api/work-orders')
      .send({ title: `Test WO reassign-forbidden ${suffix()}`, type: 'corrective', site_id: SITE_A1 })
    expect(created.status).toBe(201)
    const woId = created.body.id

    const res = await techApi.patch(`/api/work-orders/${woId}`).send({ assignee_id: USERS.fieldTechA1.id })
    expect(res.status).toBe(403)
  })
})

describe('closing a work order notifies its creator', () => {
  it('a WO closed by its assignee notifies the creator/assigner, not the assignee', async () => {
    // site_id: SITE_A1 so fieldTechA1 (site-scoped) can see/transition it — see
    // the note above on work_orders' RLS hiding site_id-null rows from them.
    const created = await opsApi.post('/api/work-orders') // creates and assigns
      .send({ title: `Test WO close ${suffix()}`, type: 'corrective', site_id: SITE_A1, assignee_id: USERS.fieldTechA1.id })
    expect(created.status).toBe(201)
    const woId = created.body.id

    const closeRes = await techApi.post(`/api/work-orders/${woId}/transition`).send({ status: 'closed' })
    expect(closeRes.status).toBe(200)

    const opsNotifs = await opsApi.get('/api/notifications?limit=200')
    expect(opsNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === woId)).toBe(true)

    const techNotifs = await techApi.get('/api/notifications?limit=200')
    expect(techNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === woId)).toBe(false)
  })
})

describe('pm_assigned notification', () => {
  it('assigning an existing PM task notifies the new assignee', async () => {
    const task = await createPendingTask()

    const patchRes = await ownerApi.patch(`/api/pm-tasks/${task.id}`).send({ assignee_id: USERS.hseOfficerA1.id })
    expect(patchRes.status).toBe(200)

    const notifs = await hseApi.get('/api/notifications?limit=200')
    expect(notifs.body.some((n: any) => n.kind === 'pm_assigned' && n.entity_id === task.id)).toBe(true)
  })

  it('generate_pm_tasks notifies the schedule default assignee for each generated task', async () => {
    const task = await createPendingTask({ assignee_id: USERS.fieldTechA1.id })
    expect(task.assignee_id).toBe(USERS.fieldTechA1.id)

    const notifs = await techApi.get('/api/notifications?limit=200')
    expect(notifs.body.some((n: any) => n.kind === 'pm_assigned' && n.entity_id === task.id)).toBe(true)
  })
})

describe('work_completed notification on PM task completion', () => {
  it('completing a PM task notifies owner/ops_manager but not the actor, and does not double-fire on a later patch', async () => {
    const task = await createPendingTask()

    const completeRes = await opsApi.patch(`/api/pm-tasks/${task.id}`).send({ status: 'completed', notes: 'done' })
    expect(completeRes.status).toBe(200)

    const ownerNotifs = await ownerApi.get('/api/notifications?limit=200')
    expect(ownerNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === task.id)).toBe(true)

    const opsNotifs = await opsApi.get('/api/notifications?limit=200')
    expect(opsNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === task.id)).toBe(false)

    // Already completed — a further patch must not fire a second notification.
    await opsApi.patch(`/api/pm-tasks/${task.id}`).send({ notes: 'still done' })
    const ownerNotifs2 = await ownerApi.get('/api/notifications?limit=200')
    const count = ownerNotifs2.body.filter((n: any) => n.kind === 'work_completed' && n.entity_id === task.id).length
    expect(count).toBe(1)
  })
})

describe('report_uploaded notification', () => {
  it('uploading a maintenance report notifies role holders, deduped on a repeat upload', async () => {
    const task = await createPendingTask()

    const upload1 = await opsApi.post(`/api/pm-tasks/${task.id}/report`).attach('report', Buffer.from('report v1'), 'report.pdf')
    expect(upload1.status).toBe(201)
    const upload2 = await opsApi.post(`/api/pm-tasks/${task.id}/report`).attach('report', Buffer.from('report v2'), 'report2.pdf')
    expect(upload2.status).toBe(201)

    const ownerNotifs = await ownerApi.get('/api/notifications?limit=200')
    const count = ownerNotifs.body.filter((n: any) => n.kind === 'report_uploaded' && n.entity_id === task.id).length
    expect(count).toBe(1)
  })
})

describe('inspection_assigned + work_completed (site-scoped)', () => {
  it('creating an inspection with an inspector notifies them', async () => {
    const created = await ownerApi.post('/api/inspections').send({
      title: `Test inspection assign ${suffix()}`, kind: 'safety', scheduled_date: today(),
      site_id: SITE_A1, inspector_id: USERS.hseOfficerA1.id,
    })
    expect(created.status).toBe(201)

    const notifs = await hseApi.get('/api/notifications?limit=200')
    expect(notifs.body.some((n: any) => n.kind === 'inspection_assigned' && n.entity_id === created.body.id)).toBe(true)
  })

  it('completing a SITE_A1 inspection notifies owner/ops_manager/hse_officer but not the actor', async () => {
    const created = await hseApi.post('/api/inspections').send({
      title: `Test inspection complete A1 ${suffix()}`, kind: 'safety', scheduled_date: today(), site_id: SITE_A1,
    })
    expect(created.status).toBe(201)
    const inspId = created.body.id

    const completeRes = await hseApi.patch(`/api/inspections/${inspId}`).send({ status: 'completed', findings: 'all clear' })
    expect(completeRes.status).toBe(200)

    const ownerNotifs = await ownerApi.get('/api/notifications?limit=200')
    expect(ownerNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === inspId)).toBe(true)
    const opsNotifs = await opsApi.get('/api/notifications?limit=200')
    expect(opsNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === inspId)).toBe(true)
    const hseNotifs = await hseApi.get('/api/notifications?limit=200')
    expect(hseNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === inspId)).toBe(false)
  })

  it('completing a SITE_A2 inspection does not notify the SITE_A1-scoped hse officer', async () => {
    const created = await ownerApi.post('/api/inspections').send({
      title: `Test inspection complete A2 ${suffix()}`, kind: 'safety', scheduled_date: today(), site_id: SITE_A2,
    })
    expect(created.status).toBe(201)
    const inspId = created.body.id

    const completeRes = await ownerApi.patch(`/api/inspections/${inspId}`).send({ status: 'completed', findings: 'all clear' })
    expect(completeRes.status).toBe(200)

    const hseNotifs = await hseApi.get('/api/notifications?limit=200')
    expect(hseNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === inspId)).toBe(false)
  })
})

describe('notification preferences are honored for the new kinds', () => {
  it('turning off work_completed in_app suppresses the notification', async () => {
    const off = await ownerApi.put('/api/notification-preferences').send({ kind: 'work_completed', in_app: false, email: false })
    expect(off.status).toBe(204)
    try {
      const task = await createPendingTask()
      await opsApi.patch(`/api/pm-tasks/${task.id}`).send({ status: 'completed' })

      const ownerNotifs = await ownerApi.get('/api/notifications?limit=200')
      expect(ownerNotifs.body.some((n: any) => n.kind === 'work_completed' && n.entity_id === task.id)).toBe(false)
    } finally {
      await ownerApi.put('/api/notification-preferences').send({ kind: 'work_completed', in_app: true, email: false })
    }
  })
})

describe('notify_users org-spoof guard', () => {
  it('returns 0 and inserts nothing when p_org_id does not match the session org', async () => {
    const client = ownerClient()
    await client.connect()
    try {
      await client.query('begin')
      // Simulates the RLS app role's session context sitting in org A, then
      // asks notify_users to fan out under org B — the guard in
      // 0014_activity_assignment_notifications.sql must reject this.
      await client.query(`select set_config('app.org_id', $1, true)`, [ORG_A])
      const res = await client.query(
        `select public.notify_users($1, $2::uuid[], null, 'system', 'spoofed', 'spoofed', 'test', gen_random_uuid()) as n`,
        [ORG_B, [USERS.ownerB.id]]
      )
      expect(res.rows[0].n).toBe(0)
      await client.query('rollback')
    } finally {
      await client.end()
    }
  })
})
