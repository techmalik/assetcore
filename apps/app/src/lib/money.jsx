import { useAuth } from './AuthContext'

/**
 * Money formatting, in one place.
 *
 * Every money column in the schema is integer minor units in the org's base
 * currency. The secondary currency is presentation only: a rate somebody typed
 * in, on a date they typed it, shown beside the real figure — never instead of
 * it, and never without saying when it was set.
 *
 * Until Phase 4 each page carried its own naira() with slightly different
 * rounding, which is how two screens end up disagreeing about the same number.
 */

const SYMBOLS = {
  NGN: '₦', USD: '$', GBP: '£', EUR: '€', JPY: '¥', ZAR: 'R',
  GHS: '₵', KES: 'KSh', XOF: 'CFA', CAD: 'CA$', AUD: 'A$', CNY: 'CN¥',
}

/** A currency's symbol, or its ISO code when we don't have one — a code is
 * always better than the wrong symbol. */
export function currencySymbol(code) {
  if (!code) return ''
  return SYMBOLS[code] || `${code} `
}

/** Short form for tables and tiles: ₦28.8M. Loses precision on purpose. */
export function formatCompact(cents, code = 'NGN') {
  if (cents === null || cents === undefined || cents === '') return '—'
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return '—'
  const sym = currencySymbol(code)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sign}${sym}${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${sign}${sym}${Math.round(abs / 1_000)}k`
  return `${sign}${sym}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

/** Every digit, for forms and anywhere a figure is checked rather than skimmed. */
export function formatFull(cents, code = 'NGN') {
  if (cents === null || cents === undefined || cents === '') return '—'
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return '—'
  return `${currencySymbol(code)}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The converted figure, or null when the org has not set a second currency. */
export function convert(cents, org) {
  if (!org?.secondary_currency || !org?.fx_rate) return null
  if (cents === null || cents === undefined || cents === '') return null
  const n = Number(cents)
  if (!Number.isFinite(n)) return null
  return n * Number(org.fx_rate)
}

/**
 * The formatters the pages use, bound to this org's currency settings.
 *
 * `money()` and `moneyFull()` return plain strings so they can go anywhere a
 * string goes. `<Money>` is the component to reach for when the converted
 * figure should be shown too, since that needs two pieces of markup and a
 * tooltip explaining the rate.
 */
export function useMoney() {
  const { org } = useAuth()
  const base = org?.base_currency || 'NGN'

  return {
    base,
    secondary: org?.secondary_currency || null,
    fxRate: org?.fx_rate ? Number(org.fx_rate) : null,
    fxRateAt: org?.fx_rate_at || null,
    money: (cents) => formatCompact(cents, base),
    moneyFull: (cents) => formatFull(cents, base),
    /** The secondary figure as a string, or null. */
    secondaryOf: (cents) => {
      const converted = convert(cents, org)
      return converted == null ? null : formatCompact(converted, org.secondary_currency)
    },
    /** What the tooltip says, so nobody mistakes the conversion for live FX. */
    rateNote: org?.secondary_currency && org?.fx_rate
      ? `Converted at ${Number(org.fx_rate)} ${org.secondary_currency} per ${base}`
        + `${org.fx_rate_at ? `, rate set ${org.fx_rate_at}` : ''}`
      : null,
  }
}

/**
 * A figure in the org's base currency, with the secondary beside it when one
 * is configured.
 *
 * The base figure is always the larger, primary one: it is the number in the
 * database and the number anyone will be held to. The conversion is a
 * courtesy, styled as one.
 */
export function Money({ cents, full = false, style }) {
  const { money, moneyFull, secondaryOf, rateNote } = useMoney()
  const primary = full ? moneyFull(cents) : money(cents)
  const second = secondaryOf(cents)

  if (!second) return <span style={style}>{primary}</span>
  return (
    <span style={style} title={rateNote || undefined}>
      {primary}
      <span style={{ color: 'var(--n400)', fontSize: '0.85em', marginLeft: 5 }}>({second})</span>
    </span>
  )
}
