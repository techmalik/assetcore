import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import AssetMap from '../components/AssetMap.jsx'
import { BarChart, LineChart, Donut, StackedBar, SERIES_COLORS } from '../components/Charts.jsx'
import {
  getKpis, getWorkOrderTrend, getWorkOrderMix, getWorstAssets, getAssetMap,
} from '../lib/db/analytics'
import { useMoney } from '../lib/money'
import { errorText } from '../lib/errors'

const MONTH_LABEL = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

const STATUS_LABEL = {
  new: 'New', assigned: 'Assigned', in_progress: 'In progress',
  awaiting_parts: 'Awaiting parts', inspection: 'Inspection',
}
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
const PRIORITY_COLOR = { critical: 'var(--sr)', high: 'var(--sa)', medium: 'var(--b500)', low: 'var(--n300)' }
const TYPE_LABEL = { corrective: 'Corrective', preventive: 'Preventive', inspection: 'Inspection', emergency: 'Emergency' }

const BACKLOG_COLOR = ['var(--sg)', 'var(--b500)', 'var(--sa)', 'var(--sr)']

const WINDOWS = [
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['365', 'Last 12 months'],
]

function windowFrom(days) {
  const to = new Date()
  const from = new Date(to.getTime() - Number(days) * 24 * 3600 * 1000)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

/**
 * A headline figure with the sentence that stops it being quoted out of
 * context. Every KPI here carries its own denominator: the note is not
 * decoration, it is the part that makes the number safe to repeat.
 */
function Kpi({ label, value, unit, note, tone }) {
  const color = tone === 'bad' ? 'var(--srt)' : tone === 'warn' ? 'var(--sat)' : 'var(--n900)'
  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '16px 18px', flex: 1, minWidth: 210 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, margin: '8px 0 6px' }}>
        <span style={{ fontFamily: 'var(--ff-m)', fontSize: 26, fontWeight: 500, color: value == null ? 'var(--n400)' : color }}>
          {value == null ? 'Not known' : value}
        </span>
        {value != null && unit && <span style={{ fontSize: 12.5, color: 'var(--n500)' }}>{unit}</span>}
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.55 }}>{note}</p>
    </div>
  )
}

function Panel({ title, subtitle, children, action }) {
  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--n900)' }}>{title}</div>
          {subtitle && <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 3, lineHeight: 1.55 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function Analytics({ dark, toggleDark }) {
  const nav = useNavigate()
  const { money } = useMoney()

  const [tab, setTab] = useState('performance')
  const [days, setDays] = useState('90')
  const [kpis, setKpis] = useState(null)
  const [trend, setTrend] = useState([])
  const [mix, setMix] = useState(null)
  const [worst, setWorst] = useState([])
  const [map, setMap] = useState(null)
  const [colourBy, setColourBy] = useState('status')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { from, to } = windowFrom(days)
      const [k, t, m, w, mp] = await Promise.all([
        getKpis({ from, to }), getWorkOrderTrend(12), getWorkOrderMix(),
        getWorstAssets(8), getAssetMap(),
      ])
      setKpis(k); setTrend(t); setMix(m); setWorst(w); setMap(mp)
    } catch (ex) {
      setError(errorText(ex, 'Could not load the analytics.'))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const backlogSegments = (kpis?.backlog || []).map((b, i) => ({
    label: b.label, value: b.count, color: BACKLOG_COLOR[i],
  }))
  const oldest = (kpis?.backlog || []).filter((b) => b.count > 0).pop()

  return (
    <div className="app-shell">
      <Sidebar active="analytics" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Analytics" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 0', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Analytics</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>Reliability, backlog and where the work is</p>
              </div>
              <div style={{ flex: 1 }} />
              {tab === 'performance' && (
                <select className="input" value={days} onChange={(e) => setDays(e.target.value)} style={{ height: 32, fontSize: 12.5, width: 160 }}>
                  {WINDOWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </div>
            <div style={{ display: 'flex' }}>
              {[{ k: 'performance', l: 'Performance' }, { k: 'map', l: 'Map' }].map((t) => (
                <button key={t.k} className={`tab-btn${tab === t.k ? ' active' : ''}`} onClick={() => setTab(t.k)}>{t.l}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Working the numbers out…</div>
            ) : error ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
              </div>
            ) : tab === 'map' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
                <Panel
                  title="Asset locations"
                  subtitle="Click an asset to open its record."
                  action={
                    <select className="input" value={colourBy} onChange={(e) => setColourBy(e.target.value)} style={{ height: 30, fontSize: 12, width: 170 }}>
                      <option value="status">Colour by condition</option>
                      <option value="health">Colour by score</option>
                      <option value="work">Colour by open work</option>
                    </select>
                  }
                >
                  <AssetMap
                    assets={map?.assets || []}
                    unplaced={map?.unplaced || 0}
                    colourBy={colourBy}
                    onSelect={(a) => nav(`/assets?focus=${a.ain}`)}
                  />
                </Panel>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <Kpi
                    label="MTBF"
                    value={kpis?.mtbf.hours == null ? null : kpis.mtbf.hours.toLocaleString()}
                    unit="operating hours"
                    note={kpis?.mtbf.note}
                  />
                  <Kpi
                    label="MTTR"
                    value={kpis?.mttr.hours == null ? null : kpis.mttr.hours}
                    unit="hours per repair"
                    note={kpis?.mttr.note}
                  />
                  <Kpi
                    label="Availability"
                    value={kpis?.mtbf.availability_percent == null ? null : kpis.mtbf.availability_percent}
                    unit="%"
                    tone={kpis?.mtbf.availability_percent != null && kpis.mtbf.availability_percent < 90 ? 'warn' : undefined}
                    note={`Calendar hours less recorded downtime, across ${kpis?.assets_in_service ?? 0} asset${kpis?.assets_in_service === 1 ? '' : 's'} in service.`}
                  />
                  <Kpi
                    label="Open backlog"
                    value={kpis?.backlog_total ?? 0}
                    unit="jobs"
                    tone={oldest && oldest.key === 'over_90' ? 'bad' : undefined}
                    note={oldest
                      ? `Oldest has been open ${oldest.oldest_days} days.`
                      : 'Nothing is outstanding.'}
                  />
                </div>

                <Panel
                  title="Backlog by age"
                  subtitle="A backlog of forty is a different problem depending on whether it is forty jobs from last week or four from last year."
                >
                  <StackedBar segments={backlogSegments} />
                  {(kpis?.backlog || []).some((b) => b.critical > 0) && (
                    <p style={{ fontSize: 11.5, color: 'var(--srt)', marginTop: 10 }}>
                      {kpis.backlog.filter((b) => b.critical > 0)
                        .map((b) => `${b.critical} critical in ${b.label.toLowerCase()}`).join(' · ')}
                    </p>
                  )}
                </Panel>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
                  <Panel title="Raised against closed" subtitle="Last 12 months. A gap that stays open is a backlog forming.">
                    <LineChart
                      area
                      labels={trend.map((r) => MONTH_LABEL(r.month))}
                      series={[
                        { name: 'Raised', color: SERIES_COLORS[0], values: trend.map((r) => r.raised) },
                        { name: 'Closed', color: 'var(--sg)', values: trend.map((r) => r.closed) },
                        { name: 'Failures', color: 'var(--sr)', values: trend.map((r) => r.failures) },
                      ]}
                    />
                  </Panel>

                  <Panel title="Open work by status">
                    <Donut
                      centreLabel="open jobs"
                      segments={(mix?.by_status || []).map((s) => ({ label: STATUS_LABEL[s.key] || s.key, value: s.n }))}
                      emptyMessage="No open work orders"
                    />
                  </Panel>

                  <Panel title="Open work by priority">
                    <BarChart
                      height={170}
                      data={(mix?.by_priority || []).map((p) => ({
                        label: PRIORITY_LABEL[p.key] || p.key,
                        value: p.n,
                        color: PRIORITY_COLOR[p.key],
                        sublabel: `${PRIORITY_LABEL[p.key] || p.key} priority`,
                      }))}
                      emptyMessage="No open work orders"
                    />
                  </Panel>

                  <Panel title="Work raised by type" subtitle="Last 12 months. A corrective share that climbs is maintenance losing ground.">
                    <Donut
                      centreLabel="jobs raised"
                      segments={(mix?.by_type || []).map((t) => ({ label: TYPE_LABEL[t.key] || t.key, value: t.n }))}
                      emptyMessage="No work orders in the last year"
                    />
                  </Panel>
                </div>

                <Panel
                  title="Assets taking the most attention"
                  subtitle="Ranked by how often they fail, not by spend — a pump that fails monthly is a worse problem than one expensive rebuild, and a cost ranking hides it."
                >
                  {worst.length === 0 ? (
                    <p style={{ fontSize: 12.5, color: 'var(--n400)' }}>No corrective work has been raised in the last year.</p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: 'var(--bdr)' }}>
                          {['Asset', 'Failures', 'Downtime', 'Spend', 'Score'].map((h) => (
                            <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Asset' ? 'left' : 'right', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {worst.map((a) => (
                          <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer' }}
                            onClick={() => nav(`/assets?focus=${a.ain}`)}>
                            <td style={{ padding: '9px 10px' }}>
                              <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{a.ain}</span>
                              <span style={{ fontSize: 12.5, color: 'var(--n800)', marginLeft: 8 }}>{a.name}</span>
                            </td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 12, color: 'var(--n900)' }}>{a.failures}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 11.5, color: 'var(--n600)' }}>{Math.round(a.downtime_hours)}h</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 11.5, color: 'var(--n600)' }}>{money(a.cost_cents)}</td>
                            <td style={{ padding: '9px 10px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 11.5, color: a.health_score == null ? 'var(--n400)' : a.health_score < 40 ? 'var(--srt)' : a.health_score < 70 ? 'var(--sat)' : 'var(--sgt)' }}>
                              {a.health_score ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
