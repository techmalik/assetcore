import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext, ownerPool } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { buildSet } from '../sqlUtil.js'

export const orgRouter = Router()
orgRouter.use(requireAuth, requireOrg, requireActiveMembership)

const ALLOWED = ['name', 'short_name', 'region', 'settings']

orgRouter.get('/org', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      'select id, name, short_name, region, plan, settings from public.organizations where id = current_org_id()'
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// Lightweight active-member roster for assignee/operator pickers — readable by
// any active member (unlike /org/members, which is owner-only management).
orgRouter.get('/org/users', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `select u.id, u.full_name, u.email
       from public.memberships m
       join public.users u on u.id = m.user_id
       where m.org_id = current_org_id() and m.status = 'active'
       order by u.full_name asc`
    ).then((r) => r.rows)
  )
  res.json(rows)
})

const orgPatch = z.object({
  name: z.string().min(1).optional(),
  short_name: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  settings: z.record(z.unknown()).optional(),
})

// RLS (org_update policy) restricts this to role_key = 'owner' — a non-owner
// caller updates 0 rows, surfaced here as 403 rather than a silent no-op.
orgRouter.patch('/org', async (req, res) => {
  const parsed = orgPatch.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED, 0)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `update public.organizations set ${setSql} where id = current_org_id() returning id, name, short_name, region, plan, settings`,
      values
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(403).json({ error: 'forbidden' })
  res.json(row)
})

const settingsPatch = z.object({ settings: z.record(z.unknown()) })

// org_update RLS (see the PATCH /org comment above) restricts direct writes
// on this table to role_key='owner' — but org:manage is deliberately also
// granted to ops_manager (see rbac.ts) so operations managers can maintain
// things like the health-inspection threshold without full admin rights.
// The Configuration tab's UI already reflected that (gated on org:manage),
// but every save silently 403'd for anyone who wasn't literally the owner
// role, because it went through PATCH /org above. This is the fix: a
// narrowly-scoped route, gated by the capability rather than the DB role,
// that goes through the elevated (RLS-bypassing) pool for exactly one
// column - settings - explicitly scoped to the caller's own org since
// ownerPool has no org-context GUC to rely on. Name/branding changes stay
// owner-only via PATCH /org; this route cannot touch them.
orgRouter.patch('/org/settings', requireCap('org:manage'), async (req, res) => {
  const parsed = settingsPatch.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const orgId = req.claims!.org_id!
  const { rows } = await ownerPool.query(
    `update public.organizations set settings = $2::jsonb where id = $1
     returning id, name, short_name, region, plan, settings`,
    [orgId, JSON.stringify(parsed.data.settings)]
  )
  if (!rows[0]) return res.status(404).json({ error: 'not_found' })
  res.json(rows[0])
})
