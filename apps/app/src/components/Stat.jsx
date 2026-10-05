const TONE_COLOR = { warn: 'var(--sat)', bad: 'var(--srt)' }

/** One figure in a page's stat strip: the value, its label, and an optional
 * line under it. `tone` colours the value when it needs attention. */
export default function Stat({ label, value, hint, tone, size = 20 }) {
  return (
    <div style={{ padding: '12px 16px', borderRight: 'var(--bdr)', flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: size, fontWeight: 500, color: TONE_COLOR[tone] ?? 'var(--n900)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--n400)', marginTop: 1 }}>{hint}</div>}
    </div>
  )
}
