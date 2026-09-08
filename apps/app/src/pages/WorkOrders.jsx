import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import {
  listWorkOrders, getWorkOrder, createWorkOrder, updateWorkOrder, transitionWorkOrder, addWorkOrderComment,
  uploadWorkOrderAttachment,
  addWorkOrderTask, updateWorkOrderTask, deleteWorkOrderTask,
  addWorkOrderPart, deleteWorkOrderPart,
  WO_TRANSITIONS, WO_STATUS_LABEL, WO_PRIORITY_LABEL, WO_TYPE_LABEL, WO_PRIORITY_STYLE, woStatusStyle,
} from '../lib/db/workOrders'
import { listSites } from '../lib/db/sites'
import { listAssets } from '../lib/db/assets'
import { listOrgUsers } from '../lib/db/orgMembers'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { api } from '../lib/apiClient'
import { useToast } from '../lib/ToastContext'
import { useMoney } from '../lib/money'
import { listSpareParts } from '../lib/db/spareParts'
import { listApprovals, submitApproval, APPROVAL_STATUS_META } from '../lib/db/approvals'
import { useLocationFilter } from '../lib/LocationFilterContext'
import { errorText } from '../lib/errors'

const STATUS_COL_ORDER = ['draft', 'new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed']

function PriorityBadge({ p }) {
  const s = WO_PRIORITY_STYLE[p] || WO_PRIORITY_STYLE.low
  return <StatusBadge tone={s} label={WO_PRIORITY_LABEL[p]} weight={600} uppercase style={{ padding: '1px 6px' }} />
}

function TypeBadge({ t }) {
  return <span style={{ padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 500, background: 'var(--n100)', color: 'var(--n600)', border: '1px solid var(--n200)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{WO_TYPE_LABEL[t] || t}</span>
}

function fmtNaira(cents) {
  if (!cents) return '—'
  const n = cents / 100
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`
  return `₦${n.toLocaleString()}`
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
function NewWOModal({ sites, assets, users, canAssign, onClose, onSave }) {
  const toast = useToast()
  const [form, setForm] = useState({ title: '', description: '', type: 'corrective', priority: 'medium', site_id: '', asset_id: '', assignee_id: '', sla_due: '', cost: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const siteAssets = assets.filter(a => !form.site_id || a.site_id === form.site_id)

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true)
    try {
      if (!form.title.trim()) { setErr('Title is required.'); setSaving(false); return }
      if (form.cost !== '' && isNaN(Number(form.cost))) { setErr('Cost must be a number.'); setSaving(false); return }
      const { cost, assignee_id, ...rest } = form
      const wo = await createWorkOrder({
        ...rest, site_id: form.site_id || null, asset_id: form.asset_id || null, sla_due: form.sla_due || null,
        assignee_id: canAssign ? (assignee_id || null) : null,
        cost_cents: cost === '' ? null : Math.round(Number(cost) * 100),
        status: canAssign && assignee_id ? 'assigned' : 'new',
      })
      toast.success(`Work order ${wo.ref} created.`)
      onSave()
    } catch (ex) { setErr(errorText(ex, 'Create failed.')); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 520, maxWidth: '92vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 28, zIndex: 1, maxHeight: '90vh', overflowY: 'auto' }}>
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
        <div className="form-grid" style={{ gap: 12, marginBottom: 12 }}>
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
        <div className="form-grid" style={{ gap: 12, marginBottom: 12 }}>
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
        <div className="form-grid" style={{ gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>SLA due date</label>
            <input className="input" type="datetime-local" value={form.sla_due} onChange={e => set('sla_due', e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Estimated cost (₦)</label>
            <input className="input" type="number" min="0" step="1" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="e.g. 45000" style={{ width: '100%' }} />
          </div>
        </div>
        {canAssign && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Assign to</label>
            <select className="input" value={form.assignee_id} onChange={e => set('assignee_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </div>
        )}
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

// ── Edit WO Modal ─────────────────────────────────────────────────────────────
// Backed by the (previously UI-orphaned) PATCH /work-orders/:id — title,
// description, type, priority, SLA, cost, and (for wo:assign holders) assignee.
function EditWOModal({ wo, users, canAssign, onClose, onSaved }) {
  const toast = useToast()
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not the stored ISO.
  const toLocalInput = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d)) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [form, setForm] = useState({
    title: wo.title || '', description: wo.description || '',
    type: wo.type || 'corrective', priority: wo.priority || 'medium',
    assignee_id: wo.assignee?.id || '', sla_due: toLocalInput(wo.sla_due),
    cost: wo.cost_cents != null ? String(wo.cost_cents / 100) : '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!form.title.trim()) { setErr('Title is required.'); return }
    if (form.cost !== '' && isNaN(Number(form.cost))) { setErr('Cost must be a number.'); return }
    setSaving(true)
    try {
      const patch = {
        title: form.title.trim(), description: form.description || null,
        type: form.type, priority: form.priority,
        sla_due: form.sla_due || null,
        cost_cents: form.cost === '' ? null : Math.round(Number(form.cost) * 100),
      }
      if (canAssign) patch.assignee_id = form.assignee_id || null
      await updateWorkOrder(wo.id, patch)
      toast.success('Work order updated.')
      onSaved()
    } catch (ex) { setErr(errorText(ex, 'Save failed.')); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 520, maxWidth: '94vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 28, zIndex: 1, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>Edit {wo.ref}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Title *</label>
          <input className="input" value={form.title} onChange={e => set('title', e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Description</label>
          <textarea className="input" value={form.description} onChange={e => set('description', e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} />
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
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>SLA due date</label>
            <input className="input" type="datetime-local" value={form.sla_due} onChange={e => set('sla_due', e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Estimated cost (₦)</label>
            <input className="input" type="number" min="0" step="1" value={form.cost} onChange={e => set('cost', e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>
        {canAssign && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Assign to</label>
            <select className="input" value={form.assignee_id} onChange={e => set('assignee_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </div>
        )}
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? .7 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── WO Detail panel ───────────────────────────────────────────────────────────
// Matches the heading style the activity feed and the rest of the detail
// panel already use, with a slot for a section-level action.
function SectionHead({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)' }}>{children}</div>
      {action}
    </div>
  )
}

function Checklist({ wo, canEdit, onChanged }) {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const tasks = wo.tasks || []
  const done = tasks.filter((t) => t.done).length

  async function toggle(task) {
    setBusy(true)
    try { await updateWorkOrderTask(wo.id, task.id, { done: !task.done }); await onChanged() }
    catch (e) { alert(errorText(e)) } finally { setBusy(false) }
  }

  async function add(e) {
    e.preventDefault()
    if (!adding.trim()) return
    setBusy(true)
    try { await addWorkOrderTask(wo.id, adding.trim()); setAdding(''); await onChanged() }
    catch (e) { alert(errorText(e)) } finally { setBusy(false) }
  }

  async function remove(task) {
    setBusy(true)
    try { await deleteWorkOrderTask(wo.id, task.id); await onChanged() }
    catch (e) { alert(errorText(e)) } finally { setBusy(false) }
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

/**
 * Spend authorisation for a job.
 *
 * The approval matrix has always let an owner configure work_order/wo_cost
 * bands, and the API has always accepted the request — but nothing in the app
 * ever raised one, so `submitApproval` had a single caller (defect deferral)
 * and a spend-authorisation matrix was a form that decided nothing. Setting a
 * Cost still does not gate anything on its own; this is the control that puts
 * the figure in front of whoever the band routes it to.
 */
function SpendApproval({ wo, canRead, canSubmit, onChanged }) {
  const { money } = useMoney()
  const [rows, setRows] = useState([])
  const [asking, setAsking] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!canRead) return
    try { setRows(await listApprovals({ entity_type: 'work_order', entity_id: wo.id })) }
    catch { /* section stays empty rather than breaking the panel */ }
  }, [wo.id, canRead])
  useEffect(() => { load() }, [load])

  if (!canRead) return null

  const amount = Number(wo.cost_cents ?? wo.estimated_cost_cents ?? 0)

  const submit = async () => {
    setErr(''); setBusy(true)
    try {
      await submitApproval({
        entity_type: 'work_order', entity_id: wo.id, kind: 'wo_cost',
        title: `${wo.ref} — spend authorisation`,
        amount_cents: amount,
        notes: notes.trim() || null,
      })
      setAsking(false); setNotes(''); await load(); if (onChanged) await onChanged()
    } catch (ex) {
      setErr(ex.code === 'no_matching_rule'
        ? 'No approval rule covers job spend at this amount yet. An owner adds one on Approvals → Matrix.'
        : ex.code === 'already_pending' ? 'A spend request is already waiting on this job.'
        : errorText(ex, 'Could not send the request.'))
    } finally { setBusy(false) }
  }

  return (
    <div>
      <SectionHead>Spend authorisation</SectionHead>
      {rows.length > 0 && rows.map((a) => {
        const meta = APPROVAL_STATUS_META[a.status] || APPROVAL_STATUS_META.pending
        return (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
            <span style={{ flex: 1, color: 'var(--n700)' }}>
              {a.status === 'pending' ? `With ${a.current_role_label || '—'}` : 'Decided'}
              {a.amount_cents != null ? ` · ${money(a.amount_cents)}` : ''}
            </span>
            <span className={`badge ${meta.cls}`}>{meta.label}</span>
          </div>
        )
      })}

      {rows.length === 0 && !asking && (
        <p style={{ fontSize: 12, color: 'var(--n400)', marginBottom: canSubmit ? 8 : 0 }}>
          No spend authorisation has been requested for this job.
        </p>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--srt)', marginBottom: 8 }}>{err}</div>}

      {canSubmit && !asking && wo.status !== 'closed' && (
        <button onClick={() => setAsking(true)} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>
          Request spend approval
        </button>
      )}

      {canSubmit && asking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.5, margin: 0 }}>
            {amount > 0
              ? <>Sending <strong>{money(amount)}</strong> for authorisation — the band this falls in decides who it goes to.</>
              : <>This job has no cost on it yet, so it will be sent as {money(0)} and will only match a band that starts at zero.</>}
          </p>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Why this spend is needed (optional)"
            className="input" style={{ height: 'auto', padding: '8px 10px', fontSize: 12, resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={submit} disabled={busy} className="btn btn-primary" style={{ height: 30, padding: '0 14px', fontSize: 12 }}>
              {busy ? 'Sending…' : 'Send for approval'}
            </button>
            <button onClick={() => { setAsking(false); setErr('') }} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** What a reserved line actually costs against: what was used once someone
 * recorded it, and what was reserved until then. Referenced twice in the parts
 * table but never defined — the list only ever rendered empty, so the
 * ReferenceError had nowhere to fire until reserved lines started showing. */
// consumed_at, not a null check on quantity_used: the column defaults to 0.00
// rather than null, so `quantity_used ?? quantity_required` reads 0 on every
// line that has not been consumed yet — a reserved part showed as "0x" and
// contributed nothing to the total.
const lineQty = (l) => Number(l.consumed_at ? l.quantity_used : l.quantity_required) || 0

function PartsSection({ wo, canEdit, onChanged }) {
  const { money } = useMoney()
  const [parts, setParts] = useState([])
  const [partId, setPartId] = useState('')
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  // `parts`, not `parts_lines`: GET /work-orders/:id returns { ...wo, activity,
  // tasks, parts, defects }, the joined line rows overriding the work order's
  // own legacy free-text `parts` column. Reading a key nothing ever sets meant
  // reserved parts were written but never shown back.
  const lines = wo.parts || []

  useEffect(() => { listSpareParts().then(setParts).catch(() => setParts([])) }, [])

  async function add(e) {
    e.preventDefault()
    if (!partId || !Number(qty)) return
    setBusy(true)
    try { await addWorkOrderPart(wo.id, { part_id: partId, quantity_required: Number(qty) }); setPartId(''); setQty('1'); await onChanged() }
    catch (e2) { alert(errorText(e2)) } finally { setBusy(false) }
  }

  async function remove(line) {
    setBusy(true)
    try { await deleteWorkOrderPart(wo.id, line.id) ; await onChanged() }
    catch (e) { alert(e.message === 'already_consumed' ? 'That part has already left the store. Reverse it with a stock adjustment instead.' : errorText(e)) }
    finally { setBusy(false) }
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.unit_cost_cents) || 0) * lineQty(l), 0)

  return (
    <div>
      <SectionHead action={lines.length > 0 && <span style={{ fontSize: 11, fontFamily: 'var(--ff-m)', color: 'var(--n500)' }}>{money(total)}</span>}>Parts</SectionHead>

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

function WODetail({ woId, onClose, onUpdate, canTransition, canEdit, canAssign, users }) {
  const toast = useToast()
  const { roleKey, extraCaps } = useAuth()
  const [wo, setWo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWorkOrder(woId).then(d => { if (!cancelled) { setWo(d); setLoading(false) } }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [woId])

  // Ticking a task or moving stock changes the job without changing its
  // status, so those sections refetch rather than patching local state.
  const reload = useCallback(async () => {
    setWo(await getWorkOrder(woId))
    onUpdate()
  }, [woId, onUpdate])

  async function transition(newStatus) {
    setTransitioning(true)
    try {
      const updated = await transitionWorkOrder(wo.id, newStatus)
      const fresh = await getWorkOrder(wo.id)
      setWo(fresh)
      onUpdate()
      toast.success(`Work order moved to ${WO_STATUS_LABEL[newStatus] || newStatus}.`)
    } catch (e) {
      // A close refused for stock is worth spelling out: the API returns every
      // line that fell short and by how much, and 'not enough on hand' on its
      // own leaves a job with five parts on it a guessing game.
      if (e.code === 'insufficient_stock' && e.shortfalls?.length) {
        const lines = e.shortfalls
          .map((s) => `${s.part_number} — need ${s.needed}, ${s.in_stock} on hand`)
          .join('; ')
        toast.error(`Not enough stock to close this job: ${lines}.`)
      } else {
        toast.error(errorText(e, 'Failed to update work order status.'))
      }
    }
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
    } catch (ex) { toast.error(errorText(ex, 'Failed to post comment.')) }
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
    } catch (ex) { toast.error(errorText(ex, 'Failed to upload attachment.')) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function downloadAttachment(att) {
    try { await api.download(`/files/${att.url}`, att.name) }
    catch (ex) { toast.error(errorText(ex, 'Failed to download file.')) }
  }

  if (loading) return (
    <div className="detail-panel" style={{ '--panel-w': '400px', background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 13, color: 'var(--n400)' }}>Loading…</span>
    </div>
  )
  if (!wo) return null

  const nextStatuses = WO_TRANSITIONS[wo.status] || []

  return (
    <div className="detail-panel" style={{ '--panel-w': '400px', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 3 }}>{wo.ref}</div>
          <div style={{ fontFamily: 'var(--ff-d)', fontSize: 15, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px', lineHeight: 1.3 }}>{wo.title}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {canEdit && (
            <button onClick={() => setEditing(true)} title="Edit work order" className="row-action" style={{ height: 40, padding: '0 10px', border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', fontSize: 11, fontWeight: 500, color: 'var(--n600)', fontFamily: 'inherit' }}>
              Edit
            </button>
          )}
          <button onClick={onClose} className="row-action" style={{ flexShrink: 0, width: 40, height: 40, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', color: 'var(--n500)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {wo.status === 'draft' && (
          <div style={{ background: 'var(--sab)', border: '1px solid var(--sabr)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--sat)', lineHeight: 1.5 }}>
            Auto-drafted by the health monitor — review and approve it into <strong>New</strong> below, or close it to dismiss.
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge tone={woStatusStyle(wo.status)} label={WO_STATUS_LABEL[wo.status]} size="md" weight={600} style={{ borderRadius: 3 }} />
          <PriorityBadge p={wo.priority} />
          <TypeBadge t={wo.type} />
        </div>

        <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
          {[
            ['Site', wo.site?.name || '—'],
            ['Asset', wo.asset ? `${wo.asset.ain} — ${wo.asset.name}` : '—'],
            ['Assignee', wo.assignee?.full_name || 'Unassigned'],
            // Who did the assigning. It existed only as an unlabelled byline in
            // the activity feed, under a line reading "Assigned to Jane Doe." —
            // easy to misread as Jane's own entry.
            ['Assigned by', wo.assigner?.full_name
              ? `${wo.assigner.full_name}${wo.assigned_at ? ` · ${new Date(wo.assigned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}` : ''}`
              : '—'],
            ['SLA Due', wo.sla_due ? <SlaDue date={wo.sla_due} /> : '—'],
            ['Cost', fmtNaira(wo.cost_cents)],
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
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8, fontFamily: 'var(--ff-m)' }}>
              {wo.status === 'draft' ? 'Approve draft' : 'Move to'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {nextStatuses.map(s => (
                <button key={s} onClick={() => transition(s)} disabled={transitioning} className="filter-pill"
                  style={{ height: 30, padding: '0 12px', fontSize: 12, fontWeight: 500, border: '1px solid var(--b200)', borderRadius: 4, background: s === 'closed' ? 'var(--sgb)' : 'var(--b50)', color: s === 'closed' ? 'var(--sgt)' : 'var(--b700)', cursor: transitioning ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: transitioning ? .6 : 1 }}>
                  {wo.status === 'draft' ? (s === 'new' ? 'Approve' : 'Dismiss') : WO_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        <Checklist wo={wo} canEdit={canEdit} onChanged={reload} />

        <PartsSection wo={wo} canEdit={canEdit} onChanged={reload} />

        <SpendApproval wo={wo} canRead={can(roleKey, 'approval:read', extraCaps)}
          canSubmit={can(roleKey, 'approval:create', extraCaps)} onChanged={reload} />

        {wo.defects?.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)', marginBottom: 8 }}>Raised from</div>
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

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)' }}>Activity</div>
            {/* Both this and the comment box below post to routes gated on
                wo:update. Offering them to a read-only role produced a control
                that always failed — enforcement was right, the affordance was
                the bug. */}
            {canEdit && (
              <label style={{ fontSize: 11, color: 'var(--b600)', cursor: uploading ? 'not-allowed' : 'pointer' }}>
                {uploading ? 'Uploading…' : 'Attach file'}
                <input ref={fileRef} type="file" onChange={handleAttach} disabled={uploading} style={{ display: 'none' }} />
              </label>
            )}
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

      {canEdit && (
        <form onSubmit={postComment} style={{ borderTop: 'var(--bdr)', padding: '12px 18px', display: 'flex', gap: 8, flexShrink: 0 }}>
          <input value={comment} onChange={e => setComment(e.target.value)} className="input" placeholder="Add a comment…" style={{ flex: 1, height: 34, fontSize: 13 }} />
          <button type="submit" disabled={posting || !comment.trim()} className="btn btn-primary" style={{ height: 34, padding: '0 14px', fontSize: 13, flexShrink: 0, opacity: !comment.trim() ? .5 : 1 }}>Post</button>
        </form>
      )}

      {editing && (
        <EditWOModal wo={wo} users={users} canAssign={canAssign}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false)
            const fresh = await getWorkOrder(wo.id)
            setWo(fresh)
            onUpdate()
          }} />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkOrders({ dark, toggleDark }) {
  const { roleKey, extraCaps, user } = useAuth()
  // extraCaps matters: an admin can grant these per-user in Admin -> Access
  // settings and the API honours them (middleware/rbac.ts), but every
  // can() call here used to omit the third argument, so a granted
  // capability produced a button that never appeared.
  const canCreate     = can(roleKey, 'wo:create', extraCaps)
  const canTransition = can(roleKey, 'wo:transition', extraCaps)
  const canEdit       = can(roleKey, 'wo:update', extraCaps)
  const canAssign     = can(roleKey, 'wo:assign', extraCaps)
  const { locationId: globalLocationId, setLocationId: setGlobalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)

  const [searchParams] = useSearchParams()
  const [wos, setWos] = useState([])
  const [sites, setSites] = useState([])
  const [assets, setAssets] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // 'open' is a client-side pseudo-status (not closed) — no single status
  // value on the backend means "open", so it fetches everything and filters
  // here, same as the dashboard's "Open Work Orders" KPI counts it.
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'all')
  // Supports the Dashboard's "My Open Work" card linking in as ?assignee=me.
  const [mineOnly, setMineOnly] = useState(searchParams.get('assignee') === 'me')
  // ?id=<uuid> — deep link from a notification or from the asset sidebar's
  // work-order list, which used to dump you on an unfiltered page.
  const deepLinkId = searchParams.get('id')
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [w, s, a, u] = await Promise.all([
        listWorkOrders({ status: (filterStatus === 'all' || filterStatus === 'open') ? undefined : filterStatus, locationId: globalLocationId }),
        listSites(), listAssets(), listOrgUsers().catch(() => []),
      ])
      setWos(filterStatus === 'open' ? w.filter(x => x.status !== 'closed') : w)
      setSites(s); setAssets(a); setUsers(u)
    } catch (e) { setError(errorText(e, 'Failed to load work orders.')) }
    finally { setLoading(false) }
  }, [filterStatus, globalLocationId])

  useEffect(() => { load() }, [load])

  // Open the deep-linked WO once the list has arrived. Also clears the status
  // filter, so linking to a draft or closed WO doesn't land on a page that
  // filters it straight back out.
  useEffect(() => {
    if (!deepLinkId || !wos.length) return
    if (!wos.some(w => w.id === deepLinkId)) return
    setFilterStatus('all')
    setMineOnly(false)
    setSelectedId(deepLinkId)
  }, [deepLinkId, wos])

  const visibleWos = mineOnly ? wos.filter(w => w.assignee_id === user?.id) : wos
  const byStatus = STATUS_COL_ORDER.reduce((acc, s) => { acc[s] = visibleWos.filter(w => w.status === s); return acc }, {})

  return (
    <div className="app-shell">
      <Sidebar active="work-orders" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Work Orders" dark={dark} toggleDark={toggleDark} />

        <div style={{ padding: '14px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Work Orders</h1>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>{loading ? 'Loading…' : `${visibleWos.length} orders`}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setMineOnly(m => !m)}
            style={{ height: 28, padding: '0 10px', border: `1px solid ${mineOnly ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 99, background: mineOnly ? 'var(--b50)' : 'var(--n0)', fontSize: 11, fontWeight: mineOnly ? 600 : 400, color: mineOnly ? 'var(--b700)' : 'var(--n600)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Assigned to me
          </button>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['open', 'Open'], ...Object.entries(WO_STATUS_LABEL)].map(([v, l]) => (
              <button key={v} onClick={() => setFilterStatus(v)} className="filter-pill" style={{ height: 28, padding: '0 10px', border: `1px solid ${filterStatus === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filterStatus === v ? 'var(--b50)' : 'var(--n0)', fontSize: 11, color: filterStatus === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filterStatus === v ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', border: '1px solid var(--n200)', borderRadius: 4, overflow: 'hidden' }}>
            {[['list', 'List'], ['kanban', 'Board']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className="filter-pill" style={{ height: 28, padding: '0 12px', border: 'none', borderRight: v === 'list' ? '1px solid var(--n200)' : 'none', background: view === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: view === v ? 'var(--b700)' : 'var(--n600)', fontWeight: view === v ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
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
          <div className="table-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading work orders…</div>
            ) : error ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
              </div>
            ) : visibleWos.length === 0 ? (
              <div style={{ padding: 64, textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                  {mineOnly ? 'No work orders assigned to you' : globalLocation ? `No work orders in ${globalLocation.name}` : 'No work orders'}
                </p>
                {globalLocation ? (
                  <button onClick={() => setGlobalLocationId(null)} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Show all locations</button>
                ) : mineOnly ? (
                  <button onClick={() => setMineOnly(false)} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Show all</button>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>Create a work order to start tracking maintenance activities.</p>
                    {canCreate && <button onClick={() => setShowNew(true)} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Create work order</button>}
                  </>
                )}
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            {w.sla_due ? <SlaDue date={w.sla_due} /> : <span/>}
                            {w.cost_cents > 0 && <span style={{ fontSize: 11, fontFamily: 'var(--ff-m)', color: 'var(--n600)' }}>{fmtNaira(w.cost_cents)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <table className="table-view-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['Ref', 'Title', 'Site', 'Asset', 'Assignee', 'Type', 'Priority', 'Status', 'SLA', ''].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWos.map(w => (
                      <tr key={w.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selectedId === w.id ? 'var(--b50)' : 'transparent' }} onClick={() => setSelectedId(w.id)}>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{w.ref}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--n900)', maxWidth: 260 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{w.site?.name || '—'}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{w.asset?.ain || '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{w.assignee?.full_name || '—'}</td>
                        <td style={{ padding: '10px 14px' }}><TypeBadge t={w.type} /></td>
                        <td style={{ padding: '10px 14px' }}><PriorityBadge p={w.priority} /></td>
                        <td style={{ padding: '10px 14px' }}>
                          <StatusBadge tone={woStatusStyle(w.status)} label={WO_STATUS_LABEL[w.status]} size="md" style={{ borderRadius: 3 }} />
                        </td>
                        <td style={{ padding: '10px 14px' }}><SlaDue date={w.sla_due} /></td>
                        <td style={{ padding: '10px 14px' }}>
                          <button onClick={e => { e.stopPropagation(); setSelectedId(w.id) }} className="row-action" style={{ color: 'var(--n400)', padding: 4 }}>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile card list — same data, tap opens the full-screen detail panel */}
                <div className="card-list">
                  {visibleWos.map(w => (
                    <div key={w.id} className="list-card" onClick={() => setSelectedId(w.id)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{w.ref}</span>
                        <StatusBadge tone={woStatusStyle(w.status)} label={WO_STATUS_LABEL[w.status]} size="md" style={{ borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)', marginBottom: 6, lineHeight: 1.4 }}>{w.title}</div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        <PriorityBadge p={w.priority} /><TypeBadge t={w.type} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--n500)' }}>{w.asset?.ain || w.site?.name || '—'}{w.assignee ? ` · ${w.assignee.full_name}` : ''}</span>
                        {w.sla_due && <SlaDue date={w.sla_due} />}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {selectedId && (
            <WODetail woId={selectedId} onClose={() => setSelectedId(null)} onUpdate={load} canTransition={canTransition} canEdit={canEdit} canAssign={canAssign} users={users} />
          )}
        </div>
      </div>

      {showNew && (
        <NewWOModal sites={sites} assets={assets} users={users} canAssign={canAssign} onClose={() => setShowNew(false)} onSave={() => { setShowNew(false); load() }} />
      )}
    </div>
  )
}
