import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

/** RLS-enforced pool. Connects as `assetcore_app` (non-owner, non-superuser) — every
 * query on this pool is subject to row-level security. Used for all normal
 * tenant-scoped request handling via `withOrgContext`. */
export const pool = new Pool({ connectionString: config.DATABASE_URL })

/** Owner-role pool. Bypasses RLS. Reserved for the same narrow set of privileged
 * surfaces the old service_role covered: auth (pre-session user/token lookups),
 * /api/admin + /api/org privileged writes, and node-cron jobs. */
export const ownerPool = new Pool({ connectionString: config.DATABASE_URL_OWNER })

export type Claims = {
  userId: string | null
  orgId: string | null
  roleKey: string | null
}

/**
 * Runs `fn` inside a transaction on the RLS-enforced pool with per-request
 * session context set via `SET LOCAL`, which `current_org_id()` / `current_user_id()`
 * / `current_role_key()` (db/migrations/0001_baseline.sql) read back out.
 * `SET LOCAL` values are scoped to the transaction and vanish on commit/rollback,
 * so pooled connections can't leak context across requests.
 */
export async function withOrgContext<T>(
  claims: Claims,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true), set_config($3, $4, true), set_config($5, $6, true)', [
      'app.org_id', claims.orgId ?? '',
      'app.user_id', claims.userId ?? '',
      'app.role_key', claims.roleKey ?? '',
    ])
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
