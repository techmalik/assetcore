import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth, requireOrg, requireActiveMembership)

notificationsRouter.get('/notifications', async (req, res) => {
  const limit = Number(req.query.limit) || 60
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      'select * from public.notifications where user_id = current_user_id() order by created_at desc limit $1',
      [limit]
    ).then((r) => r.rows)
  )
  res.json(rows)
})

notificationsRouter.get('/notifications/unread-count', async (req, res) => {
  const count = await withOrgContext(claimsFromReq(req), (c) =>
    c.query("select count(*)::int as count from public.notifications where user_id = current_user_id() and read = false")
      .then((r) => r.rows[0].count)
  )
  res.json({ count })
})

notificationsRouter.post('/notifications/:id/read', async (req, res) => {
  await withOrgContext(claimsFromReq(req), (c) =>
    c.query('update public.notifications set read = true where id = $1 and user_id = current_user_id()', [req.params.id])
  )
  res.status(204).end()
})

notificationsRouter.post('/notifications/read-all', async (req, res) => {
  await withOrgContext(claimsFromReq(req), (c) =>
    c.query("update public.notifications set read = true where user_id = current_user_id() and read = false")
  )
  res.status(204).end()
})

notificationsRouter.get('/notification-preferences', async (req, res) => {
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('select * from public.notification_preferences where user_id = current_user_id()').then((r) => r.rows)
  )
  res.json(rows)
})

const prefInput = z.object({ kind: z.string().min(1), in_app: z.boolean(), email: z.boolean() })

notificationsRouter.put('/notification-preferences', async (req, res) => {
  const parsed = prefInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { kind, in_app, email } = parsed.data

  await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.notification_preferences (org_id, user_id, kind, in_app, email)
       values (current_org_id(), current_user_id(), $1, $2, $3)
       on conflict (org_id, user_id, kind) do update set in_app = excluded.in_app, email = excluded.email`,
      [kind, in_app, email]
    )
  )
  res.status(204).end()
})
