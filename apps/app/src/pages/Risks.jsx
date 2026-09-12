import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listRisks, getRisk, getRiskMatrix, getRiskStats, createRisk, updateRisk, archiveRisk,
  RISK_CATEGORIES, RISK_STATUSES, CATEGORY_LABEL, STATUS_LABEL,
  LIKELIHOOD_SCALE, CONSEQUENCE_SCALE, BAND_META, bandOf,
} from '../lib/db/risks'
import { listAssets } from '../lib/db/assets'
import { listSites } from '../lib/db/sites'
import { listOrgMembers } from '../lib/db/orgMembers'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { errorText } from '../lib/errors'

const STATUS_CLASS = {
  open: 'badge-r', mitigating: 'badge-a', accepted: 'badge-b', closed: 'badge-n',
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function BandBadge({ score }) {
  const band = bandOf(score)
  if (!band) return <span style={{ fontSize: 11.5, color: 'var(--n400)' }}>Not rated</span>
  const m = BAND_META[band]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: 3, border: `1px solid ${m.br}`, background: m.bg, color: m.c, fontSize: 10.5, fontWeight: 600 }}>{m.label}</span>
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11.5, color: 'var(--n600)' }}>{score}</span>
    </span>
  )
}

/**
 * The grid itself.
 *
 * Consequence runs up the left and likelihood across the bottom, which is the
 * orientation every HSE department already reads — worst risk in the top
 * right. The cells are coloured by band and carry the count sitting in them,
 * so the shape of the register is visible before anyone reads a row.
 */
function Matrix({ matrix, onPick, selectedCell }) {
  if (!matrix) return <div style={{ padding: 32, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading the grid…</div>

  const byRow = {}
  for (const cell of matrix.cells) {
    byRow[cell.consequence] = byRow[cell.consequence] || []
    byRow[cell.consequence].push(cell)
  }
  const rows = Object.keys(byRow).map(Number).sort((a, b) => b - a)

  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {/* Consequence axis */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingBottom: 30 }}>
        <div style={{
          writingMode: 'vertical-rl', transform: 'rotate(180deg)', textAlign: 'center',
          fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase',
          color: 'var(--n500)', fontFamily: 'var(--ff-m)', padding: '4px 0',
        }}>
          Consequence
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {rows.map((consequence) => {
          const scale = CONSEQUENCE_SCALE.find(([v]) => v === consequence)
          return (
            <div key={consequence} style={{ display: 'flex', alignItems: 'stretch', gap: 4, marginBottom: 4 }}>
              <div style={{ width: 96, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingRight: 6, textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n700)' }}>{scale?.[1]}</div>
                <div style={{ fontFamily: 'var(--ff-m)', fontSize: 10, color: 'var(--n400)' }}>{consequence}</div>
              </div>
              {byRow[consequence].sort((a, b) => a.likelihood - b.likelihood).map((cell) => {
                const m = BAND_META[cell.band]
                const active = selectedCell === `${cell.likelihood}-${cell.consequence}`
                return (
                  <button key={cell.likelihood} type="button"
                    onClick={() => onPick?.(cell)}
                    title={`Likelihood ${cell.likelihood} x consequence ${cell.consequence} = ${cell.score} (${m.label})`}
                    style={{
                      flex: 1, minWidth: 0, aspectRatio: '1.6 / 1', border: active ? '2px solid var(--n900)' : `1px solid ${m.br}`,
                      background: cell.count > 0 ? m.solid : m.bg,
                      borderRadius: 4, cursor: cell.count > 0 ? 'pointer' : 'default',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'inherit', padding: 2,
                    }}>
                    <span style={{
                      fontFamily: 'var(--ff-m)', fontSize: cell.count > 0 ? 16 : 11,
                      fontWeight: cell.count > 0 ? 700 : 400,
                      color: cell.count > 0 ? '#fff' : m.c,
                    }}>
                      {cell.count > 0 ? cell.count : cell.score}
                    </span>
                    {cell.count > 0 && (
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,.85)' }}>score {cell.score}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}

        {/* Likelihood axis */}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <div style={{ width: 96, flexShrink: 0 }} />
          {LIKELIHOOD_SCALE.map(([v, label]) => (
            <div key={v} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
              <div style={{ fontFamily: 'var(--ff-m)', fontSize: 10, color: 'var(--n400)' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginTop: 8 }}>
          Likelihood
        </div>
      </div>
    </div>
  )
}

// ── Assess ────────────────────────────────────────────────────────────────────
const EMPTY = {
  title: '', description: '', category: 'operational',
  likelihood: 3, consequence: 3, controls: '',
  residual_likelihood: '', residual_consequence: '',
  asset_id: '', site_id: '', owner_id: '', review_date: '', status: 'open',
}

/** The 1-5 pickers. Words first, number second: a bare digit is not a scale
 * two people will apply the same way. */
function ScalePicker({ label, scale, value, onChange, allowClear }) {
  return (
    <div>
      <label className="label" style={{ display: 'block', marginBottom: 5 }}>{label}</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
        {scale.map(([v, name, hint]) => {
          const active = String(value) === String(v)
          return (
            <button key={v} type="button" title={hint}
              onClick={() => onChange(allowClear && active ? '' : v)}
              style={{
                padding: '7px 4px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                border: `1px solid ${active ? 'var(--b400)' : 'var(--n200)'}`,
                background: active ? 'var(--slb)' : 'var(--n0)',
              }}>
              <div style={{ fontFamily: 'var(--ff-m)', fontSize: 14, fontWeight: 600, color: active ? 'var(--slt)' : 'var(--n700)' }}>{v}</div>
              <div style={{ fontSize: 9.5, color: 'var(--n500)', lineHeight: 1.25, marginTop: 2 }}>{name}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RiskModal({ risk, prefill, onClose, onSave, assets, sites, members }) {
  const [form, setForm] = useState(() => risk ? {
    title: risk.title, description: risk.description ?? '', category: risk.category,
    likelihood: risk.likelihood, consequence: risk.consequence, controls: risk.controls ?? '',
    residual_likelihood: risk.residual_likelihood ?? '', residual_consequence: risk.residual_consequence ?? '',
    asset_id: risk.asset_id ?? '', site_id: risk.site_id ?? '', owner_id: risk.owner_id ?? '',
    review_date: risk.review_date ?? '', status: risk.status,
  } : { ...EMPTY, ...prefill })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const inherent = form.likelihood * form.consequence
  const hasResidual = form.residual_likelihood !== '' && form.residual_consequence !== ''
  const residual = hasResidual ? form.residual_likelihood * form.residual_consequence : null
  const halfResidual = (form.residual_likelihood === '') !== (form.residual_consequence === '')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) { setErr('Say what the risk is.'); return }
    if (halfResidual) { setErr('A residual rating needs both a likelihood and a consequence — half of one describes nothing.'); return }
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      category: form.category,
      likelihood: Number(form.likelihood),
      consequence: Number(form.consequence),
      controls: form.controls.trim() || null,
      residual_likelihood: hasResidual ? Number(form.residual_likelihood) : null,
      residual_consequence: hasResidual ? Number(form.residual_consequence) : null,
      asset_id: form.asset_id || null,
      site_id: form.site_id || null,
      owner_id: form.owner_id || null,
      review_date: form.review_date || null,
      status: form.status,
    }
    try {
      if (risk) await updateRisk(risk.id, payload)
      else await createRisk(payload)
      onSave()
    } catch (ex) {
      setErr(ex.message === 'residual_incomplete'
        ? 'A residual rating needs both a likelihood and a consequence.'
        : errorText(ex, 'Save failed.'))
      setSaving(false)
    }
  }

  const ScoreChip = ({ label, score }) => {
    const band = bandOf(score)
    const m = band ? BAND_META[band] : null
    return (
      <div style={{ flex: 1, textAlign: 'center', padding: '10px 8px', borderRadius: 6, border: `1px solid ${m?.br || 'var(--n200)'}`, background: m?.bg || 'var(--n50)' }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{label}</div>
        <div style={{ fontFamily: 'var(--ff-m)', fontSize: 22, fontWeight: 600, color: m?.c || 'var(--n400)', marginTop: 3 }}>{score ?? '—'}</div>
        <div style={{ fontSize: 11, color: m?.c || 'var(--n400)' }}>{m?.label || 'not rated'}</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 640, maxHeight: '92vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{risk ? `Edit ${risk.ref}` : 'Assess a risk'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>What could happen *</label>
            <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Gas leak at the inlet flange" style={{ width: '100%' }} />
          </div>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>Detail</label>
            <textarea className="input" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Category</label>
              <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)} style={{ width: '100%' }}>
                {RISK_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Asset</label>
              <select className="input" value={form.asset_id} onChange={(e) => set('asset_id', e.target.value)} style={{ width: '100%' }}>
                <option value="">— None —</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Site</label>
              <select className="input" value={form.site_id} onChange={(e) => set('site_id', e.target.value)} style={{ width: '100%' }}>
                <option value="">— None —</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ borderTop: 'var(--bdr)', paddingTop: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--n800)', marginBottom: 10 }}>Before controls</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ScalePicker label="Likelihood *" scale={LIKELIHOOD_SCALE} value={form.likelihood} onChange={(v) => set('likelihood', v)} />
              <ScalePicker label="Consequence *" scale={CONSEQUENCE_SCALE} value={form.consequence} onChange={(v) => set('consequence', v)} />
            </div>
          </div>

          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>Controls in place</label>
            <textarea className="input" rows={2} value={form.controls} onChange={(e) => set('controls', e.target.value)} placeholder="Weekly leak survey; detector interlocked to ESD." style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />
          </div>

          <div style={{ borderTop: 'var(--bdr)', paddingTop: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--n800)', marginBottom: 4 }}>After controls</div>
            <p style={{ fontSize: 11.5, color: 'var(--n500)', marginBottom: 10, lineHeight: 1.55 }}>
              Optional, but it is the rating everything else reads — the register, the grid and the asset&apos;s
              condition score all use the residual where one exists. Click a selected number again to clear it.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ScalePicker label="Residual likelihood" scale={LIKELIHOOD_SCALE} value={form.residual_likelihood} onChange={(v) => set('residual_likelihood', v)} allowClear />
              <ScalePicker label="Residual consequence" scale={CONSEQUENCE_SCALE} value={form.residual_consequence} onChange={(v) => set('residual_consequence', v)} allowClear />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <ScoreChip label="Inherent" score={inherent} />
            <ScoreChip label="Residual" score={residual} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, borderTop: 'var(--bdr)', paddingTop: 16 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Owner</label>
              <select className="input" value={form.owner_id} onChange={(e) => set('owner_id', e.target.value)} style={{ width: '100%' }}>
                <option value="">— Unassigned —</option>
                {members.map((m) => <option key={m.user_id || m.id} value={m.user_id || m.id}>{m.full_name || m.email}</option>)}
              </select>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Review by</label>
              <input className="input" type="date" value={form.review_date} onChange={(e) => set('review_date', e.target.value)} style={{ width: '100%' }} />
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Status</label>
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)} style={{ width: '100%' }}>
                {RISK_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          {err && <p style={{ fontSize: 12, color: 'var(--srt)' }}>{err}</p>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : risk ? 'Save changes' : 'Add to the register'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
function Stat({ label, value, tone }) {
  const color = tone === 'warn' ? 'var(--sat)' : tone === 'bad' ? 'var(--srt)' : 'var(--n900)'
  return (
    <div style={{ padding: '12px 16px', borderRight: 'var(--bdr)', flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: 20, fontWeight: 500, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function Risks({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'risk:create')
  const canEdit = can(roleKey, 'risk:update')

  const [tab, setTab] = useState('matrix')
  const [basis, setBasis] = useState('current')
  const [risks, setRisks] = useState([])
  const [matrix, setMatrix] = useState(null)
  const [stats, setStats] = useState(null)
  const [assets, setAssets] = useState([])
  const [sites, setSites] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ q: '', category: 'all', band: 'all', live: true })
  const [detail, setDetail] = useState(null)
  const [modal, setModal] = useState(null)
  const [cellPick, setCellPick] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [rows, m, s] = await Promise.all([listRisks(filters), getRiskMatrix(basis), getRiskStats()])
      setRisks(rows); setMatrix(m); setStats(s)
    } catch (ex) {
      setError(errorText(ex, 'Could not load the risk register.'))
    } finally {
      setLoading(false)
    }
  }, [filters, basis])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // Settled, not all: listOrgMembers needs user:manage, so for an HSE
    // officer it answers 403 while assets and sites both return fine. Under
    // Promise.all that one refusal rejected the lot and the empty catch left
    // the Asset, Site AND Owner pickers showing '— None —' only, which made a
    // risk impossible to attach to anything. Each picker now stands or falls
    // on its own request.
    Promise.allSettled([listAssets(), listSites(), listOrgMembers()])
      .then(([a, s, m]) => {
        if (a.status === 'fulfilled') setAssets(a.value)
        if (s.status === 'fulfilled') setSites(s.value)
        if (m.status === 'fulfilled') setMembers(m.value)
      })
  }, [])

  const openDetail = async (id) => {
    setDetail({ id, loading: true })
    try { setDetail(await getRisk(id)) } catch { setDetail(null) }
  }

  const archive = async (id) => { await archiveRisk(id); setDetail(null); load() }
  const setFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v }))

  return (
    <div className="app-shell">
      <Sidebar active="risks" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Risk" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 0', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Risk</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>Likelihood against consequence, before and after controls</p>
              </div>
              <div style={{ flex: 1 }} />
              {canCreate && (
                <button onClick={() => setModal('add')} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Assess a Risk
                </button>
              )}
            </div>

            {stats && (
              <div style={{ display: 'flex', border: 'var(--bdr)', borderRadius: 6, marginBottom: 12, overflow: 'hidden', background: 'var(--n0)' }}>
                <Stat label="Live risks" value={stats.live} />
                <Stat label="Extreme" value={stats.extreme} tone={stats.extreme > 0 ? 'bad' : undefined} />
                <Stat label="High" value={stats.high} tone={stats.high > 0 ? 'warn' : undefined} />
                <Stat label="Accepted" value={stats.accepted} />
                <Stat label="Past their review date" value={stats.due_review} tone={stats.due_review > 0 ? 'warn' : undefined} />
              </div>
            )}

            <div className="tab-strip" style={{ display: 'flex' }}>
              {[{ k: 'matrix', l: 'Matrix' }, { k: 'register', l: `Register (${risks.length})` }].map((t) => (
                <button key={t.k} className={`tab-btn${tab === t.k ? ' active' : ''}`} onClick={() => { setTab(t.k); setCellPick(null); setDetail(null) }}>{t.l}</button>
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
              ) : tab === 'matrix' ? (
                <div style={{ padding: 24, maxWidth: 860 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <p style={{ fontSize: 12.5, color: 'var(--n600)', lineHeight: 1.6, flex: 1 }}>
                      Every live risk placed by its rating. A shaded cell holds risks; the number in it is how many.
                    </p>
                    <select className="input" value={basis} onChange={(e) => setBasis(e.target.value)} style={{ height: 30, fontSize: 12, width: 190 }}>
                      <option value="current">After controls (residual)</option>
                      <option value="inherent">Before controls (inherent)</option>
                    </select>
                  </div>

                  <Matrix
                    matrix={matrix}
                    selectedCell={cellPick && `${cellPick.likelihood}-${cellPick.consequence}`}
                    onPick={(cell) => {
                      const same = cellPick && cellPick.likelihood === cell.likelihood && cellPick.consequence === cell.consequence
                      if (!cell.count || same) { setCellPick(null); setDetail(null); return }
                      setCellPick(cell)
                      // A cell almost always holds one risk — open it rather
                      // than showing a list of one to click through.
                      if (cell.risks.length === 1) openDetail(cell.risks[0].id)
                      else setDetail(null)
                    }}
                  />

                  <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
                    {Object.entries(BAND_META).map(([key, m]) => (
                      <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--n600)' }}>
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: m.solid }} />
                        {m.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ padding: '12px 24px', borderBottom: 'var(--bdr)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input className="input" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Search reference or description…" style={{ height: 30, fontSize: 12, width: 250 }} />
                    <select className="input" value={filters.category} onChange={(e) => setFilter('category', e.target.value)} style={{ height: 30, fontSize: 12, width: 150 }}>
                      <option value="all">All categories</option>
                      {RISK_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select className="input" value={filters.band} onChange={(e) => setFilter('band', e.target.value)} style={{ height: 30, fontSize: 12, width: 140 }}>
                      <option value="all">Any band</option>
                      {Object.entries(BAND_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--n600)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={filters.live} onChange={(e) => setFilter('live', e.target.checked)} />
                      Live only
                    </label>
                  </div>

                  {risks.length === 0 ? (
                    <div style={{ padding: 64, textAlign: 'center' }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>Nothing on the register</p>
                      <p style={{ fontSize: 13, color: 'var(--n400)', maxWidth: 420, margin: '0 auto 20px', lineHeight: 1.6 }}>
                        An assessment records what could go wrong, how likely it is, and what it would cost — and
                        the worst one against an asset feeds that asset&apos;s condition score.
                      </p>
                      {canCreate && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Assess the first risk</button>}
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                        <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                          {['Ref', 'Risk', 'Category', 'Asset', 'Inherent', 'Current', 'Status', 'Review'].map((h) => (
                            <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {risks.map((r) => (
                          <tr key={r.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: detail?.id === r.id ? 'var(--b50)' : 'transparent' }} onClick={() => openDetail(r.id)}>
                            <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{r.ref}</td>
                            <td style={{ padding: '11px 14px' }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                            </td>
                            <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{CATEGORY_LABEL[r.category] || r.category}</td>
                            <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{r.asset?.ain || '—'}</td>
                            <td style={{ padding: '11px 14px' }}><BandBadge score={r.inherent_score} /></td>
                            <td style={{ padding: '11px 14px' }}><BandBadge score={r.current_score} /></td>
                            <td style={{ padding: '11px 14px' }}><span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                            <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, whiteSpace: 'nowrap', color: r.review_date && r.review_date < new Date().toISOString().slice(0, 10) && r.status !== 'closed' ? 'var(--srt)' : 'var(--n600)' }}>
                              {fmtDate(r.review_date)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>

            {/* One panel for both tabs. A cell used to open its risks in a strip
                under the grid, which pushed the grid up and read as a different
                kind of thing from the register's detail — same content, so the
                same place. */}
            {(detail || cellPick) && (
              <div className="detail-panel" style={{ '--panel-w': '380px', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {!detail ? (
                  <>
                    <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>
                          {cellPick.count} risk{cellPick.count === 1 ? '' : 's'} here
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--n500)', marginTop: 2 }}>
                          Likelihood {cellPick.likelihood} × consequence {cellPick.consequence} —
                          {' '}<strong style={{ color: BAND_META[cellPick.band].c }}>score {cellPick.score}, {BAND_META[cellPick.band].label.toLowerCase()}</strong>
                        </div>
                      </div>
                      <button onClick={() => setCellPick(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      </button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {cellPick.risks.map((r) => (
                        <div key={r.id} className="row-hover" onClick={() => openDetail(r.id)}
                          style={{ padding: '11px 20px', borderBottom: 'var(--bdr)', cursor: 'pointer' }}>
                          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{r.ref}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--n800)', margin: '2px 0 5px' }}>{r.title}</div>
                          <span className="badge badge-n">{CATEGORY_LABEL[r.category] || r.category}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : detail.loading ? (
                  <div style={{ padding: 24, fontSize: 13, color: 'var(--n400)' }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        {cellPick && cellPick.risks.length > 1 && (
                          <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', padding: 0, marginBottom: 4, fontSize: 11, color: 'var(--b600)', cursor: 'pointer', fontFamily: 'inherit' }}>
                            ← the {cellPick.count} risks in this cell
                          </button>
                        )}
                        <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{detail.ref}</div>
                        <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{detail.title}</div>
                      </div>
                      <button onClick={() => { setDetail(null); setCellPick(null) }} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span className={`badge ${STATUS_CLASS[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
                        <span className="badge badge-n">{CATEGORY_LABEL[detail.category] || detail.category}</span>
                      </div>

                      {/* Inherent beside residual: the pair is the point — one
                          number alone cannot show whether controls did anything. */}
                      <div style={{ display: 'flex', gap: 10 }}>
                        {[['Before controls', detail.inherent_score], ['After controls', detail.residual_score]].map(([label, score]) => {
                          const band = bandOf(score)
                          const m = band ? BAND_META[band] : null
                          return (
                            <div key={label} style={{ flex: 1, textAlign: 'center', padding: '12px 8px', borderRadius: 6, border: `1px solid ${m?.br || 'var(--n200)'}`, background: m?.bg || 'var(--n50)' }}>
                              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{label}</div>
                              <div style={{ fontFamily: 'var(--ff-m)', fontSize: 24, fontWeight: 600, color: m?.c || 'var(--n400)', marginTop: 3 }}>{score ?? '—'}</div>
                              <div style={{ fontSize: 11, color: m?.c || 'var(--n400)' }}>{m?.label || 'not rated'}</div>
                            </div>
                          )
                        })}
                      </div>
                      {detail.residual_score == null && (
                        <p style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.55, marginTop: -6 }}>
                          No residual rating yet, so the grid and the asset&apos;s condition score are both reading the
                          inherent figure — which assumes the controls do nothing.
                        </p>
                      )}

                      {detail.description && (
                        <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--n700)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                          {detail.description}
                        </div>
                      )}

                      {detail.controls && (
                        <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Controls</div>
                          <div style={{ padding: '11px 14px', fontSize: 12.5, color: 'var(--n700)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{detail.controls}</div>
                        </div>
                      )}

                      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Details</div>
                        {[
                          ['Rating', `${detail.likelihood} × ${detail.consequence}${detail.residual_score != null ? ` → ${detail.residual_likelihood} × ${detail.residual_consequence}` : ''}`],
                          ['Asset', detail.asset ? `${detail.asset.ain} — ${detail.asset.name}` : null],
                          ['Site', detail.site?.name],
                          ['Owner', detail.owner?.full_name],
                          ['Review by', detail.review_date ? fmtDate(detail.review_date) : null],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                            <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                            <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v || '—'}</span>
                          </div>
                        ))}
                      </div>

                      {detail.asset && (
                        <p style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.55 }}>
                          While this risk is live it feeds {detail.asset.ain}&apos;s condition score — the worst live
                          risk against an asset is what the risk signal reads.
                        </p>
                      )}

                      {canEdit && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingBottom: 8 }}>
                          <button onClick={() => setModal(detail)} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit</button>
                          <button onClick={() => archive(detail.id)} style={{ height: 34, fontSize: 13, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Archive</button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <RiskModal
          risk={modal === 'add' ? null : modal}
          assets={assets} sites={sites} members={members}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); if (detail?.id) openDetail(detail.id) }}
        />
      )}
    </div>
  )
}
