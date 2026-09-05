import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listWorkOrders, getWorkOrder, createWorkOrder, transitionWorkOrder, addWorkOrderComment,
  addWorkOrderTask, updateWorkOrderTask, deleteWorkOrderTask,
  addWorkOrderPart, deleteWorkOrderPart,
  uploadWorkOrderAttachment,
  WO_TRANSITIONS, WO_STATUS_LABEL, WO_PRIORITY_LABEL, WO_TYPE_LABEL,
} from '../lib/db/workOrders'
import { listSites } from '../lib/db/sites'
import { listAssets } from '../lib/db/assets'
import { listSpareParts } from '../lib/db/spareParts'
import { listApprovals, submitApproval, APPROVAL_KINDS, KIND_LABEL, APPROVAL_STATUS_META } from '../lib/db/approvals'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { api } from '../lib/apiClient'

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
  const [form, setForm] = useState({ title: '', description: '', type: 'corrective', priority: 'medium', site_id: '', asset_id: '', sla_due: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const siteAssets = assets.filter(a => !form.site_id || a.site_id === form.site_id)

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true)
    try {
      if (!form.title.trim()) { setErr('Title is required.'); setSaving(false); return }
      await createWorkOrder({ ...form, site_id: form.site_id || null, asset_id: form.asset_id || null, sla_due: form.sla_due || null, status: 'new' })
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

function naira(cents) {
  if (cents === null || cents === undefined || cents === '') return '—'
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return '—'
  return `₦${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function SectionHead({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)' }}>{children}</div>
      {action}
    </div>
  )
}

// ── Task checklist ────────────────────────────────────────────────────────────
// The steps the job is worked from. Ticking one records who and when.
function Checklist({ wo, canEdit, onChanged }) {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const tasks = wo.tasks || []
  const done = tasks.filter((t) => t.done).length

  async function toggle(task) {
    setBusy(true)
    try { await updateWorkOrderTask(wo.id, task.id, { done: !task.done }); await onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  async function add(e) {
    e.preventDefault()
    if (!adding.trim()) return
    setBusy(true)
    try { await addWorkOrderTask(wo.id, adding.trim()); setAdding(''); await onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  async function remove(task) {
    setBusy(true)
    try { await deleteWorkOrderTask(wo.id, task.id); await onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <SectionHead action={tasks.length > 0 && (
        <span style={{ fontSize: 11, fontFamily: 'var(--ff-m)', color: done === tasks.length ? 'var(--sgt)' : 'var(--n500)' }}>{done}/{tasks.length} done</span>
      )}>Checklist</SectionHead>

      {tasks.length === 0 && !canEdit && <p style={{ fontSize: 12, color: 'var(--n400)' }}>No steps recorded.</p>}

      {tasks.length > 0 && (
        <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden', marginBottom: canEdit ? 8 : 0 }}>
          {tasks.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '8px 12px', borderBottom: 'var(--bdr)' }}>
              <input type="checkbox" checked={t.done} disabled={!canEdit || busy} onChange={() => toggle(t)} style={{ marginTop: 2, cursor: canEdit ? 'pointer' : 'default' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: t.done ? 'var(--n500)' : 'var(--n800)', textDecoration: t.done ? 'line-through' : 'none', lineHeight: 1.45 }}>{t.description}</div>
                {t.done && t.completed_by && (
                  <div style={{ fontSize: 10.5, color: 'var(--n400)', fontFamily: 'var(--ff-m)', marginTop: 2 }}>
                    {t.completed_by.full_name} · {new Date(t.done_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              {canEdit && (
                <button onClick={() => remove(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 2, display: 'flex' }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <form onSubmit={add} style={{ display: 'flex', gap: 6 }}>
          <input className="input" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a step…" style={{ flex: 1, height: 30, fontSize: 12 }} />
          <button type="submit" disabled={!adding.trim() || busy} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12, opacity: adding.trim() ? 1 : 0.5 }}>Add</button>
        </form>
      )}
    </div>
  )
}

// pg returns numeric columns as strings, and "0.00" is truthy — so pick the
// used quantity only when it is actually greater than zero.
function lineQty(line) {
  const used = Number(line.quantity_used)
  return used > 0 ? used : Number(line.quantity_required)
}

// ── Parts drawn against the job ───────────────────────────────────────────────
// Lines point at real stock. Nothing leaves the store until the job is closed,
// which is when the deduction and the ledger entry happen together.
function PartsSection({ wo, canEdit, onChanged }) {
  const [parts, setParts] = useState([])
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const lines = wo.parts_lines || []

  useEffect(() => { listSpareParts().then(setParts).catch(() => setParts([])) }, [])

  async function add(e) {
    e.preventDefault()
    if (!partId || !Number(qty)) return
    setBusy(true)
    try { await addWorkOrderPart(wo.id, { part_id: partId, quantity_required: Number(qty) }); setPartId(''); setQty('1'); await onChanged() }
    catch (e2) { alert(e2.message) } finally { setBusy(false) }
  }

  async function remove(line) {
    setBusy(true)
    try { await deleteWorkOrderPart(wo.id, line.id) ; await onChanged() }
    catch (e) { alert(e.message === 'already_consumed' ? 'That part has already left the store. Reverse it with a stock adjustment instead.' : e.message) }
    finally { setBusy(false) }
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.unit_cost_cents) || 0) * lineQty(l), 0)

  return (
    <div>
      <SectionHead action={lines.length > 0 && <span style={{ fontSize: 11, fontFamily: 'var(--ff-m)', color: 'var(--n500)' }}>{naira(total)}</span>}>Parts</SectionHead>

      {lines.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--n400)', marginBottom: canEdit ? 8 : 0 }}>No parts reserved for this job.</p>
      ) : (
        <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden', marginBottom: canEdit ? 8 : 0 }}>
          {lines.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderBottom: 'var(--bdr)' }}>
              <span style={{ fontFamily: 'var(--ff-m)', fontSize: 12, color: 'var(--n800)', width: 34, flexShrink: 0 }}>
                {lineQty(l)}×
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--n800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.part ? l.part.name : l.description}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>
                  {l.part ? `${l.part.part_number} · ${Number(l.part.quantity_in_stock)} in stock` : 'One-off item'}
                </div>
              </div>
              {l.consumed_at
                ? <span className="badge badge-g">Taken</span>
                : <span className="badge badge-n">Reserved</span>}
              {canEdit && !l.consumed_at && (
                <button onClick={() => remove(l)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 2, display: 'flex' }}>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && wo.status !== 'closed' && (
        <form onSubmit={add} style={{ display: 'flex', gap: 6 }}>
          <select className="input" value={partId} onChange={(e) => setPartId(e.target.value)} style={{ flex: 1, height: 30, fontSize: 12, minWidth: 0 }}>
            <option value="">Add a part…</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.part_number} — {p.name} ({Number(p.quantity_in_stock)} {p.unit})</option>)}
          </select>
          <input className="input" type="number" min="0.01" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 62, height: 30, fontSize: 12, fontFamily: 'var(--ff-m)' }} />
          <button type="submit" disabled={!partId || busy} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12, opacity: partId ? 1 : 0.5 }}>Add</button>
        </form>
      )}
    </div>
  )
}

// ── Close dialog ──────────────────────────────────────────────────────────────
// Closing is the one moment the job's story can still be captured, so the
// report is collected here rather than left to a free-text comment.
function CloseDialog({ wo, onClose, onClosed }) {
  const [f, setF] = useState({
    completion_notes: '', root_cause: '', failure_mode: '', corrective_actions: '',
    safety_observations: '', actual_hours: '', downtime_hours: '', cost_naira: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [shortfalls, setShortfalls] = useState(null)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const reserved = (wo.parts_lines || []).filter((l) => !l.consumed_at && l.part_id)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setShortfalls(null); setBusy(true)
    const report = {
      completion_notes: f.completion_notes.trim() || null,
      root_cause: f.root_cause.trim() || null,
      failure_mode: f.failure_mode.trim() || null,
      corrective_actions: f.corrective_actions.trim() || null,
      safety_observations: f.safety_observations.trim() || null,
      actual_hours: f.actual_hours === '' ? null : Number(f.actual_hours),
      downtime_hours: f.downtime_hours === '' ? null : Number(f.downtime_hours),
      cost_cents: f.cost_naira === '' ? null : Math.round(Number(f.cost_naira) * 100),
    }
    for (const k of Object.keys(report)) if (report[k] === null) delete report[k]
    try {
      await transitionWorkOrder(wo.id, 'closed', f.completion_notes.trim() || 'Work order closed', report)
      await onClosed()
    } catch (ex) {
      // The server rolled the close back rather than letting stock go negative.
      if (ex.status === 409 && ex.payload?.shortfalls) setShortfalls(ex.payload.shortfalls)
      else if (ex.status === 409) setErr('That status change is no longer valid — reload the work order.')
      else setErr(ex.message || 'Could not close the work order.')
      setBusy(false)
    }
  }

  const F = ({ label, k, rows, hint, type }) => (
    <div>
      <label className="label" style={{ display: 'block', marginBottom: 5 }}>{label}</label>
      {rows
        ? <textarea className="input" rows={rows} value={f[k]} onChange={(e) => set(k, e.target.value)} style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />
        : <input className="input" type={type || 'text'} step="0.01" min="0" value={f[k]} onChange={(e) => set(k, e.target.value)} style={{ width: '100%', fontFamily: type === 'number' ? 'var(--ff-m)' : 'inherit' }} />}
      {hint && <p style={{ fontSize: 11, color: 'var(--n500)', marginTop: 4 }}>{hint}</p>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 600, maxHeight: '90vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)' }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>Close {wo.ref}</h3>
          <p style={{ fontSize: 12, color: 'var(--n500)' }}>
            {reserved.length > 0
              ? `${reserved.length} reserved part${reserved.length === 1 ? '' : 's'} will be taken out of stock.`
              : 'Everything here is optional, but it is what makes the history worth having.'}
          </p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <F label="Hours worked" k="actual_hours" type="number" hint={wo.estimated_hours ? `Estimated ${wo.estimated_hours}` : undefined} />
            <F label="Downtime (hours)" k="downtime_hours" type="number" />
            <F label="Actual cost (₦)" k="cost_naira" type="number" hint={wo.estimated_cost_cents ? `Est. ${naira(wo.estimated_cost_cents)}` : undefined} />
          </div>
          <F label="What was wrong (root cause)" k="root_cause" rows={2} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <F label="Failure mode" k="failure_mode" />
            <F label="Safety observations" k="safety_observations" />
          </div>
          <F label="What was done" k="corrective_actions" rows={2} />
          <F label="Closing notes" k="completion_notes" rows={2} hint="Posted to the activity thread as well." />

          {shortfalls && (
            <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--srt)' }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>Not enough stock — nothing was closed or deducted.</strong>
              {shortfalls.map((sf) => (
                <div key={sf.part_number} style={{ fontFamily: 'var(--ff-m)', fontSize: 11.5 }}>
                  {sf.part_number} — needs {sf.needed}, only {sf.in_stock} on hand
                </div>
              ))}
              <div style={{ marginTop: 6 }}>Receive the stock in Spare Parts, then close this job again.</div>
            </div>
          )}
          {err && <p style={{ fontSize: 12, color: 'var(--srt)' }}>{err}</p>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Closing…' : 'Close work order'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Send a job for approval.
 *
 * Requests are raised from the thing being approved rather than from the
 * approvals page: closure sign-off and spend authorisation both belong to a
 * job, and asking someone to re-key its reference somewhere else is how the
 * two drift apart. The matrix does the routing — this only has to say what is
 * being approved and for how much.
 */
function SubmitApprovalModal({ wo, onClose, onSubmitted }) {
  const [kind, setKind] = useState('wo_closure')
  const [amountNaira, setAmountNaira] = useState(
    wo.cost_cents != null ? String(Number(wo.cost_cents) / 100)
      : wo.estimated_cost_cents != null ? String(Number(wo.estimated_cost_cents) / 100) : ''
  )
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await submitApproval({
        entity_type: 'work_order',
        entity_id: wo.id,
        kind,
        title: `${wo.ref} — ${KIND_LABEL[kind]}`,
        amount_cents: amountNaira === '' ? null : Math.round(Number(amountNaira) * 100),
        notes: notes.trim() || null,
      })
      onSubmitted()
    } catch (ex) {
      const map = {
        no_matching_rule: 'No approval band covers that amount for this kind of request. An owner sets the bands on Approvals → Matrix.',
        already_pending: 'There is already a request of this kind waiting on this job.',
      }
      setErr(map[ex.message] || ex.message || 'Could not submit the request.')
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 460, background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)' }}>Send for approval</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{wo.ref} — {wo.title}</p>

        <label className="label" style={{ display: 'block', marginBottom: 5 }}>What is being approved</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {APPROVAL_KINDS.work_order.map(([v, l, hint]) => (
            <button key={v} type="button" onClick={() => setKind(v)}
              style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${kind === v ? 'var(--b400)' : 'var(--n200)'}`,
                background: kind === v ? 'var(--slb)' : 'var(--n0)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: kind === v ? 'var(--slt)' : 'var(--n800)' }}>{l}</div>
              <div style={{ fontSize: 11, color: 'var(--n500)' }}>{hint}</div>
            </button>
          ))}
        </div>

        <label className="label" style={{ display: 'block', marginBottom: 5 }}>Amount (₦)</label>
        <input className="input" type="number" min={0} step="0.01" value={amountNaira} onChange={(e) => setAmountNaira(e.target.value)}
          style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
        <p style={{ fontSize: 11.5, color: 'var(--n500)', margin: '5px 0 14px', lineHeight: 1.55 }}>
          The amount decides which band the request falls into, and therefore who signs it. Prefilled from the
          job&apos;s actual cost where there is one, its estimate otherwise.
        </p>

        <label className="label" style={{ display: 'block', marginBottom: 5 }}>Notes for the approver</label>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />

        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12, lineHeight: 1.5 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
    </div>
  )
}

/** Approval requests raised against this job, and the button to raise one. */
function ApprovalsSection({ wo, canSubmit, canRead }) {
  const [rows, setRows] = useState([])
  const [modal, setModal] = useState(false)

  const load = useCallback(async () => {
    if (!canRead) return
    try { setRows(await listApprovals({ entity_type: 'work_order', entity_id: wo.id })) } catch { /* section stays empty */ }
  }, [wo.id, canRead])
  useEffect(() => { load() }, [load])

  if (!canRead) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)' }}>Approvals</span>
        <div style={{ flex: 1 }} />
        {canSubmit && (
          <button onClick={() => setModal(true)} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Send for approval</button>
        )}
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--n400)' }}>Nothing sent for approval on this job.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((a) => {
            const meta = APPROVAL_STATUS_META[a.status] || APPROVAL_STATUS_META.pending
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ flex: 1, color: 'var(--n800)' }}>{KIND_LABEL[a.kind] || a.kind}</span>
                <span style={{ fontSize: 11, color: 'var(--n500)', whiteSpace: 'nowrap' }}>
                  {a.status === 'pending' ? `with ${a.current_role_label || '—'}, step ${a.level}/${a.max_levels}` : ''}
                </span>
                <span className={`badge ${meta.cls}`}>{meta.label}</span>
              </div>
            )
          })}
        </div>
      )}
      {modal && (
        <SubmitApprovalModal wo={wo} onClose={() => setModal(false)} onSubmitted={() => { setModal(false); load() }} />
      )}
    </div>
  )
}

function WODetail({ woId, onClose, onUpdate, canTransition, canEdit, canSubmitApproval, canReadApproval }) {
  const [wo, setWo] = useState(null)
  const [closing, setClosing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  // The detail payload carries part LINES under `parts`, while the work order
  // row still has its legacy `parts` JSON column. Rename on the way in so the
  // two never get confused.
  const normalise = (d) => ({ ...d, parts_lines: d.parts || [] })

  const reload = useCallback(async () => {
    const fresh = await getWorkOrder(woId)
    setWo(normalise(fresh))
  }, [woId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWorkOrder(woId)
      .then(d => { if (!cancelled) { setWo(normalise(d)); setLoading(false) } })
      .catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [woId])

  async function transition(newStatus) {
    // Closing collects the completion report and draws parts out of stock, so
    // it goes through its own dialog rather than a bare status change.
    if (newStatus === 'closed') { setClosing(true); return }
    setTransitioning(true)
    try {
      await transitionWorkOrder(wo.id, newStatus)
      await reload()
      onUpdate()
    } catch (e) { alert(e.message) }
    finally { setTransitioning(false) }
  }

  async function postComment(e) {
    e.preventDefault(); if (!comment.trim()) return
    setPosting(true)
    try {
      await addWorkOrderComment(wo.id, comment)
      setComment('')
      await reload()
    } catch (ex) { alert(ex.message) }
    finally { setPosting(false) }
  }

  async function handleAttach(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadWorkOrderAttachment(wo.id, file)
      await reload()
    } catch (ex) { alert(ex.message) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function downloadAttachment(att) {
    try { await api.download(`/files/${att.url}`, att.name) }
    catch (ex) { alert(ex.message) }
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
            ['Planned', wo.planned_start ? `${wo.planned_start}${wo.planned_end ? ` → ${wo.planned_end}` : ''}` : '—'],
            ['Hours', wo.actual_hours != null || wo.estimated_hours != null
              ? `${wo.actual_hours != null ? wo.actual_hours : '—'} actual / ${wo.estimated_hours != null ? wo.estimated_hours : '—'} est`
              : '—'],
            ['Cost', wo.cost_cents != null || wo.estimated_cost_cents != null
              ? `${naira(wo.cost_cents)} actual / ${naira(wo.estimated_cost_cents)} est`
              : '—'],
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

        <Checklist wo={wo} canEdit={canEdit} onChanged={async () => { await reload(); onUpdate() }} />

        <PartsSection wo={wo} canEdit={canEdit} onChanged={async () => { await reload(); onUpdate() }} />

        {wo.defects?.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, fontFamily: 'var(--ff-m)' }}>Raised from</div>
            {wo.defects.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{d.ref}</span>
                <span style={{ flex: 1, color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                <span className="badge badge-n" style={{ textTransform: 'capitalize' }}>{d.severity}</span>
              </div>
            ))}
            <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 6, lineHeight: 1.5 }}>
              Closing this job resolves {wo.defects.length === 1 ? 'it' : 'them'}.
            </p>
          </div>
        )}

        <ApprovalsSection wo={wo} canSubmit={canSubmitApproval} canRead={canReadApproval} />

        {wo.status === 'closed' && (wo.root_cause || wo.corrective_actions || wo.completion_notes || wo.failure_mode || wo.safety_observations || wo.downtime_hours != null) && (
          <div>
            <SectionHead>Completion report</SectionHead>
            <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
              {[
                ['Root cause', wo.root_cause],
                ['Failure mode', wo.failure_mode],
                ['What was done', wo.corrective_actions],
                ['Safety observations', wo.safety_observations],
                ['Downtime', wo.downtime_hours != null ? `${wo.downtime_hours} hours` : null],
                ['Notes', wo.completion_notes],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ padding: '9px 12px', borderBottom: 'var(--bdr)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--n500)', fontFamily: 'var(--ff-m)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>{k}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--n800)', lineHeight: 1.5 }}>{v}</div>
                </div>
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

      {closing && (
        <CloseDialog
          wo={wo}
          onClose={() => setClosing(false)}
          onClosed={async () => { setClosing(false); await reload(); onUpdate() }}
        />
      )}

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
  const canSubmitApproval = can(roleKey, 'approval:create')
  const canReadApproval = can(roleKey, 'approval:read')
  const canEditWO     = can(roleKey, 'wo:update')

  const [wos, setWos] = useState([])
  const [sites, setSites] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [w, s, a] = await Promise.all([
        listWorkOrders({ status: filterStatus === 'all' ? undefined : filterStatus }),
        listSites(), listAssets(),
      ])
      setWos(w); setSites(s); setAssets(a)
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
            {[['all', 'All'], ...Object.entries(WO_STATUS_LABEL)].map(([v, l]) => (
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
            <WODetail woId={selectedId} onClose={() => setSelectedId(null)} onUpdate={load} canTransition={canTransition} canEdit={canEditWO}
              canSubmitApproval={canSubmitApproval} canReadApproval={canReadApproval} />
          )}
        </div>
      </div>

      {showNew && (
        <NewWOModal sites={sites} assets={assets} onClose={() => setShowNew(false)} onSave={() => { setShowNew(false); load() }} />
      )}
    </div>
  )
}
