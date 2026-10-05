// How a user's membership turns into the org, role, grants and site scope a
// request runs with. Used by sign-in and refresh (auth/routes.ts) and by the
// live per-request check in requireActiveMembership, so both resolve scope
// the same way. It lived in the auth router, which made the middleware load
// the router (rate limiters, mailer) just to reach it.
import { ownerPool } from '../db.js'

// UUID that matches no real site — the encoding for "scoped, but to zero sites"
// (so an empty scope denies rather than falling back to the null = all-sites case).
const NO_SITE = '00000000-0000-0000-0000-000000000000'

/** Resolves the active membership (org/role/scope/grants) for a user: earliest
 * active membership in a non-deleted org, or nulls for a platform admin with no
 * membership. */
export async function resolveOrgRole(userId: string): Promise<{
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
