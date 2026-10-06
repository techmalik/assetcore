import { useState } from 'react'
import { createWorkOrder, WO_PRIORITY_LABEL, WO_TYPE_LABEL } from '../../lib/db/workOrders'
import { useCan } from '../../lib/AuthContext.jsx'
import { useToast } from '../../lib/ToastContext'
import { useMoney } from '../../lib/money'
import { useApprovers, ApproverSelect } from '../../components/SendForApproval.jsx'
import { errorText } from '../../lib/errors'

// ── New WO Modal ──────────────────────────────────────────────────────────────
export function NewWOModal({ sites, assets, users, canAssign, onClose, onSave }) {
  const { symbol } = useMoney()
  const can = useCan()
  const toast = useToast()
  // Sending the job for approval raises an approval request as well, so it
  // needs the capability that request needs.
  const canSendForApproval = can('approval:create')
  const { approvers, loaded: approversLoaded, lineManagerId } = useApprovers(canSendForApproval)
  const [form, setForm] = useState({ title: '', description: '', type: 'corrective', priority: 'medium', site_id: '', asset_id: '', assignee_id: '', sla_due: '', cost: '' })
  // null = not chosen yet, so it follows the line manager once the list loads;
  // '' = "Don't send, create directly"; otherwise a user id.
  const [approverChoice, setApproverChoice] = useState(null)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const siteAssets = assets.filter(a => !form.site_id || a.site_id === form.site_id)
  const approverId = canSendForApproval ? (approverChoice ?? lineManagerId ?? '') : ''

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
        // A job sent for approval is a draft until it is accepted; the API
        // enforces this regardless of what status is sent.
        status: approverId ? 'draft' : canAssign && assignee_id ? 'assigned' : 'new',
        ...(approverId ? { approver_id: approverId, approval_notes: approvalNotes.trim() || null } : {}),
      })
      toast.success(approverId
        ? `Work order ${wo.ref} created as a draft and sent to ${wo.approval?.assignee?.full_name || 'your approver'} for approval.`
        : `Work order ${wo.ref} created.`)
      onSave()
    } catch (ex) {
      setErr(errorText(ex, 'Create failed.', {
        invalid_assignee: 'That person cannot receive approvals. Choose someone who can decide requests.',
      }))
      setSaving(false)
    }
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
              {/* Shut-down sites stay listed but can't be picked — the API refuses work there. */}
              {sites.map(s => <option key={s.id} value={s.id} disabled={s.status === 'shutdown'}>{s.name}{s.status === 'shutdown' ? ' (shut down)' : ''}</option>)}
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
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Estimated cost ({symbol})</label>
            <input className="input" type="number" min="0" step="1" value={form.cost} onChange={e => set('cost', e.target.value)} placeholder="e.g. 45000" style={{ width: '100%' }} />
          </div>
        </div>
        {canSendForApproval && (
          <div style={{ marginBottom: 12, padding: '10px 12px', border: 'var(--bdr)', borderRadius: 6, background: 'var(--n50)' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Send for approval to</label>
            {approversLoaded && approvers.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.5 }}>
                Nobody else in the organisation can decide approvals yet, so this job will be created directly.
              </p>
            ) : (
              <ApproverSelect approvers={approvers} value={approverId} onChange={setApproverChoice}
                noneLabel="Don't send — create directly" />
            )}
            {approverId && (
              <textarea className="input" rows={2} value={approvalNotes} onChange={e => setApprovalNotes(e.target.value)}
                placeholder="Note for the approver (optional)"
                style={{ width: '100%', height: 'auto', padding: '8px 10px', marginTop: 8, resize: 'vertical' }} />
            )}
            <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 6, lineHeight: 1.5 }}>
              {approverId
                ? 'The work order stays a Draft until they accept it. They can also forward it to someone above them, return it to you to change, or discard it.'
                : 'The work order is created straight into New, with no approval step.'}
            </p>
          </div>
        )}
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
