// Dates as the app shows and sends them. All local time, all en-GB.
//
// "Today" used to be new Date().toISOString().slice(0, 10) in most places,
// which is the UTC date: for the first hour after midnight in Lagos it is still
// yesterday, so a default date, an overdue check or the week view was a day
// behind. Two screens had already switched to the local date by hand. Seven
// pages also kept their own identical fmtDate.

const pad = (n) => String(n).padStart(2, '0')
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** A Date as 'YYYY-MM-DD' on the local calendar. */
export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 'YYYY-MM-DD' as a local Date at midnight. new Date('2026-10-05') would be
 * UTC midnight, a different calendar day west of Greenwich. */
export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Today's date, local: 'YYYY-MM-DD'. */
export function todayISO() {
  return toISODate(new Date())
}

/** 'YYYY-MM-DD' moved by `n` days (negative goes back). */
export function addDaysISO(iso, n) {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

const asDate = (v) => (typeof v === 'string' && DATE_ONLY.test(v) ? parseISODate(v) : new Date(v))

/** '5 Oct 26', or a dash when there is no date. */
export function fmtDate(v) {
  if (!v) return '—'
  return asDate(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

/** '5 Oct 2026', or a dash. */
export function fmtDateLong(v) {
  if (!v) return '—'
  return asDate(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** '5 Oct, 14:30', or `empty` when there is no timestamp. */
export function fmtDateTime(ts, empty = '—') {
  if (!ts) return empty
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
