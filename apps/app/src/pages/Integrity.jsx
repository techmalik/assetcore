import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import IntegrityTabs from '../components/IntegrityTabs.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { useLocationFilter } from '../lib/LocationFilterContext'
import { getIntegrityOverview, INTEGRITY_STATUS_META, INTEGRITY_STATUSES } from '../lib/db/integrity'
import { BAND_META, bandOf } from '../lib/db/risks'
import { RATING_LABEL } from '../lib/db/inspections'
import { errorText } from '../lib/errors'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function Pill({ meta, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, border: `1px solid ${meta.br}`, background: meta.bg, color: meta.c, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

/** A small panel of counts that links to the module behind them. */
function Panel({ title, action, onAction, children }) {
  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, boxShadow: 'var(--sh-sm)', padding: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)' }}>{title}</div>
        {action && <button onClick={onAction} style={{ border: 'none', background: 'none', fontSize: 12.5, color: 'var(--b600)', fontWeight: 500, cursor: 'pointer', padding: 0 }}>{action} →</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8 }}>{children}</div>
    </div>
  )
}

function Figure({ label, value, color }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--n50)', borderRadius: 6, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: 20, fontWeight: 500, color: color || 'var(--n900)' }}>{value ?? '—'}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function Integrity({ dark, toggleDark }) {
  const nav = useNavigate()
  const { roleKey, extraCaps } = useAuth()
  const canInspections = can(roleKey, 'inspection:read', extraCaps)
  const canRisks = can(roleKey, 'risk:read', extraCaps)
  const canDefects = can(roleKey, 'defect:read', extraCaps)
  const { locationId, locations } = useLocationFilter()
  const location = locations.find((l) => l.id === locationId)

  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    setData(null); setErr('')
    getIntegrityOverview({ locationId }).then(setData).catch((e) => setErr(errorText(e, 'Could not load the integrity overview.')))
  }, [locationId])

  const rows = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    const rank = Object.fromEntries(INTEGRITY_STATUSES.map((s, i) => [s, i]))
    return data.assets
      .filter((a) => !statusFilter || a.integrity_status === statusFilter)
      .filter((a) => !needle || `${a.ain} ${a.name} ${a.site?.name || ''}`.toLowerCase().includes(needle))
      // Worst first: this list exists to say where to look.
      .sort((a, b) => rank[a.integrity_status] - rank[b.integrity_status] || a.ain.localeCompare(b.ain))
  }, [data, statusFilter, q])

  const total = data?.assets.length ?? 0

  return (
    <div className="app-shell">
      <Sidebar active="integrity" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Integrity" dark={dark} toggleDark={toggleDark} />
        <IntegrityTabs active="overview" />
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div className="page-header" style={{ marginBottom: 18, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 24, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Integrity</h1>
              <p style={{ fontSize: 13, color: 'var(--n500)', marginTop: 3 }}>
                The condition of every asset, from what inspections found and what the risk register says{location ? ` · ${location.name}` : ''}
              </p>
            </div>
            <div style={{ flex: 1 }} />
            {canInspections && <button className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 13 }} onClick={() => nav('/inspections')}>Inspections</button>}
            {canRisks && <button className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 13 }} onClick={() => nav('/risks')}>Risk register</button>}
          </div>

          {err && <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--srt)' }}>{err}</div>}

          {/* Status distribution — each tile filters the table below. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            {INTEGRITY_STATUSES.map((s) => {
              const m = INTEGRITY_STATUS_META[s]
              const n = data?.counts[s] ?? null
              const on = statusFilter === s
              return (
                <button key={s} className="stat-card" onClick={() => setStatusFilter(on ? '' : s)} aria-pressed={on} title={m.desc}
                  style={{ '--accent': m.solid, cursor: 'pointer', outline: on ? `2px solid ${m.solid}` : 'none', outlineOffset: -1 }}>
                  <div className="stat-card-label">{m.label}</div>
                  <div className="stat-card-value">{n ?? '—'}</div>
                  <div className="stat-card-sub">{n != null && total ? `${Math.round((n / total) * 100)}% of assets` : m.desc}</div>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
            {canInspections && (
              <Panel title="Inspections" action="Open" onAction={() => nav('/inspections')}>
                <Figure label="Overdue" value={data?.inspections?.overdue} color={data?.inspections?.overdue > 0 ? 'var(--srt)' : undefined} />
                <Figure label="In progress / due" value={data?.inspections?.in_progress} />
                <Figure label="Scheduled" value={data?.inspections?.scheduled} />
                <Figure label="Done, 90 days" value={data?.inspections?.completed_90d} />
                <Figure label="Avg condition (1–5)" value={data?.inspections?.avg_condition ?? (data ? '—' : null)} />
              </Panel>
            )}
            {canRisks && (
              <Panel title="Open risks" action="Open" onAction={() => nav('/risks')}>
                {['extreme', 'high', 'medium', 'low'].map((b) => (
                  <Figure key={b} label={BAND_META[b].label} value={data?.risks?.[b]} color={data?.risks?.[b] > 0 ? BAND_META[b].c : undefined} />
                ))}
                <Figure label="Review overdue" value={data?.risks?.review_overdue} color={data?.risks?.review_overdue > 0 ? 'var(--sat)' : undefined} />
              </Panel>
            )}
            {canDefects && (
              <Panel title="Open defects" action="Open" onAction={() => nav('/defects')}>
                <Figure label="Critical" value={data?.defects?.critical} color={data?.defects?.critical > 0 ? 'var(--srt)' : undefined} />
                <Figure label="Major" value={data?.defects?.major} color={data?.defects?.major > 0 ? 'var(--sat)' : undefined} />
                <Figure label="All open" value={data?.defects?.open} />
              </Panel>
            )}
          </div>

          <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, boxShadow: 'var(--sh-sm)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)' }}>
                Asset integrity {data ? <span style={{ color: 'var(--n400)', fontWeight: 400 }}>· {rows.length} of {total}</span> : null}
              </div>
              <div style={{ flex: 1 }} />
              <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                style={{ height: 30, fontSize: 12, padding: '0 8px', border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', color: 'var(--n700)' }}>
                <option value="">All statuses</option>
                {INTEGRITY_STATUSES.map((s) => <option key={s} value={s}>{INTEGRITY_STATUS_META[s].label}</option>)}
              </select>
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AIN, name, site…" style={{ height: 30, fontSize: 12, width: 200, maxWidth: '100%' }} />
            </div>
            <div className="table-scroll">
              {!data ? (
                <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--n400)' }}>{err ? '' : 'Loading…'}</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--n400)' }}>
                  {total === 0 ? 'No assets yet.' : 'No assets match these filters.'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--n50)' }}>
                      {['Asset', 'Site', 'Integrity', canInspections && 'Last inspection', canInspections && 'Next inspection', canRisks && 'Highest risk', canDefects && 'Open defects'].filter(Boolean).map((h) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', borderBottom: 'var(--bdr)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => {
                      const m = INTEGRITY_STATUS_META[a.integrity_status]
                      const band = bandOf(a.max_risk_score)
                      const nextOverdue = a.overdue_inspections > 0
                      return (
                        <tr key={a.id} className="dash-alert-row" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer' }} onClick={() => nav(`/assets?id=${a.id}`)}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontFamily: 'var(--ff-m)', fontSize: 12, color: 'var(--b700)', fontWeight: 500 }}>{a.ain}</div>
                            <div style={{ fontSize: 13, color: 'var(--n900)' }}>{a.name}</div>
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--n700)', whiteSpace: 'nowrap' }}>
                            {a.site?.name || '—'}
                            {a.site?.status === 'shutdown' && <div style={{ fontSize: 11, color: 'var(--n400)' }}>Shut down</div>}
                          </td>
                          <td style={{ padding: '10px 12px', minWidth: 170 }}>
                            <Pill meta={m}>{m.label}</Pill>
                            {a.reasons.length > 0 && <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 4 }}>{a.reasons.join(' · ')}</div>}
                          </td>
                          {canInspections && (
                            <td style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--n700)', whiteSpace: 'nowrap' }}>
                              {fmtDate(a.last_inspection_date)}
                              {a.last_condition_rating != null && <div style={{ fontSize: 11, color: 'var(--n500)' }}>{RATING_LABEL[a.last_condition_rating]} ({a.last_condition_rating}/5)</div>}
                            </td>
                          )}
                          {canInspections && (
                            <td style={{ padding: '10px 12px', fontSize: 12.5, whiteSpace: 'nowrap', color: nextOverdue ? 'var(--srt)' : 'var(--n700)' }}>
                              {fmtDate(a.next_inspection_date)}{nextOverdue && <div style={{ fontSize: 11 }}>Overdue</div>}
                            </td>
                          )}
                          {canRisks && (
                            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                              {band ? <Pill meta={BAND_META[band]}>{BAND_META[band].label} · {a.max_risk_score}</Pill> : <span style={{ fontSize: 12, color: 'var(--n400)' }}>None open</span>}
                            </td>
                          )}
                          {canDefects && (
                            <td style={{ padding: '10px 12px', fontFamily: 'var(--ff-m)', fontSize: 12.5, color: a.critical_defects > 0 ? 'var(--srt)' : 'var(--n700)' }}>
                              {a.open_defects}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
