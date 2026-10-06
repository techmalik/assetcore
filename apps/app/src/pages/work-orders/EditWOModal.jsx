import { useState } from 'react'
import { updateWorkOrder, WO_PRIORITY_LABEL, WO_TYPE_LABEL } from '../../lib/db/workOrders'
import { useToast } from '../../lib/ToastContext'
import { useMoney } from '../../lib/money'
import { errorText } from '../../lib/errors'

// ── Edit WO Modal ─────────────────────────────────────────────────────────────
// Backed by the (previously UI-orphaned) PATCH /work-orders/:id — title,
// description, type, priority, SLA, cost, and (for wo:assign holders) assignee.
export function EditWOModal({ wo, users, canAssign, onClose, onSaved }) {
  const { symbol } = useMoney()
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
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Estimated cost ({symbol})</label>
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
