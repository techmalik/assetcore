import crypto from 'node:crypto'
import type { PoolClient } from 'pg'

export type TokenKind = 'refresh' | 'reset' | 'invite'

const TTL_MS: Record<TokenKind, number> = {
  refresh: 30 * 24 * 60 * 60 * 1000, // 30 days
  reset: 60 * 60 * 1000, // 1 hour
  invite: 7 * 24 * 60 * 60 * 1000, // 7 days
}

function generate(): string {
  return crypto.randomBytes(32).toString('hex')
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Issues a new opaque token of `kind` for `userId`, storing only its hash. */
export async function issueToken(client: PoolClient, userId: string, kind: TokenKind): Promise<string> {
  const token = generate()
  const expiresAt = new Date(Date.now() + TTL_MS[kind])
  await client.query(
    'insert into public.auth_tokens (user_id, kind, token_hash, expires_at) values ($1, $2, $3, $4)',
    [userId, kind, hash(token), expiresAt]
  )
  return token
}

/** Atomically consumes an unused, unexpired token of `kind`, returning its user_id (or null). */
export async function consumeToken(client: PoolClient, token: string, kind: TokenKind): Promise<string | null> {
  const { rows } = await client.query(
    `update public.auth_tokens set used_at = now()
     where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()
     returning user_id`,
    [hash(token), kind]
  )
  return rows[0]?.user_id ?? null
}

/** Revokes all outstanding (unused) tokens of `kind` for a user — e.g. all refresh
 * sessions after a password reset. */
export async function revokeAll(client: PoolClient, userId: string, kind: TokenKind): Promise<void> {
  await client.query(
    `update public.auth_tokens set used_at = now()
     where user_id = $1 and kind = $2 and used_at is null`,
    [userId, kind]
  )
}
