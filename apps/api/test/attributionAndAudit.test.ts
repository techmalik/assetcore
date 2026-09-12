import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { apiAs } from './helpers.js'
import { seedFixtures, ownerClient, USERS, ORG_A, SITE_A1, ASSET_A1 } from './fixtures.js'

beforeAll(async () => {
  await seedFixtures()
})

function uniqueSuffix(): string {
  return randomBytes(4).toString('hex')
}

async function withClient<T>(fn: (client: Awaited<ReturnType<typeof ownerClient>>) => Promise<T>): Promise<T> {
  const client = ownerClient()
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

// One login per user for the whole file — /auth/login is rate limited and the
// suite shares a single app instance.
let owner: Awaited<ReturnType<typeof apiAs>>
let ops: Awaited<ReturnType<typeof apiAs>>
beforeAll(async () => {
  owner = await apiAs(USERS.ownerA.email)
  ops = await apiAs(USERS.opsManagerA.email)
})

describe('assignment attribution: work orders', () => {
  it('records who assigned it, at creation and on reassignment, and clears it on unassign', async () => {
    const created = await ops.post('/api/work-orders').send({
      title: 'Attribution test WO', type: 'corrective', priority: 'medium',
      site_id: SITE_A1, asset_id: ASSET_A1, assignee_id: USERS.fieldTechA1.id,
    })
    expect(created.status).toBe(201)
    expect(created.body.assigned_by).toBe(USERS.opsManagerA.id)
    expect(created.body.assigner?.full_name).toBeTruthy()
    expect(created.body.assigned_at).toBeTruthy()

    // Reassigned by a different user — the stamp follows the latest assigner.
    const reassigned = await owner.patch(`/api/work-orders/${created.body.id}`)
      .send({ assignee_id: USERS.hseOfficerA1.id })
    expect(reassigned.status).toBe(200)
    expect(reassigned.body.assigned_by).toBe(USERS.ownerA.id)

    // Unassigning must clear it, not leave a stale assigner on an unassigned WO.
    const cleared = await owner.patch(`/api/work-orders/${created.body.id}`).send({ assignee_id: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.assigned_by).toBeNull()
    expect(cleared.body.assigned_at).toBeNull()
  })

  it('the assignee notification names the assigner instead of echoing their own name', async () => {
    const created = await ops.post('/api/work-orders').send({
      title: 'Notification attribution WO', type: 'corrective', priority: 'low',
      site_id: SITE_A1, assignee_id: USERS.fieldTechA1.id,
    })
    expect(created.status).toBe(201)

    await withClient(async (c) => {
      const { rows } = await c.query(
        `select body, actor_id from public.notifications
         where kind = 'wo_assigned' and user_id = $1 and entity_id = $2`,
        [USERS.fieldTechA1.id, created.body.id]
      )
      expect(rows).toHaveLength(1)
      // Previously this read "Assigned to <the recipient's own name>."
      expect(rows[0].body).toMatch(/^Assigned by /)
      expect(rows[0].actor_id).toBe(USERS.opsManagerA.id)
    })
  })
})

describe('assignment attribution: PM tasks and inspections', () => {
  it('a PM task records its assigner — it previously recorded one nowhere at all', async () => {
    const taskId = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.pm_tasks (org_id, site_id, title, status, due_date)
         values ($1, $2, $3, 'pending', current_date + 3) returning id`,
        [ORG_A, SITE_A1, `Attribution PM ${uniqueSuffix()}`]
      )
      return rows[0].id as string
    })

    const res = await ops.patch(`/api/pm-tasks/${taskId}`).send({ assignee_id: USERS.fieldTechA1.id })
    expect(res.status).toBe(200)
    expect(res.body.assigned_by).toBe(USERS.opsManagerA.id)
    expect(res.body.assigner?.full_name).toBeTruthy()

    // The assign path also had no audit entry at all before this.
    await withClient(async (c) => {
      const { rows } = await c.query(
        `select action, entity_label from public.audit_log
         where entity_type = 'pm_task' and entity_id = $1 and action = 'pm_task.assign'`,
        [taskId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].entity_label).toContain('Attribution PM')
    })

    const cleared = await ops.patch(`/api/pm-tasks/${taskId}`).send({ assignee_id: null })
    expect(cleared.body.assigned_by).toBeNull()
  })

  it('an inspection created with an inspector records the creator as the assigner', async () => {
    const res = await owner.post('/api/inspections').send({
      title: `Attribution inspection ${uniqueSuffix()}`,
      kind: 'condition', status: 'scheduled',
      scheduled_date: new Date().toISOString().slice(0, 10),
      site_id: SITE_A1, inspector_id: USERS.fieldTechA1.id,
    })
    expect(res.status).toBe(201)
    expect(res.body.assigned_by).toBe(USERS.ownerA.id)
  })

  it('reassigning an inspection files a distinct assign action with a real before', async () => {
    const created = await owner.post('/api/inspections').send({
      title: `Reassign inspection ${uniqueSuffix()}`,
      kind: 'safety', status: 'scheduled',
      scheduled_date: new Date().toISOString().slice(0, 10),
      site_id: SITE_A1,
    })
    expect(created.status).toBe(201)

    // owner, not ops_manager: ops_manager holds inspection:read but not
    // inspection:update, so the PATCH would 403.
    const res = await owner.patch(`/api/inspections/${created.body.id}`)
      .send({ inspector_id: USERS.fieldTechA1.id })
    expect(res.status).toBe(200)
    expect(res.body.assigned_by).toBe(USERS.ownerA.id)

    await withClient(async (c) => {
      const { rows } = await c.query(
        `select action, before, after from public.audit_log
         where entity_type = 'inspection' and entity_id = $1 and action = 'inspection.assign'`,
        [created.body.id]
      )
      expect(rows).toHaveLength(1)
      // It used to land as a generic inspection.update with no before, so the
      // log couldn't even be read as "this was an assignment".
      expect(rows[0].before).toEqual({ inspector_id: null })
      expect(rows[0].after).toEqual({ inspector_id: USERS.fieldTechA1.id })
    })
  })
})

describe('audit entity labels', () => {
  it('names the thing an event was about instead of a truncated UUID', async () => {
    const res = await ops.post('/api/work-orders').send({
      title: 'Labelled work order', type: 'corrective', priority: 'medium', site_id: SITE_A1,
    })
    expect(res.status).toBe(201)

    await withClient(async (c) => {
      const { rows } = await c.query(
        `select entity_label from public.audit_log
         where entity_type = 'work_order' and entity_id = $1 and action = 'wo.create'`,
        [res.body.id]
      )
      expect(rows[0].entity_label).toBe(`${res.body.ref} — Labelled work order`)
    })
  })

  // The case that justifies snapshotting over a read-time join: asset
  // categories are the one HARD delete in the codebase, so the name is
  // destroyed at the moment the delete entry becomes interesting.
  it('a hard-deleted asset category still reads correctly afterwards', async () => {
    const name = `Doomed Category ${uniqueSuffix()}`
    const created = await owner.post('/api/categories').send({ name, code: 'DOOM' })
    expect(created.status).toBe(201)

    const deleted = await owner.delete(`/api/categories/${created.body.id}`)
    expect(deleted.status).toBe(204)

    await withClient(async (c) => {
      const { rows: gone } = await c.query('select id from public.asset_categories where id = $1', [created.body.id])
      expect(gone).toHaveLength(0)

      const { rows } = await c.query(
        `select entity_label from public.audit_log
         where entity_type = 'asset_category' and entity_id = $1 and action = 'category.delete'`,
        [created.body.id]
      )
      expect(rows[0].entity_label).toContain(name)
    })
  })

  it('resolves a membership label whether entity_id is a membership or a user id', async () => {
    await withClient(async (c) => {
      const { rows: membership } = await c.query(
        'select id, user_id from public.memberships where org_id = $1 and user_id = $2',
        [ORG_A, USERS.ownerA.id]
      )
      // user.role/access/disable store a memberships.id …
      const { rows: byMembership } = await c.query(
        'select public.resolve_audit_label($1, $2, $3, null, null) as label',
        [ORG_A, 'membership', membership[0].id]
      )
      expect(byMembership[0].label).toBeTruthy()

      // … while user.invite stores a users.id. A single join misses every invite.
      const { rows: byUser } = await c.query(
        'select public.resolve_audit_label($1, $2, $3, null, null) as label',
        [ORG_A, 'membership', membership[0].user_id]
      )
      expect(byUser[0].label).toBe(byMembership[0].label)
    })
  })

  it('synthesises a label for maintenance events, which carry no name of their own', async () => {
    const eventId = await withClient(async (c) => {
      const { rows } = await c.query(
        `insert into public.maintenance_events (org_id, asset_id, site_id, source, completed_at, next_maintenance_at)
         values ($1, $2, $3, 'manual', current_date, current_date + 90) returning id`,
        [ORG_A, ASSET_A1, SITE_A1]
      )
      return rows[0].id as string
    })

    await withClient(async (c) => {
      const { rows } = await c.query(
        'select public.resolve_audit_label($1, $2, $3, null, null) as label',
        [ORG_A, 'maintenance_event', eventId]
      )
      expect(rows[0].label).toMatch(/^Maintenance on /)
    })
  })

  it('cannot read a label out of another organisation', async () => {
    await withClient(async (c) => {
      const { rows } = await c.query(
        'select public.resolve_audit_label($1, $2, $3, null, null) as label',
        [ORG_A, 'asset', 'b0000000-0000-0000-0000-00000000bb01'] // ASSET_B1, org B
      )
      expect(rows[0].label).toBeNull()
    })
  })
})

describe('audit log filters', () => {
  // One work order created by ops gives every filter something real to match.
  let woId: string
  let woRef: string
  beforeAll(async () => {
    const res = await ops.post('/api/work-orders').send({
      title: `Filterable WO ${uniqueSuffix()}`, type: 'corrective', priority: 'medium', site_id: SITE_A1,
    })
    expect(res.status).toBe(201)
    woId = res.body.id
    woRef = res.body.ref
  })

  it('offers only facet values the log actually contains', async () => {
    const res = await owner.get('/api/audit-log/facets')
    expect(res.status).toBe(200)
    expect(res.body.actions).toContain('wo.create')
    expect(res.body.entity_types).toContain('work_order')
    expect(res.body.actors.some((a: { id: string }) => a.id === USERS.opsManagerA.id)).toBe(true)
    // Facets are org-scoped like the log itself.
    expect(res.body.actors.every((a: { id: string }) => a.id !== USERS.ownerB.id)).toBe(true)
  })

  it('filters by actor, action and entity type, and counts what it filtered', async () => {
    const res = await owner.get(
      `/api/audit-log?actor_id=${USERS.opsManagerA.id}&action=wo.create&entity_type=work_order&limit=200`
    )
    expect(res.status).toBe(200)
    expect(res.body.rows.length).toBeGreaterThan(0)
    expect(res.body.rows.every((r: { action: string }) => r.action === 'wo.create')).toBe(true)
    expect(res.body.rows.every((r: { actor_id: string }) => r.actor_id === USERS.opsManagerA.id)).toBe(true)
    // total must describe the filtered set, or the pager offers pages that
    // cannot be reached.
    expect(res.body.total).toBe(res.body.rows.length)
    expect(res.body.rows.some((r: { entity_id: string }) => r.entity_id === woId)).toBe(true)
  })

  it('searches the entity label', async () => {
    const res = await owner.get(`/api/audit-log?q=${encodeURIComponent(woRef)}`)
    expect(res.status).toBe(200)
    expect(res.body.rows.length).toBeGreaterThan(0)
    expect(res.body.rows.every((r: { entity_label: string }) => r.entity_label.includes(woRef))).toBe(true)
  })

  it('includes events from the whole of the end day, not just its midnight', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const res = await owner.get(`/api/audit-log?from=${today}&to=${today}&limit=200`)
    expect(res.status).toBe(200)
    expect(res.body.rows.some((r: { entity_id: string }) => r.entity_id === woId)).toBe(true)
  })

  it('excludes the event when the range ends before it', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const res = await owner.get(`/api/audit-log?to=${yesterday}&limit=200`)
    expect(res.status).toBe(200)
    expect(res.body.rows.every((r: { entity_id: string }) => r.entity_id !== woId)).toBe(true)
  })

  it('ignores an unparseable filter rather than failing the page', async () => {
    const res = await owner.get('/api/audit-log?actor_id=not-a-uuid')
    expect(res.status).toBe(200)
    expect(res.body.rows.length).toBeGreaterThan(0)
  })
})
