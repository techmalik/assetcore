import type pg from 'pg'

// Thin wrappers over the security-definer SQL helpers added in
// 0014_activity_assignment_notifications.sql. Both run inside the caller's
// existing withOrgContext transaction — the notification lands atomically
// with whatever state change triggered it. See that migration for why these
// need to be security-definer functions rather than plain inserts (the RLS
// pool cannot read another user's notification_preferences row).

type NotifyUsersInput = {
  orgId: string
  userIds: Array<string | null | undefined>
  actorId: string | null | undefined
  kind: string
  title: string
  body: string
  entityType: string
  entityId: string
  dedupePrefix?: string | null
}

/** Notify a specific list of users (deduplicated, self-excluded, preference-checked). */
export async function notifyUsers(c: pg.PoolClient, input: NotifyUsersInput): Promise<number> {
  const ids = input.userIds.filter((id): id is string => Boolean(id))
  if (!ids.length) return 0
  const { rows } = await c.query(
    `select public.notify_users($1, $2::uuid[], $3, $4, $5, $6, $7, $8, $9) as n`,
    [input.orgId, ids, input.actorId ?? null, input.kind, input.title, input.body,
      input.entityType, input.entityId, input.dedupePrefix ?? null]
  )
  return rows[0]?.n ?? 0
}

type NotifyRoleHoldersInput = {
  orgId: string
  siteId: string | null | undefined
  roles: string[]
  actorId: string | null | undefined
  kind: string
  title: string
  body: string
  entityType: string
  entityId: string
  dedupePrefix?: string | null
}

/** Notify every active member holding one of `roles`, site/location-scope filtered. */
export async function notifyRoleHolders(c: pg.PoolClient, input: NotifyRoleHoldersInput): Promise<number> {
  const { rows } = await c.query(
    `select public.notify_role_holders($1, $2, $3::text[], $4, $5, $6, $7, $8, $9, $10) as n`,
    [input.orgId, input.siteId ?? null, input.roles, input.actorId ?? null, input.kind,
      input.title, input.body, input.entityType, input.entityId, input.dedupePrefix ?? null]
  )
  return rows[0]?.n ?? 0
}

/**
 * "Work order closed" feedback: tell whoever created it and whoever most
 * recently assigned it (they're the ones who were waiting on it, not the
 * assignee who just did the work) — shared by both places a WO can close
 * (workOrders.ts's transition endpoint and maintenanceEvents.ts's
 * maintenance-completion flow, which can close a linked WO as a side
 * effect). Both pass the same dedupe prefix, so if a completion closes a WO
 * that's also independently transitioned, the second call is a no-op.
 */
export async function notifyWorkOrderClosed(c: pg.PoolClient, input: {
  orgId: string; woId: string; ref: string; title: string; actorId: string | null | undefined
}): Promise<number> {
  const { rows: created } = await c.query('select created_by from public.work_orders where id = $1', [input.woId])
  const { rows: lastAssign } = await c.query(
    `select user_id from public.work_order_activity
     where work_order_id = $1 and kind = 'assignment' and user_id is not null
     order by created_at desc limit 1`,
    [input.woId]
  )
  return notifyUsers(c, {
    orgId: input.orgId,
    userIds: [created[0]?.created_by, lastAssign[0]?.user_id],
    actorId: input.actorId,
    kind: 'work_completed',
    title: `Work order closed: ${input.ref}`,
    body: input.title,
    entityType: 'work_order',
    entityId: input.woId,
    dedupePrefix: `work_completed:work_order:${input.woId}`,
  })
}
