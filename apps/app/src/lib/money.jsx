import { useAuth } from './AuthContext'

/**
 * Single money formatter for the tenant app.
 *
 * Before this existed, Reports and Work Orders rendered ₦ while the asset form
 * was labelled "Asset value (USD)" and the asset detail panel rendered $ — all
 * three reading the same *_cents columns, and the XLSX exports headed them
 * "(NGN)". Same number, three different currencies depending on where you
 * looked.
 *
 * That was fixed by hardcoding NGN. This keeps the fix and removes the
 * hardcoding: the currency now comes from the organisation (0024), because a
 * licensed instance is not necessarily Nigerian. NGN remains the default, so
 * nothing changes for an org that never sets one.
 *
 * Every money column in the schema is integer minor units in the org's BASE
 * currency. The secondary currency is presentation only: a rate somebody typed
 * in, on a date they typed it, shown beside the real figure — never instead of
 * it, and never without saying when it was set.
 */

const SYMBOLS = {
  NGN: '₦', USD: '$', GBP: '£', EUR: '€', JPY: '¥', ZAR: 'R',
  GHS: '₵', KES: 'KSh', XOF: 'CFA', CAD: 'CA$', AUD: 'A$', CNY: 'CN¥',
}

/** The currency in force before an org has configured one. */
export const CURRENCY_CODE = 'NGN'
export const CURRENCY_SYMBOL = SYMBOLS[CURRENCY_CODE]

/** A currency's symbol, or its ISO code when we don't have one — a code is
 * always better than the wrong symbol. */
export function currencySymbol(code) {
  if (!code) return ''
  return SYMBOLS[code] || `${code} `
}

/**
 * Compact display for a cents value: ₦1.2B / ₦4.5M / ₦12,000.
 * `zero` is what to render for null/undefined — pass '—' where a missing
 * figure means "unknown" rather than "nothing".
 */
export function fmtMoney(cents, { zero = '₦0', code = CURRENCY_CODE } = {}) {
  if (cents == null) return zero
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return zero
  const sym = currencySymbol(code)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sign}${sym}${(abs / 1_000_000_000).toFixed(1)}B`
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`
  // Cap at 2: money has two decimal places. A bare toLocaleString() here let a
  // converted figure through at whatever precision the FX multiply produced,
  // which is how a secondary currency rendered as $97,543.333 next to a base
  // figure of ₦150,066,666.67.
  return `${sign}${sym}${abs.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/** Exact, non-abbreviated form for detail views: ₦1,234,567.89 */
export function fmtMoneyExact(cents, { zero = '—', code = CURRENCY_CODE } = {}) {
  if (cents == null) return zero
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return zero
  return `${currencySymbol(code)}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The converted figure in minor units, or null when no second currency is set. */
export function convert(cents, org) {
  if (!org?.secondary_currency || !org?.fx_rate) return null
  if (cents == null) return null
  const n = Number(cents)
  if (!Number.isFinite(n)) return null
  return n * Number(org.fx_rate)
}

/**
 * The formatters bound to this org's currency settings.
 *
 * `money()` and `moneyFull()` return plain strings so they can go anywhere a
 * string goes. `<Money>` is the component to reach for when the converted
 * figure should show too, since that needs two pieces of markup and a tooltip
 * explaining the rate.
 */
export function useMoney() {
  const { org } = useAuth()
  const base = org?.base_currency || CURRENCY_CODE

  return {
    base,
    secondary: org?.secondary_currency || null,
    fxRate: org?.fx_rate ? Number(org.fx_rate) : null,
    fxRateAt: org?.fx_rate_at || null,
    money: (cents) => fmtMoney(cents, { zero: '—', code: base }),
    moneyFull: (cents) => fmtMoneyExact(cents, { code: base }),
    // `full` mirrors the base figure's own formatting: an exact base figure
    // gets an exact conversion, a compact one gets a compact conversion. Left
    // to itself the pair disagreed — ₦150,066,666.67 ($97,543.333) — with the
    // two halves of one line rounded to different numbers of places.
    secondaryOf: (cents, { full = false } = {}) => {
      const converted = convert(cents, org)
      if (converted == null) return null
      return full
        ? fmtMoneyExact(converted, { zero: '—', code: org.secondary_currency })
        : fmtMoney(converted, { zero: '—', code: org.secondary_currency })
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
 * The base figure is always the primary one: it is the number in the database
 * and the number anyone will be held to. The conversion is a courtesy, styled
 * as one.
 */
export function Money({ cents, full = false, style }) {
  const { money, moneyFull, secondaryOf, rateNote } = useMoney()
  const primary = full ? moneyFull(cents) : money(cents)
  const second = secondaryOf(cents, { full })

  if (!second) return <span style={style}>{primary}</span>
  return (
    <span style={style} title={rateNote || undefined}>
      {primary}
      {/* A real space, not just a margin: JSX drops the whitespace between
          these two, leaving one unbreakable run that overflows narrow panels
          instead of wrapping. The conversion itself never breaks apart. */}
      {' '}
      <span style={{ color: 'var(--n400)', fontSize: '0.85em', whiteSpace: 'nowrap' }}>({second})</span>
    </span>
  )
}
