import { useState } from 'react'
import { createWorkOrder, WO_TYPE_LABEL, WO_PRIORITY_LABEL } from '../../lib/db/workOrders'
import { useCan } from '../../lib/AuthContext.jsx'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { Field } from './assetBits.jsx'

// ── Raise Work Order Modal ─────────────────────────────────────────────────────
export function RaiseWOModal({ asset, users = [], onClose, onCreated }) {
  const can = useCan()
  const toast = useToast()
  // The Work Orders page has always been able to assign at creation; this
  // asset-context path couldn't, so a WO raised from the asset it concerns
  // always landed unassigned and needed a second trip to route it.
  const canAssign = can('wo:assign')
  const [form, setForm] = useState({ title: `Work order — ${asset.name}`, description: '', type: 'corrective', priority: 'medium', assignee_id: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const inputProps = { className: 'input', style: { width: '100%' } }

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setErr('Title is required.'); return }
    setSaving(true); setErr('')
    try {
      const assigneeId = canAssign ? (form.assignee_id || null) : null
      const wo = await createWorkOrder({
        title: form.title.trim(), description: form.description || null,
        type: form.type, priority: form.priority,
        asset_id: asset.id, site_id: asset.site_id || null,
        assignee_id: assigneeId,
        // Mirrors NewWOModal: assigning at creation means it's already assigned.
        status: assigneeId ? 'assigned' : 'new',
      })
      toast.success(`Work order ${wo.ref} created.`)
      onCreated()
    } catch (ex) { setErr(errorText(ex, 'Failed to raise work order.')); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 440, maxWidth: '92vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 4 }}>Raise Work Order</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{asset.ain} · {asset.name}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title" required>
            <input {...inputProps} value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} className="input" style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }} />
          </Field>
          <div className="form-grid" style={{ gap: 12 }}>
            <Field label="Type">
              <select {...inputProps} value={form.type} onChange={(e) => set('type', e.target.value)}>
                {Object.entries(WO_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select {...inputProps} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {Object.entries(WO_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          {canAssign && (
            <Field label="Assign to">
              <select {...inputProps} value={form.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </Field>
          )}
        </div>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Raising…' : 'Raise work order'}</button>
        </div>
      </form>
    </div>
  )
}
