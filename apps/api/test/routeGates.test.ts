import { beforeAll, describe, expect, it } from 'vitest'
import { apiRouter } from '../src/routes/index.js'
import { apiAs } from './helpers.js'
import { seedFixtures, USERS } from './fixtures.js'

// Every tenant route states the capability it needs. Routes that are open to
// any active member on purpose are listed here with the reason; anything else
// without a requireCap fails this test, so a new route cannot ship ungated by
// omission (as PUT /integrations/:kind did: any member, a viewer included,
// could rewrite the SAP and Termii settings).
const OPEN_TO_ANY_MEMBER: Record<string, string> = {
  'GET /sites': 'reference data: the location filter and every site picker',
  'GET /locations': 'reference data: the location filter',
  'GET /locations/mine': "the caller's own location scope",
  'GET /categories': 'reference data: asset category pickers',
  'POST /assets/:id/activity': 'commenting on an asset the caller can see (RLS scopes the asset)',
  'GET /pm-schedules': 'hse_officer lacks pm:read; pending the same owner decision as compliance (OOS-21)',
  'GET /pm-tasks': 'hse_officer lacks pm:read; pending the same owner decision as compliance (OOS-21)',
  'GET /assets/:id/maintenance-completions': 'hse_officer lacks pm:read; pending the same owner decision (OOS-21)',
  'GET /compliance-licences': 'supervisor and officer lack compliance:read; owner decision OOS-21',
  'GET /regulatory-authorities': 'reference data for the licence form; follows OOS-21',
  'GET /devices': 'no device capability exists; every role sees the device list today',
  'GET /devices/:id/readings': 'no device capability exists',
  'GET /integrations': 'the Integrations page is open to all; settings are withheld without integration:manage',
  'GET /notifications': "the caller's own notifications",
  'GET /notifications/unread-count': "the caller's own notifications",
  'POST /notifications/:id/read': "the caller's own notifications",
  'POST /notifications/:id/unread': "the caller's own notifications",
  'POST /notifications/read-all': "the caller's own notifications",
  'GET /notification-preferences': "the caller's own preferences",
  'PUT /notification-preferences': "the caller's own preferences",
  'GET /exports': 'lists only the datasets the caller may export (checked per dataset)',
  'GET /exports/:dataset': "checks the dataset's own capability in the handler",
  'GET /dashboard/stats': "every member's home page; each figure is RLS-scoped",
  'GET /dashboard/alerts': "every member's home page; each figure is RLS-scoped",
  'GET /dashboard/recent-work-orders': "every member's home page; RLS-scoped",
  'GET /org': 'org settings every screen reads (currency, name)',
  'GET /org/users': 'people pickers (assignee, approver, risk owner)',
  'PATCH /org': 'owner-only, enforced by the org_update RLS policy; the handler answers 403',
  'GET /profile': "the caller's own profile",
  'PATCH /profile': "the caller's own profile",
  'GET /licence': 'the licence banner every member sees',
  'GET /approvals/approvers': 'inline either-of-two-caps check; becomes requireAnyCap in TASK-2.3',
  'GET /analytics/calendar': 'mixes work orders, PM, inspections and licences, each RLS-scoped',
  'GET /integrity/overview': 'the UI needs any of three read caps; becomes requireAnyCap in TASK-2.3',
  'GET /files/*filePath': 'streams only a file referenced by a row the caller can see',
}

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: { name: string } }[] }
  name: string
  handle: { name: string; stack?: Layer[] }
}

/** Tenant routes (everything after the membership gate) with no requireCap. */
function ungatedTenantRoutes(): string[] {
  const out: string[] = []
  let tenant = false
  const walk = (stack: Layer[], capFromParent: boolean) => {
    for (const layer of stack) {
      if (!layer.route && layer.handle.name === 'requireActiveMembership') tenant = true
      if (layer.route) {
        const capped = capFromParent || layer.route.stack.some((s) => s.handle.name === 'requireCapMiddleware')
        if (tenant && !capped) out.push(`${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`)
      } else if (layer.name === 'router' && layer.handle.stack) {
        const inner = layer.handle.stack
        // orgMembers scopes requireCap('user:manage') to its whole path.
        const scoped = inner.some((l) => !l.route && l.handle.name === 'requireCapMiddleware')
        walk(inner, capFromParent || scoped)
      }
    }
  }
  walk((apiRouter as unknown as { stack: Layer[] }).stack, false)
  return out
}

describe('every tenant route is gated', () => {
  it('has a requireCap, or is on the open-to-any-member list with a reason', () => {
    const ungated = ungatedTenantRoutes()
    expect(ungated.length).toBeGreaterThan(0) // the walk found the tenant routes
    expect(ungated.filter((r) => !(r in OPEN_TO_ANY_MEMBER))).toEqual([])
  })

  it('the open list has no stale entries', () => {
    const ungated = new Set(ungatedTenantRoutes())
    expect(Object.keys(OPEN_TO_ANY_MEMBER).filter((r) => !ungated.has(r))).toEqual([])
  })
})

describe('integration settings', () => {
  let owner: Awaited<ReturnType<typeof apiAs>>
  let viewer: Awaited<ReturnType<typeof apiAs>>
  beforeAll(async () => {
    await seedFixtures()
    owner = await apiAs(USERS.ownerA.email)
    viewer = await apiAs(USERS.viewerA.email)
  })

  it('a viewer cannot change them', async () => {
    const res = await viewer.put('/api/integrations/sap').send({ config: { host: 'evil.example' }, enabled: true })
    expect(res.status).toBe(403)
  })

  it('the owner can, and only the owner sees them', async () => {
    const put = await owner.put('/api/integrations/sap').send({ label: 'SAP', config: { host: 'sap.internal' }, enabled: false })
    expect(put.status).toBe(200)

    const mine = (await owner.get('/api/integrations')).body.find((r: { kind: string }) => r.kind === 'sap')
    expect(mine.config).toEqual({ host: 'sap.internal' })

    const theirs = (await viewer.get('/api/integrations')).body.find((r: { kind: string }) => r.kind === 'sap')
    expect(theirs).toBeTruthy()
    expect(theirs.config).toEqual({})
  })
})
