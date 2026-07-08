import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { buildSet } from '../sqlUtil.js'

export const profileRouter = Router()
profileRouter.use(requireAuth)

// Deliberately narrow: only full_name/phone are settable here, never
// password_hash/status/email — those go through /api/auth/change-password
// and admin-only routes respectively.
const ALLOWED = ['full_name', 'phone']

profileRouter.get('/profile', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      'select id, email, full_name, phone, avatar_url from public.users where id = current_user_id()'
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

const profilePatch = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().nullable().optional(),
})

profileRouter.patch('/profile', async (req, res) => {
  const parsed = profilePatch.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { setSql, values } = buildSet(parsed.data, ALLOWED, 0)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `update public.users set ${setSql} where id = current_user_id() returning id, email, full_name, phone, avatar_url`,
      values
    ).then((r) => r.rows[0])
  )
  res.json(row)
})
