import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listSchedules, getDepreciationStats, getForecast, getAssetSchedule,
  previewSchedule, createSchedule, postSchedule, postAllSchedules, retireSchedule,
  DEPRECIATION_METHODS, METHOD_LABEL,
} from '../lib/db/depreciation'
import { listAssets } from '../lib/db/assets'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'

const THIS_YEAR = new Date().getFullYear()

function naira(cents) {
  if (cents === null || cents === undefined || cents === '') return '—'
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(n) >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`
  return `₦${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function exact(cents) {
  if (cents === null || cents === undefined) return '—'
  return `₦${(Number(cents) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function Stat({ label, value, hint, tone }) {
  return (
    <div style={{ padding: '12px 16px', borderRight: 'var(--bdr)', flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: 19, fontWeight: 500, color: tone === 'warn' ? 'var(--sat)' : 'var(--n900)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--n400)', marginTop: 1 }}>{hint}</div>}
    </div>
  )
}

// ── Create a schedule ─────────────────────────────────────────────────────────
// Two steps on one screen: choose the basis, then read the table it produces
// before committing. The preview is the same maths the save will run.
function NewScheduleModal({ assets, onClose, onCreated }) {
  const [assetId, setAssetId] = useState('')
  const [method, setMethod] = useState('')
  const [factor, setFactor] = useState('2')
  const [overrides, setOverrides] = useState({ cost: '', salvage: '', life: '', start: '' })
  const [preview, setPreview] = useState(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  const body = useCallback(() => {
    const b = { asset_id: assetId }
    if (method) b.method = method
    if (method === 'declining_balance' && factor) b.declining_factor = Number(factor)
    if (overrides.cost !== '') b.cost_cents = Math.round(Number(overrides.cost) * 100)
    if (overrides.salvage !== '') b.salvage_value_cents = Math.round(Number(overrides.salvage) * 100)
    if (overrides.life !== '') b.useful_life_years = Number(overrides.life)
    if (overrides.start !== '') b.start_date = overrides.start
    return b
  }, [assetId, method, factor, overrides])

  // Re-run the preview whenever the basis changes — the table is the point.
  useEffect(() => {
    if (!assetId) { setPreview(null); setProblem(''); return }
    let cancelled = false
    previewSchedule(body())
      .then((r) => { if (!cancelled) { setPreview(r); setProblem('') } })
      .catch((e) => {
        if (cancelled) return
        setPreview(null)
        setProblem(
          e.message === 'incomplete_basis'
            ? 'This asset is missing part of its basis. Fill it in below, or add it on the asset record.'
            : e.message === 'unsupported_method'
              ? 'Units of production needs meter readings AssetCore does not collect yet. Pick another method.'
              : e.message === 'nothing_to_depreciate'
                ? 'Salvage value is at or above cost, so there is nothing to depreciate.'
                : e.message || 'Could not work out a schedule.'
        )
      })
    return () => { cancelled = true }
  }, [assetId, body])

  async function save() {
    setBusy(true)
    try { await createSchedule(body()); onCreated() }
    catch (e) { setProblem(e.message || 'Could not save the schedule.'); setBusy(false) }
  }

  const asset = assets.find((a) => a.id === assetId)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <div style={{ position: 'relative', width: 700, maxHeight: '90vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>New depreciation schedule</h3>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>Check the table before you commit — this is the same calculation that gets saved.</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr', gap: 12 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Asset</label>
              <select className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ width: '100%' }}>
                <option value="">Choose an asset…</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Method</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} style={{ width: '100%' }}>
                <option value="">Use the asset&rsquo;s own setting</option>
                {DEPRECIATION_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          {method === 'declining_balance' && (
            <div style={{ width: 220 }}>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Declining factor</label>
              <select className="input" value={factor} onChange={(e) => setFactor(e.target.value)} style={{ width: '100%' }}>
                <option value="2">200% — double declining</option>
                <option value="1.5">150% declining</option>
                <option value="1.25">125% declining</option>
              </select>
            </div>
          )}

          {assetId && (
            <details open={!!problem} style={{ border: 'var(--bdr)', borderRadius: 6, padding: '10px 14px' }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--n700)', fontWeight: 500 }}>
                Override the basis {asset ? `(otherwise taken from ${asset.ain})` : ''}
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
                {[['cost', 'Cost (₦)', 'number'], ['salvage', 'Salvage (₦)', 'number'], ['life', 'Life (years)', 'number'], ['start', 'Start date', 'date']].map(([k, l, t]) => (
                  <div key={k}>
                    <label className="label" style={{ display: 'block', marginBottom: 4 }}>{l}</label>
                    <input className="input" type={t} step="0.01" value={overrides[k]}
                      onChange={(e) => setOverrides((p) => ({ ...p, [k]: e.target.value }))}
                      style={{ width: '100%', fontFamily: t === 'number' ? 'var(--ff-m)' : 'inherit', fontSize: 12 }} />
                  </div>
                ))}
              </div>
            </details>
          )}

          {problem && (
            <div style={{ background: 'var(--sab)', border: '1px solid var(--sabr)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--sat)' }}>
              {problem}
            </div>
          )}

          {preview && (
            <>
              <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--n600)', flexWrap: 'wrap' }}>
                <span>Method <strong style={{ color: 'var(--n900)' }}>{METHOD_LABEL[preview.basis.method]}</strong></span>
                <span>Cost <strong style={{ fontFamily: 'var(--ff-m)', color: 'var(--n900)' }}>{exact(preview.basis.cost_cents)}</strong></span>
                <span>Salvage <strong style={{ fontFamily: 'var(--ff-m)', color: 'var(--n900)' }}>{exact(preview.basis.salvage_value_cents)}</strong></span>
                <span>Life <strong style={{ color: 'var(--n900)' }}>{preview.basis.useful_life_years} years</strong></span>
                <span>From <strong style={{ fontFamily: 'var(--ff-m)', color: 'var(--n900)' }}>{preview.basis.start_date}</strong></span>
              </div>

              <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0 }}>
                      <tr style={{ background: 'var(--n50)' }}>
                        {['Year', 'Opening', 'Charge', 'Closing', 'Accumulated'].map((h) => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Year' ? 'left' : 'right', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.entries.map((e) => (
                        <tr key={e.period_year} style={{ borderBottom: 'var(--bdr)' }}>
                          <td style={{ padding: '7px 14px', fontFamily: 'var(--ff-m)', color: 'var(--n700)' }}>{e.period_year}</td>
                          <td style={{ padding: '7px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', color: 'var(--n600)' }}>{exact(e.opening_cents)}</td>
                          <td style={{ padding: '7px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', color: 'var(--n900)', fontWeight: 500 }}>{exact(e.charge_cents)}</td>
                          <td style={{ padding: '7px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', color: 'var(--n600)' }}>{exact(e.closing_cents)}</td>
                          <td style={{ padding: '7px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', color: 'var(--n600)' }}>{exact(e.accumulated_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--n500)', margin: 0 }}>
                {preview.entries.length} annual periods. Nothing is posted on save — entries stay open until you post them,
                and posting is what hands net book value over to this schedule.
              </p>
            </>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button onClick={save} disabled={!preview || busy} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: !preview || busy ? 0.6 : 1 }}>
            {busy ? 'Saving…' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Depreciation({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canManage = can(roleKey, 'depreciation:manage')

  const [schedules, setSchedules] = useState([])
  const [stats, setStats] = useState(null)
  const [forecast, setForecast] = useState([])
  const [assets, setAssets] = useState([])
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('schedules')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, st, f] = await Promise.all([listSchedules(), getDepreciationStats(), getForecast()])
      setSchedules(s); setStats(st); setForecast(f)
    } catch (e) {
      setError(e.message === 'forbidden' ? 'Your role cannot see the depreciation register.' : e.message || 'Failed to load.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { listAssets().then(setAssets).catch(() => setAssets([])) }, [])

  const openDetail = useCallback(async (assetId) => {
    setDetail({ loading: true })
    try { setDetail(await getAssetSchedule(assetId)) }
    catch { setDetail(null) }
  }, [])

  async function post(id, assetId) {
    setBusy(true)
    try { await postSchedule(id, THIS_YEAR); await load(); await openDetail(assetId) }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function postAll() {
    if (!confirm(`Post every open period up to and including ${THIS_YEAR} across all schedules? Posted periods fix the charge and take over each asset's net book value.`)) return
    setBusy(true)
    try {
      const r = await postAllSchedules(THIS_YEAR)
      await load()
      alert(`${r.entries_posted} period${r.entries_posted === 1 ? '' : 's'} posted across ${r.schedules} schedule${r.schedules === 1 ? '' : 's'}.`)
    } catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  async function retire(id) {
    if (!confirm('Retire this schedule? Posted history is kept, and net book value goes back to being entered by hand.')) return
    try { await retireSchedule(id); setDetail(null); load() }
    catch (e) { alert(e.message) }
  }

  const eligible = assets.filter((a) => !schedules.some((s) => s.asset_id === a.id))

  return (
    <div className="app-shell">
      <Sidebar active="depreciation" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Depreciation" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 0', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Depreciation</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>Annual periods · net book value comes from posted entries</p>
              </div>
              <div style={{ flex: 1 }} />
              {canManage && stats?.unposted_due > 0 && (
                <button onClick={postAll} disabled={busy} className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 12.5 }}>
                  Post {stats.unposted_due} open period{stats.unposted_due === 1 ? '' : 's'}
                </button>
              )}
              {canManage && (
                <button onClick={() => setCreating(true)} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  New Schedule
                </button>
              )}
            </div>

            {stats && (
              <div style={{ display: 'flex', border: 'var(--bdr)', borderRadius: 6, marginBottom: 12, overflow: 'hidden' }}>
                <Stat label="Active schedules" value={stats.schedules} />
                <Stat label="Assets with a value but no schedule" value={stats.assets_without_schedule} tone={stats.assets_without_schedule > 0 ? 'warn' : undefined} />
                <Stat label="Gross cost" value={naira(stats.gross_cost_cents)} />
                <Stat label={`Charge posted for ${THIS_YEAR}`} value={naira(stats.charge_this_year_cents)} />
                <Stat label="Accumulated to date" value={naira(stats.accumulated_cents)} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 4 }}>
              {[['schedules', 'Schedules'], ['forecast', 'Year by year']].map(([v, l]) => (
                <button key={v} onClick={() => setTab(v)} className={`tab-btn${tab === v ? ' active' : ''}`}>{l}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading…</div>
              ) : error ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
                </div>
              ) : tab === 'forecast' ? (
                forecast.length === 0 ? (
                  <div style={{ padding: 64, textAlign: 'center', fontSize: 13, color: 'var(--n400)' }}>No schedules to forecast from yet.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                      <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                        {['Year', 'Assets', 'Charge', 'Closing NBV', 'Accumulated', 'Posted'].map((h) => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Year' || h === 'Assets' ? 'left' : 'right', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.map((r) => (
                        <tr key={r.period_year} className="row-hover" style={{ borderBottom: 'var(--bdr)', background: r.period_year === THIS_YEAR ? 'var(--b50)' : 'transparent' }}>
                          <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 12, color: r.period_year === THIS_YEAR ? 'var(--b700)' : 'var(--n800)', fontWeight: r.period_year === THIS_YEAR ? 600 : 400 }}>{r.period_year}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)' }}>{r.asset_count}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 12, color: 'var(--n900)', fontWeight: 500 }}>{exact(r.charge_cents)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 12, color: 'var(--n600)' }}>{exact(r.closing_cents)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 12, color: 'var(--n600)' }}>{exact(r.accumulated_cents)}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                            {r.posted_count === r.asset_count
                              ? <span className="badge badge-g">All posted</span>
                              : r.posted_count === 0
                                ? <span className="badge badge-n">Open</span>
                                : <span className="badge badge-a">{r.posted_count}/{r.asset_count}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : schedules.length === 0 ? (
                <div style={{ padding: 64, textAlign: 'center' }}>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 16px' }}><path d="M6 10h28M6 20h28M6 30h18" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round" /><path d="M30 26l4 4 4-6" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>No depreciation schedules yet</p>
                  <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
                    Until an asset has a schedule, its net book value is whatever someone typed into the asset record.
                    {stats?.assets_without_schedule > 0 && ` ${stats.assets_without_schedule} asset${stats.assets_without_schedule === 1 ? ' has' : 's have'} a purchase value and could be scheduled now.`}
                  </p>
                  {canManage && <button onClick={() => setCreating(true)} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Create first schedule</button>}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['Asset', 'Method', 'Cost', 'Life', 'Periods posted', 'Net book value'].map((h) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: h === 'Cost' || h === 'Net book value' ? 'right' : 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr key={s.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: detail?.id === s.id ? 'var(--b50)' : 'transparent' }} onClick={() => openDetail(s.asset_id)}>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{s.asset?.ain}</div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{s.asset?.name}</div>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{METHOD_LABEL[s.method] || s.method}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{naira(s.cost_cents)}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{s.useful_life_years} yrs</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>
                          {s.posted_count} / {s.entry_count}
                          {s.posted_count === 0 && <span className="badge badge-n" style={{ marginLeft: 8 }}>Nothing posted</span>}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n800)', whiteSpace: 'nowrap' }}>{naira(s.asset?.nbv_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {detail && !detail.loading && (
              <div style={{ width: 400, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{detail.asset?.ain}</div>
                    <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{detail.asset?.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--n500)', marginTop: 3 }}>
                      {METHOD_LABEL[detail.method]} · {detail.useful_life_years} years from {detail.start_date}
                    </div>
                  </div>
                  <button onClick={() => setDetail(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0 }}>
                      <tr style={{ background: 'var(--n50)' }}>
                        {['Year', 'Charge', 'Closing', ''].map((h) => (
                          <th key={h} style={{ padding: '8px 14px', textAlign: h === 'Year' ? 'left' : 'right', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.entries?.map((e) => (
                        <tr key={e.id} style={{ borderBottom: 'var(--bdr)' }}>
                          <td style={{ padding: '8px 14px', fontFamily: 'var(--ff-m)', color: 'var(--n700)' }}>{e.period_year}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', color: 'var(--n900)', fontWeight: 500 }}>{exact(e.charge_cents)}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontFamily: 'var(--ff-m)', color: 'var(--n600)' }}>{exact(e.closing_cents)}</td>
                          <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                            {e.posted
                              ? <span className="badge badge-g">Posted</span>
                              : <span className="badge badge-n">Open</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canManage && (
                  <div style={{ padding: '14px 20px', borderTop: 'var(--bdr)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button onClick={() => post(detail.id, detail.asset_id)} disabled={busy} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>
                      Post everything through {THIS_YEAR}
                    </button>
                    <button onClick={() => retire(detail.id)} style={{ height: 32, fontSize: 12.5, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Retire schedule</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {creating && (
        <NewScheduleModal
          assets={eligible}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load() }}
        />
      )}
    </div>
  )
}
