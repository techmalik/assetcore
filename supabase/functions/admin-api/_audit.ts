// Append-only platform audit trail. Every mutating admin action calls this.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'
import type { AdminCtx } from './_guard.ts'

type TargetType = 'org' | 'user' | 'invoice' | 'admin' | 'impersonation' | 'note'

interface AuditEntry {
  action: string
  targetType: TargetType
  targetId?: string | null
  orgId?: string | null
  before?: unknown
  after?: unknown
}

export async function writeAudit(ctx: AdminCtx, entry: AuditEntry): Promise<void> {
  const svc: SupabaseClient = ctx.svc
  await svc.from('platform_audit_log').insert({
    actor_id: ctx.user.id,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    org_id: entry.orgId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: ctx.ip || null,
  })
}
