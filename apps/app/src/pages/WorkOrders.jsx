import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listWorkOrders, getWorkOrder, createWorkOrder, transitionWorkOrder, addWorkOrderComment,
  uploadWorkOrderAttachment,
  WO_TRANSITIONS, WO_STATUS_LABEL, WO_PRIORITY_LABEL, WO_TYPE_LABEL,
} from '../lib/db/workOrders'
import { listSites } from '../lib/db/sites'
import { listAssets } from '../lib/db/assets'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { api } from '../lib/apiClient'
import { useToast } from '../lib/ToastContext'

const PRIORITY_STYLE = {
  critical: { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)' },
  high:     { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)' },
  medium:   { bg: 'var(--b50)',  c: 'var(--b700)', br: 'var(--b200)' },
  low:      { bg: 'var(--n100)', c: 'var(--n600)', br: 'var(--n300)' },
}

const STATUS_COL_ORDER = ['new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed']

function PriorityBadge({ p }) {
  const s = PRIORITY_STYLE[p] || PRIORITY_STYLE.low
  return <span style={{ display: 'inline-flex', padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 600, background: s.bg, color: s.c, border: `1px solid ${s.br}`, textTransform: 'uppercase', letterSpacing: '.04em' }}>{WO_PRIORITY_LABEL[p]}</span>
}

function TypeBadge({ t }) {
  return <span style={{ padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 500, background: 'var(--n100)', color: 'var(--n600)', border: '1px solid var(--n200)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{WO_TYPE_LABEL[t] || t}</span>
}

function SlaDue({ date }) {
  if (!date) return null
  const d = new Date(date)
  const diffH = (d - Date.now()) / 36e5
  const overdue = diffH < 0
  const urgent = diffH >= 0 && diffH < 24
  const label = overdue ? `Overdue ${Math.abs(Math.ceil(diffH / 24))}d` : diffH < 24 ? `Due in ${Math.ceil(diffH)}h` : `Due ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  return <span style={{ fontSize: 11, color: overdue ? 'var(--srt)' : urgent ? 'var(--sat)' : 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{label}</span>
}

// ── New WO Modal ──────────────────────────────────────────────────────────────
function NewWOModal({ sites, assets, onClose, onSave }) {
  const toast = useToast()
  const [form, setForm] = useState({ title: '', description: '', type: 'corrective', priority: 'medium', site_id: '', asset_id: '', sla_due: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const siteAssets = assets.filter(a => !form.site_id || a.site_id === form.site_id)

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true)
    try {
      if (!form.title.trim()) { setErr('Title is required.'); setSaving(false); return }
      const wo = await createWorkOrder({ ...form, site_id: form.site_id || null, asset_id: form.asset_id || null, sla_due: form.sla_due || null, status: 'new' })
      toast.success(`Work order ${wo.ref} created.`)
      onSave()
    } catch (ex) { setErr(ex.message || 'Create failed.'); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 520, background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 28, zIndex: 1, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>New Work Order</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Title *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Brief description of the work" style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Description</label>
          <textarea className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="Detailed description, symptoms, observations…" rows={3} style={{ width: '100%', resize: 'vertical' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Type</label>
            <select className="input" value={form.type} onChange={e => set('type', e.target.value)} style={{ width: '100%' }}>
              {Object.entries(WO_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Priority</label>
            <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)} style={{ width: '100%' }}>
              {Object.entries(WO_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Site</label>
            <select className="input" value={form.site_id} onChange={e => { set('site_id', e.target.value); set('asset_id', '') }} style={{ width: '100%' }}>
              <option value="">Any site</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Asset</label>
            <select className="input" value={form.asset_id} onChange={e => set('asset_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">No specific asset</option>
              {siteAssets.map(a => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>SLA due date</label>
          <input className="input" type="datetime-local" value={form.sla_due} onChange={e => set('sla_due', e.target.value)} style={{ width: '100%' }} />
        </div>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? .7 : 1 }}>
            {saving ? 'Creating…' : 'Create work order'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── WO Detail panel ───────────────────────────────────────────────────────────
function WODetail({ woId, onClose, onUpdate, canTransition }) {
  const toast = useToast()
  const [wo, setWo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWorkOrder(woId).then(d => { if (!cancelled) { setWo(d); setLoading(false) } }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [woId])

  async function transition(newStatus) {
    setTransitioning(true)
    try {
      const updated = await transitionWorkOrder(wo.id, newStatus)
      const fresh = await getWorkOrder(wo.id)
      setWo(fresh)
      onUpdate()
      toast.success(`Work order moved to ${WO_STATUS_LABEL[newStatus] || newStatus}.`)
    } catch (e) { toast.error(e.message || 'Failed to update work order status.') }
    finally { setTransitioning(false) }
  }

  async function postComment(e) {
    e.preventDefault(); if (!comment.trim()) return
    setPosting(true)
    try {
      await addWorkOrderComment(wo.id, comment)
      setComment('')
      const fresh = await getWorkOrder(wo.id)
      setWo(fresh)
    } catch (ex) { toast.error(ex.message || 'Failed to post comment.') }
    finally { setPosting(false) }
  }

  async function handleAttach(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadWorkOrderAttachment(wo.id, file)
      const fresh = await getWorkOrder(wo.id)
      setWo(fresh)
      toast.success('Attachment uploaded.')
    } catch (ex) { toast.error(ex.message || 'Failed to upload attachment.') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function downloadAttachment(att) {
    try { await api.download(`/files/${att.url}`, att.name) }
    catch (ex) { toast.error(ex.message || 'Failed to download file.') }
  }

  if (loading) return (
    <div style={{ width: 400, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 13, color: 'var(--n400)' }}>Loading…</span>
    </div>
  )
  if (!wo) return null

  const nextStatuses = WO_TRANSITIONS[wo.status] || []

  return (
    <div style={{ width: 400, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 3 }}>{wo.ref}</div>
          <div style={{ fontFamily: 'var(--ff-d)', fontSize: 15, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px', lineHeight: 1.3 }}>{wo.title}</div>
        </div>
        <button onClick={onClose} style={{ flexShrink: 0, width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 600, background: 'var(--b50)', color: 'var(--b700)', border: '1px solid var(--b200)' }}>{WO_STATUS_LABEL[wo.status]}</span>
          <PriorityBadge p={wo.priority} />
          <TypeBadge t={wo.type} />
        </div>

        <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
          {[
            ['Site', wo.site?.name || '—'],
            ['Asset', wo.asset ? `${wo.asset.ain} — ${wo.asset.name}` : '—'],
            ['SLA Due', wo.sla_due ? <SlaDue date={wo.sla_due} /> : '—'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
              <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
              <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </div>

        {wo.description && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6, fontFamily: 'var(--ff-m)' }}>Description</div>
            <p style={{ fontSize: 13, color: 'var(--n700)', lineHeight: 1.65 }}>{wo.description}</p>
          </div>
        )}

        {canTransition && nextStatuses.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, fontFamily: 'var(--ff-m)' }}>Move to</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {nextStatuses.map(s => (
                <button key={s} onClick={() => transition(s)} disabled={transitioning}
                  style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500, border: '1px solid var(--b200)', borderRadius: 4, background: s === 'closed' ? 'var(--sgb)' : 'var(--b50)', color: s === 'closed' ? 'var(--sgt)' : 'var(--b700)', cursor: transitioning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: transitioning ? .6 : 1 }}>
                  {WO_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)' }}>Activity</div>
            <label style={{ fontSize: 11, color: 'var(--b600)', cursor: uploading ? 'not-allowed' : 'pointer' }}>
              {uploading ? 'Uploading…' : 'Attach file'}
              <input ref={fileRef} type="file" onChange={handleAttach} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(wo.activity || []).length === 0 && <p style={{ fontSize: 12, color: 'var(--n400)' }}>No activity yet.</p>}
            {(wo.activity || []).map(a => (
              <div key={a.id} style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--b100)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--b700)' }}>
                  {(a.actor?.full_name || '?')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'var(--n700)', lineHeight: 1.5 }}>
                    {a.kind === 'status_change' ? <em style={{ color: 'var(--n500)' }}>{a.body}</em>
                      : a.kind === 'attachment' ? <span>Attached <strong>{a.body}</strong></span>
                      : a.body}
                  </div>
                  {a.kind === 'attachment' && (a.attachments || []).map((att, i) => (
                    <button key={i} onClick={() => downloadAttachment(att)} style={{ fontSize: 11, color: 'var(--b600)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 2, display: 'block' }}>
                      Download {att.name}
                    </button>
                  ))}
                  <div style={{ fontSize: 10, color: 'var(--n400)', marginTop: 2, fontFamily: 'var(--ff-m)' }}>
                    {a.actor?.full_name || 'Unknown'} · {new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <form onSubmit={postComment} style={{ borderTop: 'var(--bdr)', padding: '12px 18px', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input value={comment} onChange={e => setComment(e.target.value)} className="input" placeholder="Add a comment…" style={{ flex: 1, height: 34, fontSize: 13 }} />
        <button type="submit" disabled={posting || !comment.trim()} className="btn btn-primary" style={{ height: 34, padding: '0 14px', fontSize: 13, flexShrink: 0, opacity: !comment.trim() ? .5 : 1 }}>Post</button>
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkOrders({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canCreate     = can(roleKey, 'wo:create')
  const canTransition = can(roleKey, 'wo:transition')

  const [searchParams] = useSearchParams()
  const [wos, setWos] = useState([])
  const [sites, setSites] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // 'open' is a client-side pseudo-status (not closed) — no single status
  // value on the backend means "open", so it fetches everything and filters
  // here, same as the dashboard's "Open Work Orders" KPI counts it.
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'all')
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [w, s, a] = await Promise.all([
        listWorkOrders({ status: (filterStatus === 'all' || filterStatus === 'open') ? undefined : filterStatus }),
        listSites(), listAssets(),
      ])
      setWos(filterStatus === 'open' ? w.filter(x => x.status !== 'closed') : w)
      setSites(s); setAssets(a)
    } catch (e) { setError(e.message || 'Failed to load work orders.') }
    finally { setLoading(false) }
  }, [filterStatus])

  useEffect(() => { load() }, [load])

  const byStatus = STATUS_COL_ORDER.reduce((acc, s) => { acc[s] = wos.filter(w => w.status === s); return acc }, {})

  return (
    <div className="app-shell">
      <Sidebar active="work-orders" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Work Orders" dark={dark} toggleDark={toggleDark} />

        <div style={{ padding: '14px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Work Orders</h1>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>{loading ? 'Loading…' : `${wos.length} orders`}</p>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['open', 'Open'], ...Object.entries(WO_STATUS_LABEL)].map(([v, l]) => (
              <button key={v} onClick={() => setFilterStatus(v)} style={{ height: 28, padding: '0 10px', border: `1px solid ${filterStatus === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filterStatus === v ? 'var(--b50)' : 'var(--n0)', fontSize: 11, color: filterStatus === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filterStatus === v ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', border: '1px solid var(--n200)', borderRadius: 4, overflow: 'hidden' }}>
            {[['list', 'List'], ['kanban', 'Board']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} style={{ height: 28, padding: '0 12px', border: 'none', borderRight: v === 'list' ? '1px solid var(--n200)' : 'none', background: view === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: view === v ? 'var(--b700)' : 'var(--n600)', fontWeight: view === v ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
            ))}
          </div>
          {canCreate && (
            <button onClick={() => setShowNew(true)} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
              New WO
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading work orders…</div>
            ) : error ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
              </div>
            ) : wos.length === 0 ? (
              <div style={{ padding: 64, textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>No work orders</p>
                <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>Create a work order to start tracking maintenance activities.</p>
                {canCreate && <button onClick={() => setShowNew(true)} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Create work order</button>}
              </div>
            ) : view === 'kanban' ? (
              <div style={{ display: 'flex', gap: 0, height: '100%', overflowX: 'auto' }}>
                {STATUS_COL_ORDER.map(s => (
                  <div key={s} style={{ minWidth: 240, width: 240, flexShrink: 0, borderRight: 'var(--bdr)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--n50)', flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n600)' }}>{WO_STATUS_LABEL[s]}</span>
                      <span style={{ fontSize: 11, background: 'var(--n200)', color: 'var(--n600)', borderRadius: 99, padding: '1px 7px', fontFamily: 'var(--ff-m)' }}>{byStatus[s].length}</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
                      {byStatus[s].map(w => (
                        <div key={w.id} onClick={() => setSelectedId(w.id)} className="row-hover"
                          style={{ background: selectedId === w.id ? 'var(--b50)' : 'var(--n0)', border: `1px solid ${selectedId === w.id ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, cursor: 'pointer' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n900)', marginBottom: 6, lineHeight: 1.4 }}>{w.title}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                            <PriorityBadge p={w.priority} /><TypeBadge t={w.type} />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--n500)' }}>{w.asset?.ain || w.site?.name || '—'}</div>
                          {w.sla_due && <div style={{ marginTop: 4 }}><SlaDue date={w.sla_due} /></div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                    {['Ref', 'Title', 'Site', 'Asset', 'Type', 'Priority', 'Status', 'SLA', ''].map(h => (
                      <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wos.map(w => (
                    <tr key={w.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selectedId === w.id ? 'var(--b50)' : 'transparent' }} onClick={() => setSelectedId(w.id)}>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{w.ref}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--n900)', maxWidth: 260 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{w.site?.name || '—'}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{w.asset?.ain || '—'}</td>
                      <td style={{ padding: '10px 14px' }}><TypeBadge t={w.type} /></td>
                      <td style={{ padding: '10px 14px' }}><PriorityBadge p={w.priority} /></td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 11, fontWeight: 500, background: 'var(--b50)', color: 'var(--b700)', border: '1px solid var(--b200)' }}>{WO_STATUS_LABEL[w.status]}</span>
                      </td>
                      <td style={{ padding: '10px 14px' }}><SlaDue date={w.sla_due} /></td>
                      <td style={{ padding: '10px 14px' }}>
                        <button onClick={e => { e.stopPropagation(); setSelectedId(w.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 4 }}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selectedId && (
            <WODetail woId={selectedId} onClose={() => setSelectedId(null)} onUpdate={load} canTransition={canTransition} />
          )}
        </div>
      </div>

      {showNew && (
        <NewWOModal sites={sites} assets={assets} onClose={() => setShowNew(false)} onSave={() => { setShowNew(false); load() }} />
      )}
    </div>
  )
}
