import type { PoolClient } from 'pg'

// Human-readable references: WO-, DEF-, RSK- and AUD-{year}-{0001}. Each comes
// from a per-org, per-year counter advanced under a row lock (0011 for work
// orders, 0031 for the rest), so two creates at the same moment can never
// draw the same number, and site scope cannot hide numbers already taken.
// Run on the request's own transaction client.

export async function nextWoRef(c: PoolClient): Promise<string> {
  const { rows } = await c.query('select public.next_wo_ref(current_org_id()) as ref')
  return rows[0].ref
}

export async function nextRef(c: PoolClient, prefix: 'DEF' | 'RSK' | 'AUD'): Promise<string> {
  const { rows } = await c.query('select public.next_ref(current_org_id(), $1) as ref', [prefix])
  return rows[0].ref
}
