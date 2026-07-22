import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { ownerPool } from '../db.js'
import { isDev } from '../config.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { signAccessToken } from './jwt.js'
import { issueToken, consumeToken, revokeAll } from './tokens.js'
import { sendMail } from './mailer.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { config } from '../config.js'

export const authRouter = Router()

const REFRESH_COOKIE = 'ac_refresh'
const refreshCookieOpts = {
  httpOnly: true,
  secure: !isDev,
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false })
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false })

// UUID that matches no real site — the encoding for "scoped, but to zero sites"
// (so an empty scope denies rather than falling back to the null = all-sites case).
// Exported: requireActiveMembership.ts reuses this + resolveSiteIds below so a
// live per-request scope check (TASK-2.6) uses the exact same resolution the
// login/refresh path uses, rather than a second, driftable implementation.
export const NO_SITE = '00000000-0000-0000-0000-000000000000'

/** Resolves the active membership (org/role/scope/grants) for a user: earliest
 * active membership in a non-deleted org, or nulls for a platform admin with no
 * membership. */
async function resolveOrgRole(userId: string): Promise<{
  orgId: string | null; roleKey: string | null
  siteScope: string[] | null; locationScope: string[] | null; extraCaps: string[]
}> {
  const { rows } = await ownerPool.query(
    `select m.org_id, m.role_key, m.site_scope, m.location_scope, m.extra_caps
     from public.memberships m
     join public.organizations o on o.id = m.org_id
     where m.user_id = $1 and m.status = 'active' and o.deleted_at is null
     order by m.created_at asc
     limit 1`,
    [userId]
  )
  const r = rows[0]
  return {
    orgId: r?.org_id ?? null,
    roleKey: r?.role_key ?? null,
    siteScope: r?.site_scope ?? null,
    locationScope: r?.location_scope ?? null,
    extraCaps: r?.extra_caps ?? [],
  }
}

/** Effective site-id set for the caller. NULL only when BOTH scopes are unset
 * (= all sites, System Admin / senior staff). Otherwise the union of the
 * explicit sites and every site in the scoped locations; [] collapses to
 * [NO_SITE] so an empty scope denies. */
export async function resolveSiteIds(
  orgId: string | null, siteScope: string[] | null, locationScope: string[] | null
): Promise<string[] | null> {
  if (!orgId) return null
  if (siteScope == null && locationScope == null) return null
  const ids = new Set<string>(siteScope ?? [])
  if (locationScope && locationScope.length) {
    const { rows } = await ownerPool.query(
      'select id from public.sites where org_id = $1 and location_id = any($2) and deleted_at is null',
      [orgId, locationScope]
    )
    for (const row of rows) ids.add(row.id)
  }
  const arr = [...ids]
  return arr.length ? arr : [NO_SITE]
}

async function issueSession(res: import('express').Response, user: { id: string; email: string }) {
  const { orgId, roleKey, siteScope, locationScope, extraCaps } = await resolveOrgRole(user.id)
  const siteIds = await resolveSiteIds(orgId, siteScope, locationScope)
  const accessToken = await signAccessToken({
    sub: user.id, email: user.email, org_id: orgId, role_key: roleKey, site_ids: siteIds, extra_caps: extraCaps,
  })
  const client = await ownerPool.connect()
  try {
    const refreshToken = await issueToken(client, user.id, 'refresh')
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOpts)
  } finally {
    client.release()
  }
  return { accessToken, orgId, roleKey, extraCaps }
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { email, password } = parsed.data

  const { rows } = await ownerPool.query(
    'select id, email, password_hash, full_name, status, must_change_password from public.users where email = $1',
    [email]
  )
  const user = rows[0]
  if (!user || !(await verifyPassword(user.password_hash, password))) {
    return res.status(401).json({ error: 'invalid_credentials' })
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'account_disabled' })
  }

  const { accessToken, orgId, roleKey } = await issueSession(res, user)
  res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      mustChangePassword: user.must_change_password,
    },
    orgId,
    roleKey,
  })
})

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (!token) return res.status(401).json({ error: 'no_refresh_token' })

  const client = await ownerPool.connect()
  let userId: string | null
  try {
    userId = await consumeToken(client, token, 'refresh')
  } finally {
    client.release()
  }
  if (!userId) {
    res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOpts.path })
    return res.status(401).json({ error: 'invalid_refresh_token' })
  }

  const { rows } = await ownerPool.query('select id, email, status from public.users where id = $1', [userId])
  const user = rows[0]
  if (!user || user.status !== 'active') {
    res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOpts.path })
    return res.status(401).json({ error: 'account_unavailable' })
  }

  const { accessToken, orgId, roleKey } = await issueSession(res, user)
  res.json({ accessToken, orgId, roleKey })
})

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE]
  if (token) {
    const client = await ownerPool.connect()
    try {
      await consumeToken(client, token, 'refresh')
    } finally {
      client.release()
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOpts.path })
  res.status(204).end()
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await ownerPool.query(
    'select id, email, full_name, phone, avatar_url, must_change_password from public.users where id = $1',
    [req.claims!.sub]
  )
  const user = rows[0]
  if (!user) return res.status(404).json({ error: 'not_found' })
  res.json({
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    avatarUrl: user.avatar_url,
    mustChangePassword: user.must_change_password,
    orgId: req.claims!.org_id,
    roleKey: req.claims!.role_key,
    extraCaps: req.claims!.extra_caps ?? [],
    siteIds: req.claims!.site_ids ?? null,
  })
})

const forgotSchema = z.object({ email: z.string().email() })

authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const { rows } = await ownerPool.query(
    "select id, email from public.users where email = $1 and status = 'active'",
    [parsed.data.email]
  )
  const user = rows[0]
  // Always 200 — never reveal whether an email is registered.
  if (user) {
    const client = await ownerPool.connect()
    try {
      const token = await issueToken(client, user.id, 'reset')
      const link = `${config.APP_ORIGIN}/reset-password?token=${token}`
      await sendMail({
        to: user.email,
        subject: 'Reset your AssetCore password',
        text: `Reset your password: ${link}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
      })
    } finally {
      client.release()
    }
  }
  res.status(200).json({ ok: true })
})

const resetSchema = z.object({ token: z.string().min(1), password: z.string().min(8) })

authRouter.post('/reset-password', async (req, res) => {
  const parsed = resetSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { token, password } = parsed.data

  const client = await ownerPool.connect()
  try {
    const userId = await consumeToken(client, token, ['reset', 'invite'])
    if (!userId) return res.status(400).json({ error: 'invalid_or_expired_token' })

    const passwordHash = await hashPassword(password)
    await client.query(
      'update public.users set password_hash = $1, must_change_password = false where id = $2',
      [passwordHash, userId]
    )
    await revokeAll(client, userId, 'refresh')
    res.status(200).json({ ok: true })
  } finally {
    client.release()
  }
})

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) })

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { currentPassword, newPassword } = parsed.data

  const { rows } = await ownerPool.query('select password_hash from public.users where id = $1', [req.claims!.sub])
  const user = rows[0]
  if (!user || !(await verifyPassword(user.password_hash, currentPassword))) {
    return res.status(401).json({ error: 'invalid_current_password' })
  }

  const passwordHash = await hashPassword(newPassword)
  const client = await ownerPool.connect()
  try {
    await client.query(
      'update public.users set password_hash = $1, must_change_password = false where id = $2',
      [passwordHash, req.claims!.sub]
    )
    await revokeAll(client, req.claims!.sub, 'refresh')
  } finally {
    client.release()
  }
  res.status(200).json({ ok: true })
})
