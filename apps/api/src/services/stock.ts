import type { PoolClient } from 'pg'

type LockedPart = {
  id: string
  org_id: string
  part_number: string
  name: string
  quantity_in_stock: number
  unit_cost_cents: number | null
  deleted_at: Date | null
}

/** Locks a part row for the rest of the transaction, so two moves can't both
 * read the same balance. Null when there is no such part. */
export async function lockPart(c: PoolClient, partId: string): Promise<LockedPart | null> {
  const { rows } = await c.query(
    `select id, org_id, part_number, name, quantity_in_stock, unit_cost_cents, deleted_at
     from public.spare_parts where id = $1 for update`,
    [partId]
  )
  if (!rows[0]) return null
  return { ...rows[0], quantity_in_stock: Number(rows[0].quantity_in_stock) }
}

type StockMove = {
  /** Signed: positive into the store, negative out of it. */
  quantity: number
  kind: string
  reason: string | null
  /** The cost recorded on the ledger row; the part's own cost when absent. */
  unitCostCents?: number | null
  workOrderId?: string | null
}

/**
 * The one place stock changes: writes the part's new balance and one
 * stock_movements row with the balance after it. The part must already be
 * locked (lockPart) in this transaction, and the caller has already checked
 * the balance stays at or above zero.
 */
export async function moveStock(c: PoolClient, part: LockedPart, move: StockMove): Promise<{ balanceAfter: number; unitCostCents: number | null }> {
  const balanceAfter = part.quantity_in_stock + move.quantity
  if (balanceAfter < 0) throw new Error(`stock for part ${part.id} would go below zero`)
  const unitCostCents = move.unitCostCents ?? part.unit_cost_cents ?? null
  await c.query('update public.spare_parts set quantity_in_stock = $2 where id = $1', [part.id, balanceAfter])
  await c.query(
    `insert into public.stock_movements
       (org_id, part_id, kind, quantity, balance_after, unit_cost_cents, reason, work_order_id, actor_id)
     values (current_org_id(), $1, $2, $3, $4, $5, $6, $7, current_user_id())`,
    [part.id, move.kind, move.quantity, balanceAfter, unitCostCents, move.reason, move.workOrderId ?? null]
  )
  part.quantity_in_stock = balanceAfter
  return { balanceAfter, unitCostCents }
}
