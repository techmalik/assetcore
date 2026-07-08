/** Builds a `col = $2, col2 = $3, ...` fragment from only the keys present in
 * `patch` that are also in `allowed` — used for partial PATCH updates so an
 * omitted field is left untouched rather than overwritten with null.
 * `leadingParams` shifts placeholder numbering past params already bound
 * ahead of these (default 1, for the common `where id = $1` case — pass 0
 * when there's no leading id param, e.g. `where id = current_org_id()`). */
export function buildSet(
  patch: Record<string, unknown>,
  allowed: string[],
  leadingParams = 1
): { setSql: string; values: unknown[] } {
  const cols = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined)
  const setSql = cols.map((c, i) => `${c} = $${i + 1 + leadingParams}`).join(', ')
  const values = cols.map((c) => patch[c])
  return { setSql, values }
}

/** Builds `(colA, colB)` / `($1, $2)` fragments for an INSERT from only the
 * keys present in `data` that are also in `allowed`, keeping column order and
 * value order in lockstep (unlike recomputing each independently). `leadingParams`
 * shifts placeholder numbering past any params already bound ahead of these
 * (e.g. `values (current_org_id(), $1, $2...)` needs no shift; pass 1+ if a
 * literal placeholder like an id precedes these values). */
export function buildInsert(
  data: Record<string, unknown>,
  allowed: string[],
  leadingParams = 0
): { columns: string; placeholders: string; values: unknown[] } {
  const cols = Object.keys(data).filter((k) => allowed.includes(k) && data[k] !== undefined)
  const columns = cols.join(', ')
  const placeholders = cols.map((_, i) => `$${i + 1 + leadingParams}`).join(', ')
  const values = cols.map((c) => data[c])
  return { columns, placeholders, values }
}
