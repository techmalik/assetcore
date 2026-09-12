import { useState } from 'react'

/**
 * Chart primitives, hand-rolled in SVG.
 *
 * No charting library on purpose. This is a licensed on-prem product whose
 * bundle is already 750KB, the shapes needed here are four, and every one of
 * them is twenty lines of maths — a dependency would cost more than it saved
 * and would have to be vendored for air-gapped installs anyway.
 *
 * Everything below is driven by a viewBox rather than pixel sizes, so charts
 * scale with their container, and every colour comes from the design tokens so
 * they follow the dark theme without a second palette.
 */

export const SERIES_COLORS = ['var(--b500)', 'var(--sg)', 'var(--sa)', 'var(--sl)', 'var(--sr)']

/** Shared axis/label type so every chart reads the same at a glance. */
const AXIS_LABEL = { fontSize: 9, fill: 'var(--n500)', fontFamily: 'var(--ff-m)' }

function EmptyChart({ height, message }) {
  return (
    <div style={{
      height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: 'var(--n400)', border: '1px dashed var(--n200)', borderRadius: 6,
    }}>
      {message}
    </div>
  )
}

/** Nice round upper bound, so the axis reads 0/25/50 rather than 0/23/46. */
function niceMax(value) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const scaled = value / magnitude
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  return step * magnitude
}

/**
 * Vertical bars with a value axis.
 *
 * `data`: [{ label, value, color?, sublabel? }]
 */
export function BarChart({ data = [], height = 180, valueFormat = (v) => v, emptyMessage = 'No data yet' }) {
  const [hover, setHover] = useState(null)
  if (data.length === 0) return <EmptyChart height={height} message={emptyMessage} />

  const W = 360
  const H = 140
  const padL = 30
  const padB = 22
  const max = niceMax(Math.max(...data.map((d) => d.value), 0))
  const plotW = W - padL - 6
  const plotH = H - padB - 8
  const slot = plotW / data.length
  const barW = Math.min(slot * 0.62, 42)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
        {[0, 0.5, 1].map((t) => {
          const y = 8 + plotH * (1 - t)
          return (
            <g key={t}>
              <line x1={padL} x2={W - 6} y1={y} y2={y} stroke="var(--n200)" strokeWidth="1" />
              <text x={padL - 5} y={y + 3} textAnchor="end" {...AXIS_LABEL}>{valueFormat(Math.round(max * t))}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const barH = max === 0 ? 0 : (d.value / max) * plotH
          const x = padL + slot * i + (slot - barW) / 2
          const y = 8 + plotH - barH
          return (
            <g key={d.label + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* A full-height hit area, so a bar of height 2 is still hoverable. */}
              <rect x={padL + slot * i} y={8} width={slot} height={plotH} fill="transparent" />
              <rect x={x} y={y} width={barW} height={Math.max(barH, d.value > 0 ? 2 : 0)} rx="2"
                fill={d.color || 'var(--b500)'} opacity={hover == null || hover === i ? 1 : 0.45} />
              <text x={padL + slot * i + slot / 2} y={H - padB + 14} textAnchor="middle" {...AXIS_LABEL}>{d.label}</text>
              <title>{`${d.label}: ${valueFormat(d.value)}`}</title>
            </g>
          )
        })}
      </svg>
      {hover != null && (
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--n600)', marginTop: 2 }}>
          <strong style={{ color: 'var(--n900)' }}>{valueFormat(data[hover].value)}</strong>
          {' '}{data[hover].sublabel || data[hover].label}
        </div>
      )}
    </div>
  )
}

/**
 * One or more lines over a shared x axis.
 *
 * `series`: [{ name, color, values: number[] }], `labels`: string[]
 */
export function LineChart({ series = [], labels = [], height = 200, area = false, valueFormat = (v) => Math.round(v), emptyMessage = 'No data yet' }) {
  const hasPoints = series.some((s) => s.values.length > 0)
  if (!hasPoints) return <EmptyChart height={height} message={emptyMessage} />

  const W = 420
  const H = 150
  const padL = 28
  const padB = 20
  const plotW = W - padL - 8
  const plotH = H - padB - 10
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 0))
  const n = Math.max(...series.map((s) => s.values.length))
  // One point is a dot, not a line — place it mid-plot rather than at x=0.
  const stepX = n > 1 ? plotW / (n - 1) : 0
  const pointAt = (i, v) => [
    padL + (n > 1 ? stepX * i : plotW / 2),
    10 + plotH - (max === 0 ? 0 : (v / max) * plotH),
  ]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} style={{ display: 'block', overflow: 'visible' }}>
        {[0, 0.5, 1].map((t) => {
          const y = 10 + plotH * (1 - t)
          return (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="var(--n200)" strokeWidth="1" />
              <text x={padL - 5} y={y + 3} textAnchor="end" {...AXIS_LABEL}>{valueFormat(max * t)}</text>
            </g>
          )
        })}

        {series.map((s, si) => {
          const pts = s.values.map((v, i) => pointAt(i, v))
          const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
          const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length]
          return (
            <g key={s.name}>
              {area && pts.length > 1 && (
                <path d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${10 + plotH} L${pts[0][0].toFixed(1)},${10 + plotH} Z`}
                  fill={color} opacity="0.10" />
              )}
              <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={pts.length > 18 ? 1.6 : 2.6} fill={color}>
                  <title>{`${s.name} — ${labels[i] ?? i}: ${valueFormat(s.values[i])}`}</title>
                </circle>
              ))}
            </g>
          )
        })}

        {labels.map((label, i) => {
          // Thin the axis out rather than letting labels collide.
          const every = Math.ceil(labels.length / 6)
          if (i % every !== 0 && i !== labels.length - 1) return null
          const [x] = pointAt(i, 0)
          return <text key={label + i} x={x} y={H - padB + 13} textAnchor="middle" {...AXIS_LABEL}>{label}</text>
        })}
      </svg>

      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          {series.map((s, si) => (
            <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--n600)' }}>
              <span style={{ width: 9, height: 3, borderRadius: 2, background: s.color || SERIES_COLORS[si % SERIES_COLORS.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A ring, for a handful of mutually exclusive categories.
 *
 * Deliberately capped at six slices: past that a donut stops being readable and
 * a bar chart is the honest choice.
 */
export function Donut({ segments = [], size = 132, thickness = 16, centreLabel, centreValue, emptyMessage = 'No data yet' }) {
  const [hover, setHover] = useState(null)
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return <EmptyChart height={size} message={emptyMessage} />

  const r = (size - thickness) / 2
  const circumference = 2 * Math.PI * r
  let offset = 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segments.map((s, i) => {
              const length = (s.value / total) * circumference
              const dash = `${length} ${circumference - length}`
              const el = (
                <circle key={s.label} cx={size / 2} cy={size / 2} r={r}
                  fill="none" stroke={s.color || SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={thickness} strokeDasharray={dash} strokeDashoffset={-offset}
                  opacity={hover == null || hover === i ? 1 : 0.4}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <title>{`${s.label}: ${s.value}`}</title>
                </circle>
              )
              offset += length
              return el
            })}
          </g>
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ fontFamily: 'var(--ff-m)', fontSize: 20, fontWeight: 500, color: 'var(--n900)' }}>
            {hover == null ? (centreValue ?? total) : segments[hover].value}
          </span>
          <span style={{ fontSize: 10.5, color: 'var(--n500)', textAlign: 'center', maxWidth: size - thickness * 2 }}>
            {hover == null ? (centreLabel ?? 'total') : segments[hover].label}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {segments.map((s, i) => (
          <span key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--n700)', cursor: 'default' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color || SERIES_COLORS[i % SERIES_COLORS.length], flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{s.label}</span>
            <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11.5, color: 'var(--n800)' }}>{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * A single horizontal bar split into segments — the shape for backlog by age,
 * where the whole is one population and the question is how it splits.
 */
export function StackedBar({ segments = [], height = 26, emptyMessage = 'Nothing outstanding' }) {
  const [hover, setHover] = useState(null)
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return <EmptyChart height={height + 12} message={emptyMessage} />

  return (
    <div>
      <div style={{ display: 'flex', height, borderRadius: 4, overflow: 'hidden', border: 'var(--bdr)' }}>
        {segments.filter((s) => s.value > 0).map((s, i) => (
          <div key={s.label} title={`${s.label}: ${s.value}`}
            onMouseEnter={() => setHover(s.label)} onMouseLeave={() => setHover(null)}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: hover == null || hover === s.label ? 1 : 0.5,
              transition: 'opacity .12s',
            }}>
            <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: '#fff' }}>
              {(s.value / total) > 0.08 ? s.value : ''}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        {segments.map((s, i) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--n600)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {s.label}
            <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--n800)' }}>{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
