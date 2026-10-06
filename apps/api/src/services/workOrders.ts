import type { PoolClient } from 'pg'
import { WO_TRANSITIONS } from '@assetcore/domain'
import { writeAuditLog } from '../audit.js'
import { refreshAssetHealth } from '../healthService.js'
import { notifyWorkOrderClosed } from '../notify.js'
import { buildSet } from '../sqlUtil.js'
import { lockPart, moveStock } from './stock.js'

// What a work order does when it moves, in one place. Closing a job used to
// happen three ways (the /transition route, a PATCH carrying `status`, and a
// maintenance completion against the job), and only /transition drew the
// parts, resolved the defect, stamped actual_end and refreshed health.

export const WO_SELECT = `
  select w.*,
    (select count(*)::int from public.work_order_tasks t where t.work_order_id = w.id) as task_count,
    (select count(*)::int from public.work_order_tasks t where t.work_order_id = w.id and t.done) as task_done_count,
    (select count(*)::int from public.work_order_parts p where p.work_order_id = w.id) as part_count,
    case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name) end as site,
    case when a.id is null then null else jsonb_build_object('id', a.id, 'ain', a.ain, 'name', a.name) end as asset,
    case when au.id is null then null else jsonb_build_object('id', au.id, 'full_name', au.full_name, 'email', au.email) end as assignee,
    case when cu.id is null then null else jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'email', cu.email) end as creator,
    case when ab.id is null then null else jsonb_build_object('id', ab.id, 'full_name', ab.full_name, 'email', ab.email) end as assigner
  from public.work_orders w
  left join public.sites s on s.id = w.site_id
  left join public.assets a on a.id = w.asset_id
  left join public.users au on au.id = w.assignee_id
  left join public.users cu on cu.id = w.created_by
  left join public.users ab on ab.id = w.assigned_by
`

// Fields the close dialog collects. Its own list so closing a job can never
// quietly rewrite its asset, assignee or priority.
const REPORT_FIELDS = [
  'completion_notes', 'root_cause', 'failure_mode', 'corrective_actions',
  'safety_observations', 'downtime_hours', 'actual_hours', 'cost_cents',
]

const WO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', new: 'New', assigned: 'Assigned', in_progress: 'In Progress',
  awaiting_parts: 'Awaiting Parts', inspection: 'Inspection', closed: 'Closed',
}

// Inserts a work_order_activity row of kind 'assignment' — trg_notify_wo_activity
// (0014_activity_assignment_notifications.sql) reacts to it and fires wo_assigned
// to the new assignee (self-assignment and null-assignee already no-op there).
export async function recordAssignment(c: PoolClient, orgId: string, woId: string, actorId: string, assigneeId: string | null): Promise<void> {
  let body: string
  if (assigneeId) {
    const { rows } = await c.query('select full_name from public.users where id = $1', [assigneeId])
    body = `Assigned to ${rows[0]?.full_name || 'a team member'}.`
  } else {
    body = 'Assignee removed.'
  }
  // Stamp the durable columns as well as the activity row. The feed alone was
  // not enough: notifyWorkOrderClosed() used to reverse-engineer "the assigner"
  // as the newest assignment activity row, but unassignment writes one of those
  // too, so an assign-by-A / unassign-by-B sequence reported B.
  await c.query(
    `update public.work_orders
     set assigned_by = case when $2::uuid is null then null else $3::uuid end,
         assigned_at = case when $2::uuid is null then null else now() end
     where id = $1`,
    [woId, assigneeId, actorId]
  )
  await c.query(
    `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
     values ($1, $2, $3, 'assignment', $4)`,
    [orgId, woId, actorId, body]
  )
}

// `maintenance` is an operational state, not something anyone should hand-pick
// on a form (it was removed from the asset status picker in the same commit
// series). It follows from the work: an asset with a work order actually being
// worked on IS under maintenance, and stops being so when that work ends.
//
// Only ever moves an asset between `operational` and `maintenance`. `offline`
// and `standby` are deliberate operator decisions and are never overridden —
// a decommissioned asset with an open WO stays offline.
async function syncAssetStatusForWorkOrder(c: PoolClient, assetId: string | null, actorId: string): Promise<void> {
  if (!assetId) return

  const { rows: assetRows } = await c.query('select status from public.assets where id = $1 and deleted_at is null', [assetId])
  const current = assetRows[0]?.status
  if (current !== 'operational' && current !== 'maintenance') return

  const { rows: active } = await c.query(
    `select 1 from public.work_orders
     where asset_id = $1 and deleted_at is null and status = 'in_progress' limit 1`,
    [assetId]
  )
  const next = active[0] ? 'maintenance' : 'operational'
  if (next === current) return

  await c.query('update public.assets set status = $2 where id = $1', [assetId, next])
  await c.query(
    `insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
     select org_id, id, $2, 'status_change', $3 from public.assets where id = $1`,
    [assetId, actorId,
     next === 'maintenance'
       ? 'Status set to Under Maintenance — a work order is in progress.'
       : 'Status returned to Operational — no work orders in progress.']
  )
}

type Shortfall = { part_number: string; name: string; needed: number; in_stock: number }

/** Draws every unconsumed part on a work order out of stock, writing one
 * ledger row per part. Every line is checked before anything is written: if
 * any part is short, nothing is drawn and the shortfalls come back, so the
 * caller can refuse the close. (The transaction commits on a returned error,
 * so drawing the parts that were there and then refusing would have left
 * them drawn against a job that stayed open.) */
async function consumeParts(c: PoolClient, workOrderId: string): Promise<{ shortfalls: Shortfall[] }> {
  const { rows: lines } = await c.query(
    `select wp.id, wp.part_id, wp.quantity_required, wp.quantity_used, wp.unit_cost_cents
     from public.work_order_parts wp
     where wp.work_order_id = $1 and wp.consumed_at is null and wp.part_id is not null
     order by wp.part_id`,
    [workOrderId]
  )

  const draws = []
  const needed = new Map<string, number>()
  for (const line of lines) {
    // A job closed without anyone recording usage consumed what it reserved.
    const qty = Number(line.quantity_used) > 0 ? Number(line.quantity_used) : Number(line.quantity_required)
    if (qty <= 0) continue
    const part = await lockPart(c, line.part_id)
    if (!part) continue
    needed.set(part.id, (needed.get(part.id) ?? 0) + qty)
    draws.push({ line, part, qty })
  }

  const shortfalls: Shortfall[] = []
  for (const { part } of draws) {
    const want = needed.get(part.id)!
    if (part.quantity_in_stock < want && !shortfalls.some((s) => s.part_number === part.part_number)) {
      shortfalls.push({ part_number: part.part_number, name: part.name, needed: want, in_stock: part.quantity_in_stock })
    }
  }
  if (shortfalls.length > 0) return { shortfalls }

  for (const { line, part, qty } of draws) {
    const { unitCostCents } = await moveStock(c, part, {
      quantity: -qty, kind: 'consumption', reason: 'Consumed on work order', workOrderId,
      unitCostCents: line.unit_cost_cents ?? part.unit_cost_cents ?? 0,
    })
    await c.query(
      'update public.work_order_parts set consumed_at = now(), quantity_used = $2, unit_cost_cents = $3 where id = $1',
      [line.id, qty, unitCostCents]
    )
  }
  return { shortfalls: [] }
}

type TransitionResult =
  | { data: Record<string, unknown> }
  | { error: 'not_found' }
  | { error: 'invalid_transition'; from: string; to: string }
  | { error: 'insufficient_stock'; shortfalls: Shortfall[] }

/**
 * Moves a work order to `to`, with everything that move means:
 * - the move must be allowed from where the job is (WO_TRANSITIONS);
 * - closing draws its reserved parts out of stock, or is refused with the
 *   shortfalls and nothing written;
 * - starting stamps actual_start once, closing stamps actual_end;
 * - closing resolves the defect the job was raised for, tells whoever raised
 *   and assigned the job, and refreshes the asset's health;
 * - the asset's maintenance status follows, and the move is logged.
 *
 * `report` is the close dialog's completion report, limited to REPORT_FIELDS.
 */
export async function transitionWorkOrder(
  c: PoolClient,
  woId: string,
  to: string,
  { actorId, comment, report }: { actorId: string; comment?: string; report?: Record<string, unknown> }
): Promise<TransitionResult> {
  const { rows: cur } = await c.query(
    'select status, actual_start, asset_id from public.work_orders where id = $1 for update',
    [woId]
  )
  if (!cur[0]) return { error: 'not_found' }
  const allowed: readonly string[] = WO_TRANSITIONS[cur[0].status as keyof typeof WO_TRANSITIONS] ?? []
  if (!allowed.includes(to)) return { error: 'invalid_transition', from: cur[0].status, to }

  // Before the status write, so a shortfall refuses the close with nothing
  // changed.
  if (to === 'closed') {
    const consumed = await consumeParts(c, woId)
    if (consumed.shortfalls.length > 0) return { error: 'insufficient_stock', shortfalls: consumed.shortfalls }
  }

  // Optional completion report, restricted to the report fields.
  const reportPatch = report ? buildSet(report, REPORT_FIELDS, 2) : { setSql: '', values: [] as unknown[] }
  const extra = [
    reportPatch.setSql,
    // Stamp the clock the first time work actually starts, and when it ends.
    to === 'in_progress' && !cur[0].actual_start ? 'actual_start = now()' : '',
    to === 'closed' ? 'actual_end = now()' : '',
  ].filter(Boolean).join(', ')

  const { rows } = await c.query(
    `update public.work_orders
        set status = $2, updated_at = now()${extra ? `, ${extra}` : ''}
      where id = $1 returning id, org_id`,
    [woId, to, ...reportPatch.values]
  )
  const wo = rows[0]

  // Closing the job closes the finding it came from. Without this the defect
  // register slowly fills with items fixed months ago and nobody trusts it —
  // the failure mode a register exists to avoid.
  let resolvedDefects: string[] = []
  if (to === 'closed') {
    const { rows: defects } = await c.query(
      `update public.defects
          set status = 'resolved', resolved_at = now(),
              resolution_notes = coalesce(resolution_notes, $2)
        where work_order_id = $1 and deleted_at is null
          and status not in ('resolved','closed')
        returning ref`,
      [woId, comment || 'Resolved by the work order raised for it.']
    )
    resolvedDefects = defects.map((d: { ref: string }) => d.ref)
  }

  await c.query(
    `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
     values (current_org_id(), $1, current_user_id(), 'status_change', $2)`,
    [woId, comment || `Status changed to ${WO_STATUS_LABEL[to] || to}`]
  )

  await writeAuditLog(c, {
    orgId: wo.org_id, actorId, action: 'wo.transition', entityType: 'work_order', entityId: wo.id,
    before: { status: cur[0].status }, after: { status: to },
  })

  const { rows: full } = await c.query(`${WO_SELECT} where w.id = $1`, [woId])
  const woFull = full[0]

  // Closing a WO is the "done" signal — tell whoever created it and
  // whoever most recently assigned it (they're the ones who were waiting on
  // it, not the assignee who just did the work). Auto-drafted WOs that were
  // never assigned to anyone yield an empty set here — nothing to notify
  // (supervisors were already alerted when it was drafted).
  if (to === 'closed') {
    await notifyWorkOrderClosed(c, {
      orgId: woFull.org_id, woId: woFull.id, ref: woFull.ref, title: woFull.title, actorId,
    })
  }

  await syncAssetStatusForWorkOrder(c, woFull.asset_id, actorId)

  // Closing clears an overdue job and may clear a defect with it, both of
  // which the condition score reads.
  if (to === 'closed') await refreshAssetHealth(c, woFull.asset_id, actorId)

  return { data: { ...woFull, defects_resolved: resolvedDefects } }
}
