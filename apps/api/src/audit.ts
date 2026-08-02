import type { PoolClient } from 'pg'
import { ownerPool } from './db.js'

type OrgAuditEntry = {
  orgId: string
  actorId: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
  ip?: string | null
}

/** Appends to the per-org audit_log. Pass the request's transaction client so
 * the audit row commits atomically with the mutation it's recording. */
export async function writeAuditLog(client: PoolClient, entry: OrgAuditEntry): Promise<void> {
  // entity_label is resolved inline by the same SQL function the 0018 backfill
  // uses, so there is one implementation and no extra round trip. It is a
  // SNAPSHOT: the log keeps reading correctly after the thing is renamed,
  // archived, or hard-deleted (asset_categories are hard-deleted, and their
  // name is destroyed exactly when the delete entry becomes interesting).
  await client.query(
    `insert into public.audit_log (org_id, actor_id, action, entity_type, entity_id, before, after, ip, entity_label)
     values ($1, $2, $3, $4, $5, $6, $7, $8,
             public.resolve_audit_label($1, $4, $5, $6, $7))`,
    [
      entry.orgId,
      entry.actorId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.ip ?? null,
    ]
  )
}

type PlatformAuditEntry = {
  actorId: string | null
  action: string
  targetType: 'org' | 'user' | 'invoice' | 'admin' | 'impersonation' | 'note' | 'licence'
  targetId?: string | null
  orgId?: string | null
  before?: unknown
  after?: unknown
  ip?: string | null
}

/** Appends to platform_audit_log via the owner pool — this table has no
 * RLS-pool write policy, matching the old service-role-only write path. */
export async function writePlatformAuditLog(entry: PlatformAuditEntry): Promise<void> {
  await ownerPool.query(
    `insert into public.platform_audit_log (actor_id, action, target_type, target_id, org_id, before, after, ip)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      entry.orgId ?? null,
      entry.before ? JSON.stringify(entry.before) : null,
      entry.after ? JSON.stringify(entry.after) : null,
      entry.ip ?? null,
    ]
  )
}
