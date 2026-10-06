import { useState, useEffect } from 'react'
import { listWorkOrders } from '../../lib/db/workOrders'
import { listPMTasks, updatePMTask, uploadMaintenanceReport } from '../../lib/db/pmTasks'
import { completeMaintenance } from '../../lib/db/maintenanceEvents'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { todayISO, addDaysISO } from '../../lib/dates'
import { Field, FormError } from '../../components/form.jsx'
import Modal from '../../components/Modal.jsx'

// ── Complete Maintenance Modal ───────────────────────────────────────────────────
export function CompleteMaintenanceModal({ asset, onClose, onCompleted }) {
  const toast = useToast()
  const [pmTasks, setPMTasks] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [form, setForm] = useState({
    link: '', // '' | `pm:<id>` | `wo:<id>`
    completed_at: addDaysISO(todayISO(), 0),
    next_maintenance_at: addDaysISO(todayISO(), 90),
    notes: '',
  })
  const [report, setReport] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const inputProps = { className: 'input', style: { width: '100%' } }

  useEffect(() => {
    let cancelled = false
    listPMTasks({ asset_id: asset.id, statuses: ['pending', 'in_progress'], limit: 20 }).then((t) => !cancelled && setPMTasks(t)).catch(() => {})
    listWorkOrders({}).then((w) => !cancelled && setWorkOrders(w.filter((x) => x.asset_id === asset.id && x.status !== 'closed'))).catch(() => {})
    return () => { cancelled = true }
  }, [asset.id])

  async function submit(e) {
    e.preventDefault()
    if (form.next_maintenance_at <= form.completed_at) { setErr('Next maintenance date must be after the completion date.'); return }
    setSaving(true); setErr('')
    try {
      const [linkKind, linkId] = form.link ? form.link.split(':') : [null, null]
      await completeMaintenance(asset.id, {
        source: linkKind === 'pm' ? 'pm_task' : linkKind === 'wo' ? 'work_order' : 'manual',
        pm_task_id: linkKind === 'pm' ? linkId : null,
        work_order_id: linkKind === 'wo' ? linkId : null,
        completed_at: form.completed_at,
        next_maintenance_at: form.next_maintenance_at,
        notes: form.notes.trim() || null,
        report: report || undefined,
      })
      toast.success('Maintenance completed — health rescored.')
      onCompleted()
    } catch (ex) { setErr(errorText(ex, 'Failed to record maintenance completion.')); setSaving(false) }
  }

  return (
    <Modal
      title="Complete Maintenance" width={460} as="form" onSubmit={submit} onClose={onClose} nested
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Complete maintenance'}</button>
        </>
      )}
    >
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{asset.ain} · {asset.name} — clears its overdue maintenance, rescores its health and schedules the next maintenance date.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(pmTasks.length > 0 || workOrders.length > 0) && (
            <Field label="Linked to (optional)">
              <select {...inputProps} value={form.link} onChange={(e) => set('link', e.target.value)}>
                <option value="">None — manual completion</option>
                {pmTasks.map((t) => <option key={`pm:${t.id}`} value={`pm:${t.id}`}>PM task: {t.title}</option>)}
                {workOrders.map((w) => <option key={`wo:${w.id}`} value={`wo:${w.id}`}>Work order: {w.ref} — {w.title}</option>)}
              </select>
            </Field>
          )}
          <div className="form-grid" style={{ gap: 12 }}>
            <Field label="Completed on" required>
              <input {...inputProps} type="date" max={addDaysISO(todayISO(), 0)} value={form.completed_at} onChange={(e) => set('completed_at', e.target.value)} />
            </Field>
            <Field label="Next maintenance due" required>
              <input {...inputProps} type="date" min={form.completed_at} value={form.next_maintenance_at} onChange={(e) => set('next_maintenance_at', e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="input" style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }} placeholder="What was done…" />
          </Field>
          <Field label="Report (optional)">
            <input type="file" onChange={(e) => setReport(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </Field>
        </div>
        <FormError style={{ marginTop: 12 }}>{err}</FormError>
    </Modal>
  )
}

// ── PM Task Complete Modal ──────────────────────────────────────────────────────
// Selecting "completed" from the inline status select on a PM task (asset
// detail panel) opens this instead of PATCHing status directly — otherwise
// a task could be marked completed (resetting the asset's health via
// apply_asset_health) with no record of what was done or a report attached.
export function PMTaskCompleteModal({ task, onClose, onCompleted }) {
  const toast = useToast()
  const [completedAt, setCompletedAt] = useState(addDaysISO(todayISO(), 0))
  const [notes, setNotes] = useState('')
  const [report, setReport] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await updatePMTask(task.id, { status: 'completed', completed_at: completedAt, notes: notes.trim() || null })
      if (report) await uploadMaintenanceReport(task.id, report)
      toast.success('PM task completed — health rescored.')
      onCompleted()
    } catch (ex) { setErr(errorText(ex, 'Failed to complete task.')); setSaving(false) }
  }

  return (
    <Modal
      title="Complete PM Task" width={420} as="form" onSubmit={submit} onClose={onClose} nested
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Complete task'}</button>
        </>
      )}
    >
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{task.title} — clears the asset's overdue maintenance, rescores its health and advances the maintenance schedule.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Completed on" required>
            <input className="input" style={{ width: '100%' }} type="date" max={addDaysISO(todayISO(), 0)} value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input" style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }} placeholder="What was done…" />
          </Field>
          <Field label="Report (optional)">
            <input type="file" onChange={(e) => setReport(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </Field>
        </div>
        <FormError style={{ marginTop: 12 }}>{err}</FormError>
    </Modal>
  )
}
