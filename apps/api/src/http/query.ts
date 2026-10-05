import { z } from 'zod'

/**
 * A list endpoint's query string: `limit` (1-500, default per route) and
 * `offset` (default 0) plus the route's own filters. Several lists took any
 * limit, so a negative one reached SQL (a 500) and a huge one returned the
 * whole table.
 */
export function listQuery<S extends z.ZodRawShape>(shape: S, defaultLimit = 100) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(500).default(defaultLimit),
    offset: z.coerce.number().int().min(0).default(0),
    ...shape,
  })
}

/** Builds a `where` clause with numbered placeholders: each `$?` in a clause
 * takes the next number as its value is bound. */
export class Where {
  clauses: string[] = []
  params: unknown[] = []
  add(sql: string, ...values: unknown[]) {
    let out = sql
    for (const v of values) {
      this.params.push(v)
      out = out.replace('$?', `$${this.params.length}`)
    }
    this.clauses.push(out)
  }
  get sql() {
    return this.clauses.length ? `where ${this.clauses.join(' and ')}` : ''
  }
}
