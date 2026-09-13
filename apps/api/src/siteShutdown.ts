/**
 * "No work happens at a shut-down site", as the API enforces it.
 *
 * The cron side of the same rule lives in SQL (is_work_suspended(), 0027) so
 * the nightly jobs cannot raise what a person is refused. This is the request
 * side: work orders, inspections and PM schedules check here before they are
 * created.
 *
 * Kept to site status on purpose. An asset is only 'inactive' because its site
 * was shut down, so asking about the site is the same question — and it gives
 * a clearer refusal when someone picks a live asset but a shut-down site.
 */
import type { PoolClient } from 'pg'

type Queryable = Pick<PoolClient, 'query'>

/** True when the site, or the site the asset sits on, is shut down. */
export async function isSiteShutdown(
  c: Queryable,
  siteId: string | null | undefined,
  assetId: string | null | undefined
): Promise<boolean> {
  if (!siteId && !assetId) return false
  const { rows } = await c.query(
    `select exists (
       select 1 from public.sites s
       where s.status = 'shutdown'
         and (s.id = $1 or s.id = (select a.site_id from public.assets a where a.id = $2))
     ) as shut`,
    [siteId ?? null, assetId ?? null]
  )
  return Boolean(rows[0]?.shut)
}

/** The typed refusal every guarded create returns. */
export const SITE_SHUTDOWN_ERROR = { error: 'site_shutdown' } as const
