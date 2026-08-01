// Single money formatter for the tenant app.
//
// Before this existed, Reports and Work Orders rendered ₦ while the asset form
// was labelled "Asset value (USD)" and the asset detail panel rendered $ — all
// three reading the same *_cents columns, and the XLSX exports headed them
// "(NGN)". Same number, three different currencies depending on where you
// looked. NGN wins because the database, the reports and the work-order costs
// already assume it; only the asset UI disagreed.

export const CURRENCY_SYMBOL = '₦'
export const CURRENCY_CODE = 'NGN'

/**
 * Compact display for a cents value: ₦1.2B / ₦4.5M / ₦12,000.
 * `zero` is what to render for null/undefined — pass '—' where a missing
 * figure means "unknown" rather than "nothing".
 */
export function fmtMoney(cents, { zero = '₦0' } = {}) {
  if (cents == null) return zero
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return zero
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sign}${CURRENCY_SYMBOL}${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${sign}${CURRENCY_SYMBOL}${(abs / 1_000_000).toFixed(1)}M`
  return `${sign}${CURRENCY_SYMBOL}${abs.toLocaleString()}`
}

/** Exact, non-abbreviated form for detail views: ₦1,234,567.89 */
export function fmtMoneyExact(cents, { zero = '—' } = {}) {
  if (cents == null) return zero
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return zero
  return `${CURRENCY_SYMBOL}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
