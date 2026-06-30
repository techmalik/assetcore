// USD money is stored as integer cents (project convention).
export function money(cents, currency = 'USD') {
  const n = (cents ?? 0) / 100
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
}

export function dollarsToCents(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function date(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function dateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
