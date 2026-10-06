import type { PoolClient } from 'pg'
import { writeAuditLog } from '../audit.js'
import { refreshAssetHealth } from '../healthService.js'
import { buildInsert } from '../sqlUtil.js'
import { nextRef } from '../refs.js'

/** The defect columns a caller may set. reported_by, ref and the work order
 * link are set by the system. */
export const DEFECT_ALLOWED = [
  'asset_id', 'site_id', 'inspection_id', 'title', 'description', 'severity', 'status',
  'category', 'assigned_to', 'identified_date', 'due_date', 'resolution_notes',
]

/**
 * Records a defect: the next DEF ref, the row, a rescore of its asset (a new
 * defect changes the asset's health at once, which is why the register feeds
 * the score), and the defect.create audit row. Used by POST /defects and by
 * raising a defect from an audit finding, which used to insert its own copy
 * without the rescore or the audit row.
 */
export async function createDefect(
  c: PoolClient, input: Record<string, unknown>, actorId: string, ip: string | null = null
): Promise<{ id: string; org_id: string; asset_id: string | null; ref: string }> {
  const { columns, placeholders, values } = buildInsert(input, DEFECT_ALLOWED, 1)
  const ref = await nextRef(c, 'DEF')
  const { rows } = await c.query(
    `insert into public.defects (org_id, reported_by, ref${columns ? `, ${columns}` : ''})
     values (current_org_id(), current_user_id(), $1${placeholders ? `, ${placeholders}` : ''})
     returning id, org_id, asset_id, ref`,
    [ref, ...values]
  )
  const created = rows[0]
  await refreshAssetHealth(c, created.asset_id)
  await writeAuditLog(c, {
    orgId: created.org_id, actorId, ip, action: 'defect.create',
    entityType: 'defect', entityId: created.id, after: { ref, ...input },
  })
  return created
}
