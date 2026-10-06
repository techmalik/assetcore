import type { PoolClient } from 'pg'
import { writeAuditLog } from '../audit.js'

/**
 * Move one or many assets to another site.
 *
 * One transaction for the batch, but a per-asset outcome: an asset already at
 * the destination, or one the caller cannot see, is reported as skipped rather
 * than failing the rest. A bad destination fails the whole request, because
 * nothing in the batch could succeed.
 *
 * What moves with the asset is the work still to be done — open work orders,
 * PM tasks and inspections, and its live PM schedules — so a job does not stay
 * pinned to a site the equipment has left (and, if that site is shut down,
 * become work nobody is allowed to do). Closed and completed records keep the
 * site they happened at: that is where the work was done.
 *
 * Health and book value are not recomputed. Neither reads the site, so a move
 * cannot change them.
 */
export async function transferAssets(
  c: PoolClient,
  { assetIds, toSiteId, reason, transferredAt }: { assetIds: string[]; toSiteId: string; reason?: string; transferredAt?: string },
  actorId: string,
  ip: string | null = null,
) {
  // sites RLS is org-only, but the assets being moved are site-scoped: a
  // scoped caller moving equipment somewhere they cannot see would fail the
  // assets policy's WITH CHECK mid-batch. Refuse it up front instead.
  const { rows: dest } = await c.query(
    `select id, name, status, (current_site_ids() is null or id = any(current_site_ids())) as in_scope
     from public.sites where id = $1 and deleted_at is null`,
    [toSiteId]
  )
  if (!dest[0]) return { error: 'not_found' as const }
  if (dest[0].status === 'shutdown') return { error: 'site_shutdown' as const }
  if (!dest[0].in_scope) return { error: 'forbidden' as const }

  const { rows: found } = await c.query(
    `select a.id, a.org_id, a.site_id, a.status, a.status_before_shutdown,
            s.name as from_site_name, s.status as from_site_status
     from public.assets a
     left join public.sites s on s.id = a.site_id
     where a.id = any($1::uuid[]) and a.deleted_at is null
     for update of a`,
    [assetIds]
  )
  const byId = new Map(found.map((r) => [r.id as string, r]))

  const skipped: Array<{ asset_id: string; reason: 'same_site' | 'not_found' }> = []
  let transferred = 0
  for (const id of assetIds) {
    const a = byId.get(id)
    if (!a) { skipped.push({ asset_id: id, reason: 'not_found' }); continue }
    if (a.site_id === toSiteId) { skipped.push({ asset_id: id, reason: 'same_site' }); continue }

    // Inactive only because of where it was: leaving the shut-down site
    // gives it back the status it had. An asset someone set inactive for
    // another reason, with nothing remembered, stays as it is.
    const revive = a.status === 'inactive' && (a.status_before_shutdown != null || a.from_site_status === 'shutdown')
    const { rows: upd } = await c.query(
      `update public.assets
       set site_id = $2,
           status = case when $3 then coalesce(status_before_shutdown, 'operational') else status end,
           status_before_shutdown = case when $3 then null else status_before_shutdown end
       where id = $1
       returning status`,
      [id, toSiteId, revive]
    )

    await c.query(
      `update public.work_orders set site_id = $2, updated_at = now()
       where asset_id = $1 and deleted_at is null and status <> 'closed'`,
      [id, toSiteId]
    )
    await c.query(
      `update public.pm_tasks set site_id = $2
       where asset_id = $1 and status not in ('completed', 'skipped')`,
      [id, toSiteId]
    )
    await c.query(
      `update public.inspections set site_id = $2
       where asset_id = $1 and status <> 'completed'`,
      [id, toSiteId]
    )
    // Schedules too, or the next generated task would be stamped with the
    // old site again.
    await c.query(
      `update public.pm_schedules set site_id = $2
       where asset_id = $1 and deleted_at is null`,
      [id, toSiteId]
    )

    await c.query(
      `insert into public.asset_transfers (org_id, asset_id, from_site_id, to_site_id, reason, transferred_at, transferred_by)
       values (current_org_id(), $1, $2, $3, $4, coalesce($5::date, current_date), current_user_id())`,
      [id, a.site_id, toSiteId, reason || null, transferredAt ?? null]
    )
    await writeAuditLog(c, {
      orgId: a.org_id, actorId, ip, action: 'asset.transfer', entityType: 'asset', entityId: id,
      before: { site_id: a.site_id, site_name: a.from_site_name, status: a.status },
      after: { site_id: toSiteId, site_name: dest[0].name, status: upd[0].status, reason: reason || null, transferred_at: transferredAt ?? null },
    })
    transferred++
  }
  return { data: { transferred, skipped } }
}
