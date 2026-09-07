import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listDefects, getDefect, getDefectStats, createDefect, updateDefect,
  archiveDefect, raiseWorkOrder, DEFECT_SEVERITIES, SEVERITY_LABEL,
  DEFECT_STATUSES, STATUS_LABEL,
} from '../lib/db/defects'
import { listAssets } from '../lib/db/assets'
import { listSites } from '../lib/db/sites'
import { listInspections } from '../lib/db/inspections'
import { listApprovals, submitApproval, APPROVAL_STATUS_META } from '../lib/db/approvals'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { errorText } from '../lib/errors'

const SEVERITY_CLASS = {
  minor: 'badge-n', moderate: 'badge-b', major: 'badge-a', critical: 'badge-r',
}
const STATUS_CLASS = {
  open: 'badge-r', acknowledged: 'badge-a', in_progress: 'badge-ip',
  resolved: 'badge-g', closed: 'badge-g', deferred: 'badge-n',
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function DueCell({ defect }) {
  if (!defect.due_date) return <span style={{ fontSize: 11.5, color: 'var(--n400)' }}>No date</span>
  const settled = defect.status === 'resolved' || defect.status === 'closed'
  const overdue = !settled && defect.due_date < new Date().toISOString().slice(0, 10)
  return (
    <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: overdue ? 'var(--srt)' : 'var(--n600)', whiteSpace: 'nowrap' }}>
      {fmtDate(defect.due_date)}{overdue ? ' · overdue' : ''}
    </span>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'warn' ? 'var(--sat)' : tone === 'bad' ? 'var(--srt)' : 'var(--n900)'
  return (
    <div style={{ padding: '12px 16px', borderRight: 'var(--bdr)', flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: 20, fontWeight: 500, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

// ── Raise / edit ──────────────────────────────────────────────────────────────
const EMPTY = {
  title: '', description: '', severity: 'moderate', category: '',
  asset_id: '', site_id: '', inspection_id: '', due_date: '',
  identified_date: new Date().toISOString().slice(0, 10),
}

function DefectModal({ defect, prefill, onClose, onSave, assets, sites, inspections }) {
  const [form, setForm] = useState(() => defect ? {
    title: defect.title, description: defect.description ?? '', severity: defect.severity,
    category: defect.category ?? '', asset_id: defect.asset_id ?? '', site_id: defect.site_id ?? '',
    inspection_id: defect.inspection_id ?? '', due_date: defect.due_date ?? '',
    identified_date: defect.identified_date,
  } : { ...EMPTY, ...prefill })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) { setErr('A short description of the defect is required.'); return }
    setSaving(true)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      severity: form.severity,
      category: form.category.trim() || null,
      asset_id: form.asset_id || null,
      site_id: form.site_id || null,
      inspection_id: form.inspection_id || null,
      due_date: form.due_date || null,
      identified_date: form.identified_date || null,
    }
    try {
      if (defect) await updateDefect(defect.id, payload)
      else await createDefect(payload)
      onSave()
    } catch (ex) {
      setErr(errorText(ex, 'Save failed.'))
      setSaving(false)
    }
  }

  const F = ({ label, children, span, hint }) => (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="label" style={{ display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 5 }}>{hint}</p>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 580, maxHeight: '90vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{defect ? `Edit ${defect.ref}` : 'Raise a defect'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <F label="What is wrong *" span={2}>
            <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Earth bonding strap corroded" style={{ width: '100%' }} />
          </F>
          <F label="Detail" span={2}>
            <textarea className="input" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Where it is, what was observed, what it affects…" style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />
          </F>

          <F label="Severity *" span={2} hint="Severity describes the finding. The work order raised from it gets a matching priority.">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {DEFECT_SEVERITIES.map(([v, l, hint]) => (
                <button key={v} type="button" onClick={() => set('severity', v)}
                  style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${form.severity === v ? 'var(--b400)' : 'var(--n200)'}`,
                    background: form.severity === v ? 'var(--slb)' : 'var(--n0)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: form.severity === v ? 'var(--slt)' : 'var(--n800)' }}>{l}</div>
                  <div style={{ fontSize: 11, color: 'var(--n500)' }}>{hint}</div>
                </button>
              ))}
            </div>
          </F>

          <F label="Asset">
            <select className="input" value={form.asset_id} onChange={(e) => set('asset_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">— Not asset-specific —</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
            </select>
          </F>
          <F label="Site">
            <select className="input" value={form.site_id} onChange={(e) => set('site_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">— Not site-specific —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </F>
          <F label="Found during" span={2} hint="Linking the inspection is what lets a finding be traced from the walk-round to the job that cleared it.">
            <select className="input" value={form.inspection_id} onChange={(e) => set('inspection_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">— Raised outside an inspection —</option>
              {inspections.map((i) => <option key={i.id} value={i.id}>{i.title} ({fmtDate(i.completed_date || i.scheduled_date)})</option>)}
            </select>
          </F>
          <F label="Identified on">
            <input className="input" type="date" value={form.identified_date} onChange={(e) => set('identified_date', e.target.value)} style={{ width: '100%' }} />
          </F>
          <F label="Fix by">
            <input className="input" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} style={{ width: '100%' }} />
          </F>
          <F label="Category" span={2}>
            <input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="electrical / mechanical / structural" style={{ width: '100%' }} />
          </F>
          {err && <p style={{ gridColumn: 'span 2', fontSize: 12, color: 'var(--srt)' }}>{err}</p>}
        </div>
        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : defect ? 'Save changes' : 'Raise defect'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Raise the job ─────────────────────────────────────────────────────────────
function RaiseModal({ defect, onClose, onRaised }) {
  const [title, setTitle] = useState(`${defect.ref}: ${defect.title}`)
  const [slaDue, setSlaDue] = useState(defect.due_date || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await raiseWorkOrder(defect.id, {
        title: title.trim() || undefined,
        sla_due: slaDue ? `${slaDue}T17:00:00Z` : null,
      })
      onRaised()
    } catch (ex) {
      setErr(ex.message === 'already_raised' ? 'A work order has already been raised for this defect.' : errorText(ex, 'Could not raise the job.'))
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 460, background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)' }}>Raise a work order</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 18, lineHeight: 1.55 }}>
          The job inherits this defect&apos;s asset, site and a priority matched to its {defect.severity} severity.
          Closing the job resolves the defect.
        </p>

        <label className="label" style={{ display: 'block', marginBottom: 5 }}>Job title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', marginBottom: 14 }} />

        <label className="label" style={{ display: 'block', marginBottom: 5 }}>SLA due</label>
        <input className="input" type="date" value={slaDue} onChange={(e) => setSlaDue(e.target.value)} style={{ width: '100%' }} />

        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{busy ? 'Raising…' : 'Raise job'}</button>
        </div>
      </form>
    </div>
  )
}

/**
 * Accepting a defect rather than fixing it is a decision somebody should own.
 * Deferral is the one defect action routed through the approval matrix; the
 * rest are ordinary status changes.
 */
function DeferralSection({ defect, canSubmit, canRead }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [notes, setNotes] = useState('')
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!canRead) return
    try { setRows(await listApprovals({ entity_type: 'defect', entity_id: defect.id })) } catch { /* section stays empty */ }
  }, [defect.id, canRead])
  useEffect(() => { load() }, [load])

  if (!canRead) return null

  const submit = async () => {
    setErr('')
    setBusy(true)
    try {
      await submitApproval({
        entity_type: 'defect', entity_id: defect.id, kind: 'defect_deferral',
        title: `${defect.ref} — deferral`, notes: notes.trim() || null,
      })
      setAsking(false)
      setNotes('')
      load()
    } catch (ex) {
      setErr(ex.message === 'no_matching_rule'
        ? 'No approval rule covers defect deferrals yet. An owner adds one on Approvals → Matrix.'
        : ex.message === 'already_pending' ? 'A deferral request is already waiting on this defect.'
        : errorText(ex, 'Could not send the request.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginBottom: 8 }}>Deferral</div>
      {rows.length > 0 ? (
        rows.map((a) => {
          const meta = APPROVAL_STATUS_META[a.status] || APPROVAL_STATUS_META.pending
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
              <span style={{ flex: 1, color: 'var(--n700)' }}>
                {a.status === 'pending' ? `With ${a.current_role_label || '—'}` : 'Decided'}
              </span>
              <span className={`badge ${meta.cls}`}>{meta.label}</span>
            </div>
          )
        })
      ) : asking ? (
        <>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Why this defect should be accepted rather than fixed…"
            style={{ width: '100%', resize: 'vertical', paddingTop: 8, fontSize: 12 }} />
          {err && <p style={{ fontSize: 11.5, color: 'var(--srt)', marginTop: 6, lineHeight: 1.5 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={submit} disabled={busy} className="btn btn-primary" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>{busy ? 'Sending…' : 'Send'}</button>
            <button onClick={() => { setAsking(false); setErr('') }} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55, marginBottom: canSubmit ? 8 : 0 }}>
            Not deferred. Accepting a defect instead of fixing it goes through the approval matrix.
          </p>
          {canSubmit && (
            <button onClick={() => setAsking(true)} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>Request deferral</button>
          )}
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Defects({ dark, toggleDark }) {
  const nav = useNavigate()
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'defect:create')
  const canEdit = can(roleKey, 'defect:update')
  const canRaise = can(roleKey, 'wo:create')
  const canSubmitApproval = can(roleKey, 'approval:create')
  const canReadApproval = can(roleKey, 'approval:read')

  const [defects, setDefects] = useState([])
  const [stats, setStats] = useState(null)
  const [assets, setAssets] = useState([])
  const [sites, setSites] = useState([])
  const [inspections, setInspections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ q: '', severity: 'all', status: 'all', open: true })
  const [detail, setDetail] = useState(null)
  const [modal, setModal] = useState(null)
  const [raising, setRaising] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [rows, s] = await Promise.all([listDefects(filters), getDefectStats()])
      setDefects(rows)
      setStats(s)
    } catch (ex) {
      setError(errorText(ex, 'Could not load the defect register.'))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    Promise.all([listAssets(), listSites(), listInspections({ limit: 50 })])
      .then(([a, s, i]) => { setAssets(a); setSites(s); setInspections(i) })
      .catch(() => { /* the register still works without the pickers */ })
  }, [])

  const openDetail = async (id) => {
    setDetail({ id, loading: true })
    try { setDetail(await getDefect(id)) } catch { setDetail(null) }
  }

  const setStatus = async (id, status) => {
    await updateDefect(id, { status })
    load()
    if (detail?.id === id) openDetail(id)
  }

  const archive = async (id) => {
    await archiveDefect(id)
    setDetail(null)
    load()
  }

  const setFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v }))

  return (
    <div className="app-shell">
      <Sidebar active="defects" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Defects" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 12px', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Defects</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>Everything found and not yet put right</p>
              </div>
              <div style={{ flex: 1 }} />
              {canCreate && (
                <button onClick={() => setModal('add')} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Raise Defect
                </button>
              )}
            </div>

            {stats && (
              <div style={{ display: 'flex', border: 'var(--bdr)', borderRadius: 6, marginBottom: 12, overflow: 'hidden', background: 'var(--n0)' }}>
                <Stat label="Open" value={stats.open} />
                <Stat label="Critical" value={stats.critical} tone={stats.critical > 0 ? 'bad' : undefined} />
                <Stat label="Past their fix-by date" value={stats.overdue} tone={stats.overdue > 0 ? 'warn' : undefined} />
                <Stat label="With no job raised" value={stats.unactioned} tone={stats.unactioned > 0 ? 'warn' : undefined} />
                <Stat label="Resolved" value={stats.closed} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Search reference or description…" style={{ height: 30, fontSize: 12, width: 260 }} />
              <select className="input" value={filters.severity} onChange={(e) => setFilter('severity', e.target.value)} style={{ height: 30, fontSize: 12, width: 150 }}>
                <option value="all">All severities</option>
                {DEFECT_SEVERITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className="input" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} style={{ height: 30, fontSize: 12, width: 150 }}>
                <option value="all">Any status</option>
                {DEFECT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--n600)', cursor: 'pointer' }}>
                <input type="checkbox" checked={filters.open} onChange={(e) => setFilter('open', e.target.checked)} />
                Still outstanding
              </label>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading defects…</div>
              ) : error ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
                </div>
              ) : defects.length === 0 ? (
                <div style={{ padding: 64, textAlign: 'center' }}>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 16px' }}>
                    <path d="M20 6l14 26H6L20 6Z" stroke="var(--n300)" strokeWidth="1.5" strokeLinejoin="round" />
                    <path d="M20 16v8M20 27.5v.5" stroke="var(--n300)" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                    {filters.q || filters.severity !== 'all' || filters.status !== 'all' ? 'No defects match these filters' : 'Nothing outstanding'}
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
                    Defects are what an inspection actually found. Recording them here is what connects a finding to the job that clears it — and to the asset&apos;s condition score.
                  </p>
                  {canCreate && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Raise the first defect</button>}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['Ref', 'Defect', 'Severity', 'Asset', 'Fix by', 'Status', 'Job', ''].map((h) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {defects.map((d) => (
                      <tr key={d.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: detail?.id === d.id ? 'var(--b50)' : 'transparent' }} onClick={() => openDetail(d.id)}>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{d.ref}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div>
                          {d.inspection && <div style={{ fontSize: 11, color: 'var(--n500)' }}>Found in {d.inspection.title}</div>}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span className={`badge ${SEVERITY_CLASS[d.severity]}`}>{SEVERITY_LABEL[d.severity]}</span>
                        </td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{d.asset?.ain || '—'}</td>
                        <td style={{ padding: '11px 14px' }}><DueCell defect={d} /></td>
                        <td style={{ padding: '11px 14px' }}>
                          <span className={`badge ${STATUS_CLASS[d.status]}`}>{STATUS_LABEL[d.status]}</span>
                        </td>
                        <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                          {d.work_order ? (
                            <button onClick={(e) => { e.stopPropagation(); nav('/work-orders') }} style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>{d.work_order.ref}</button>
                          ) : (
                            <span style={{ fontSize: 11.5, color: 'var(--n400)' }}>None</span>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {canRaise && !d.work_order && d.status !== 'resolved' && d.status !== 'closed' && (
                            <button onClick={(e) => { e.stopPropagation(); setRaising(d) }} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5, whiteSpace: 'nowrap' }}>Raise job</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {detail && (
              <div style={{ width: 380, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {detail.loading ? (
                  <div style={{ padding: 24, fontSize: 13, color: 'var(--n400)' }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{detail.ref}</div>
                        <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{detail.title}</div>
                      </div>
                      <button onClick={() => setDetail(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <span className={`badge ${SEVERITY_CLASS[detail.severity]}`}>{SEVERITY_LABEL[detail.severity]}</span>
                        <span className={`badge ${STATUS_CLASS[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
                        {detail.category && <span className="badge badge-n">{detail.category}</span>}
                      </div>

                      {detail.description && (
                        <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--n700)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                          {detail.description}
                        </div>
                      )}

                      {/* The chain, in the order it happened. */}
                      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Where this came from</div>
                        <div style={{ padding: '11px 14px', borderBottom: 'var(--bdr)', fontSize: 12, color: 'var(--n700)', lineHeight: 1.6 }}>
                          {detail.inspection
                            ? <>Found during <strong style={{ color: 'var(--n900)' }}>{detail.inspection.title}</strong>{detail.inspection.completed_date ? ` on ${fmtDate(detail.inspection.completed_date)}` : ''}.</>
                            : 'Raised directly, outside an inspection.'}
                        </div>
                        <div style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', lineHeight: 1.6 }}>
                          {detail.work_order
                            ? <>Job <strong style={{ color: 'var(--n900)' }}>{detail.work_order.ref}</strong> raised to clear it, currently {detail.work_order.status.replace('_', ' ')}. Closing it resolves this defect.</>
                            : <span style={{ color: 'var(--n500)' }}>No work order raised yet.</span>}
                        </div>
                      </div>

                      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Details</div>
                        {[
                          ['Asset', detail.asset ? `${detail.asset.ain} — ${detail.asset.name}` : null],
                          ['Site', detail.site?.name],
                          ['Identified', fmtDate(detail.identified_date)],
                          ['Fix by', detail.due_date ? fmtDate(detail.due_date) : null],
                          ['Raised by', detail.reporter?.full_name],
                          ['Assigned to', detail.assignee?.full_name],
                          ['Resolved', detail.resolved_at ? fmtDate(detail.resolved_at) : null],
                        ].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                            <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                            <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v || '—'}</span>
                          </div>
                        ))}
                        {detail.resolution_notes && (
                          <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n700)', lineHeight: 1.55 }}>{detail.resolution_notes}</div>
                        )}
                      </div>

                      {canEdit && (
                        <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '12px 14px' }}>
                          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginBottom: 8 }}>Move it on</div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {DEFECT_STATUSES.filter(([v]) => v !== detail.status).map(([v, l]) => (
                              <button key={v} onClick={() => setStatus(detail.id, v)} className="btn btn-secondary" style={{ height: 28, padding: '0 10px', fontSize: 11.5 }}>{l}</button>
                            ))}
                          </div>
                        </div>
                      )}

                      {canRaise && !detail.work_order && detail.status !== 'resolved' && detail.status !== 'closed' && (
                        <button onClick={() => setRaising(detail)} className="btn btn-primary" style={{ height: 36, fontSize: 13 }}>Raise a work order</button>
                      )}

                      {detail.status !== 'resolved' && detail.status !== 'closed' && (
                        <DeferralSection defect={detail} canSubmit={canSubmitApproval} canRead={canReadApproval} />
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
        <DefectModal
          defect={modal === 'add' ? null : modal}
          assets={assets} sites={sites} inspections={inspections}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); if (detail?.id) openDetail(detail.id) }}
        />
      )}
      {raising && (
        <RaiseModal
          defect={raising}
          onClose={() => setRaising(null)}
          onRaised={() => { setRaising(null); load(); if (detail?.id) openDetail(detail.id) }}
        />
      )}
    </div>
  )
}
