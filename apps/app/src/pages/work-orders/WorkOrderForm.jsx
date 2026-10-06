import { useState } from 'react'
import { createWorkOrder, updateWorkOrder, WO_PRIORITY_LABEL, WO_TYPE_LABEL } from '../../lib/db/workOrders'
import { useCan } from '../../lib/AuthContext.jsx'
import { useToast } from '../../lib/ToastContext'
import { useMoney } from '../../lib/money'
import { useApprovers, ApproverSelect } from '../../components/SendForApproval.jsx'
import { errorText } from '../../lib/errors'
import Modal from '../../components/Modal.jsx'
import { Field, FormError, useForm } from '../../components/form.jsx'

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not the stored ISO.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The one work order form, three ways in:
 * - new, from the Work Orders page: pick the site and asset, and optionally
 *   send it for approval;
 * - new, raised from an asset (`asset`): the asset and its site are fixed;
 * - edit (`wo`): title, description, type, priority, SLA, cost and assignee.
 *   Status moves through the board and the detail panel, never here.
 *
 * There used to be a modal for each, and they had drifted: only the page's
 * could set an SLA or a cost, or send the job for approval.
 */
export function WorkOrderForm({ wo, asset, sites = [], assets = [], users = [], canAssign, onClose, onSaved }) {
  const editing = Boolean(wo)
  const { symbol } = useMoney()
  const can = useCan()
  const toast = useToast()
  // Sending the job for approval raises an approval request as well, so it
  // needs the capability that request needs. Only a new job can be sent.
  const canSendForApproval = !editing && can('approval:create')
  const { approvers, loaded: approversLoaded, lineManagerId } = useApprovers(canSendForApproval)
  const { form, set } = useForm(editing ? {
    title: wo.title || '', description: wo.description || '',
    type: wo.type || 'corrective', priority: wo.priority || 'medium',
    site_id: '', asset_id: '',
    assignee_id: wo.assignee?.id || '', sla_due: toLocalInput(wo.sla_due),
    cost: wo.cost_cents != null ? String(wo.cost_cents / 100) : '',
  } : {
    title: asset ? `Work order — ${asset.name}` : '', description: '', type: 'corrective', priority: 'medium',
    site_id: asset?.site_id || '', asset_id: asset?.id || '',
    assignee_id: '', sla_due: '', cost: '',
  })
  // null = not chosen yet, so it follows the line manager once the list loads;
  // '' = "Don't send, create directly"; otherwise a user id.
  const [approverChoice, setApproverChoice] = useState(null)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const siteAssets = assets.filter((a) => !form.site_id || a.site_id === form.site_id)
  const approverId = canSendForApproval ? (approverChoice ?? lineManagerId ?? '') : ''

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!form.title.trim()) { setErr('Title is required.'); return }
    if (form.cost !== '' && isNaN(Number(form.cost))) { setErr('Cost must be a number.'); return }
    setSaving(true)
    const common = {
      title: form.title.trim(), description: form.description || null,
      type: form.type, priority: form.priority,
      sla_due: form.sla_due || null,
      cost_cents: form.cost === '' ? null : Math.round(Number(form.cost) * 100),
    }
    try {
      if (editing) {
        await updateWorkOrder(wo.id, canAssign ? { ...common, assignee_id: form.assignee_id || null } : common)
        toast.success('Work order updated.')
      } else {
        const assigneeId = canAssign ? (form.assignee_id || null) : null
        const created = await createWorkOrder({
          ...common,
          site_id: form.site_id || null, asset_id: form.asset_id || null,
          assignee_id: assigneeId,
          // A job sent for approval is a draft until it is accepted; the API
          // enforces this regardless of what status is sent. Assigning at
          // creation means it is already assigned.
          status: approverId ? 'draft' : assigneeId ? 'assigned' : 'new',
          ...(approverId ? { approver_id: approverId, approval_notes: approvalNotes.trim() || null } : {}),
        })
        toast.success(approverId
          ? `Work order ${created.ref} created as a draft and sent to ${created.approval?.assignee?.full_name || 'your approver'} for approval.`
          : `Work order ${created.ref} created.`)
      }
      onSaved()
    } catch (ex) {
      setErr(errorText(ex, editing ? 'Save failed.' : 'Create failed.', {
        invalid_assignee: 'That person cannot receive approvals. Choose someone who can decide requests.',
      }))
      setSaving(false)
    }
  }

  const title = editing ? `Edit ${wo.ref}` : asset ? 'Raise Work Order' : 'New Work Order'
  const submitLabel = saving ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : asset ? 'Raise work order' : 'Create work order'

  return (
    <Modal
      title={title}
      width={520}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      nested={editing || Boolean(asset)}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{submitLabel}</button>
        </>
      )}
    >
      {asset && <p style={{ fontSize: 12, color: 'var(--n500)', marginTop: -4 }}>{asset.ain} · {asset.name}</p>}
      <Field label="Title" required>
        <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Brief description of the work" />
      </Field>
      <Field label="Description">
        <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Detailed description, symptoms, observations…" rows={3} style={{ height: 'auto', padding: '8px 10px', resize: 'vertical' }} />
      </Field>
      <div className="form-grid" style={{ gap: 12 }}>
        <Field label="Type">
          <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
            {Object.entries(WO_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
            {Object.entries(WO_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      {!editing && !asset && (
        <div className="form-grid" style={{ gap: 12 }}>
          <Field label="Site">
            <select className="input" value={form.site_id} onChange={(e) => { set('site_id', e.target.value); set('asset_id', '') }}>
              <option value="">Any site</option>
              {/* Shut-down sites stay listed but can't be picked — the API refuses work there. */}
              {sites.map((s) => <option key={s.id} value={s.id} disabled={s.status === 'shutdown'}>{s.name}{s.status === 'shutdown' ? ' (shut down)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Asset">
            <select className="input" value={form.asset_id} onChange={(e) => set('asset_id', e.target.value)}>
              <option value="">No specific asset</option>
              {siteAssets.map((a) => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      <div className="form-grid" style={{ gap: 12 }}>
        <Field label="SLA due date">
          <input className="input" type="datetime-local" value={form.sla_due} onChange={(e) => set('sla_due', e.target.value)} />
        </Field>
        <Field label={`Estimated cost (${symbol})`}>
          <input className="input" type="number" min="0" step="1" value={form.cost} onChange={(e) => set('cost', e.target.value)} placeholder="e.g. 45000" />
        </Field>
      </div>
      {canSendForApproval && (
        <div style={{ padding: '10px 12px', border: 'var(--bdr)', borderRadius: 6, background: 'var(--n50)' }}>
          <Field label="Send for approval to">
            {approversLoaded && approvers.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.5 }}>
                Nobody else in the organisation can decide approvals yet, so this job will be created directly.
              </p>
            ) : (
              <ApproverSelect approvers={approvers} value={approverId} onChange={setApproverChoice}
                noneLabel="Don't send — create directly" />
            )}
          </Field>
          {approverId && (
            <textarea className="input" rows={2} value={approvalNotes} onChange={(e) => setApprovalNotes(e.target.value)}
              placeholder="Note for the approver (optional)"
              style={{ height: 'auto', padding: '8px 10px', marginTop: 8, resize: 'vertical' }} />
          )}
          <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 6, lineHeight: 1.5 }}>
            {approverId
              ? 'The work order stays a Draft until they accept it. They can also forward it to someone above them, return it to you to change, or discard it.'
              : 'The work order is created straight into New, with no approval step.'}
          </p>
        </div>
      )}
      {canAssign && (
        <Field label="Assign to">
          <select className="input" value={form.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
        </Field>
      )}
      <FormError>{err}</FormError>
    </Modal>
  )
}
