import { useState, useEffect, useCallback } from 'react'
import { addWorkOrderTask, updateWorkOrderTask, deleteWorkOrderTask, addWorkOrderPart, deleteWorkOrderPart } from '../../lib/db/workOrders'
import { useToast } from '../../lib/ToastContext'
import { useMoney } from '../../lib/money'
import { listSpareParts } from '../../lib/db/spareParts'
import { listApprovals, submitApproval, APPROVAL_STATUS_META } from '../../lib/db/approvals'
import { errorText } from '../../lib/errors'

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

export function Checklist({ wo, canEdit, onChanged }) {
  const toast = useToast()
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const tasks = wo.tasks || []
  const done = tasks.filter((t) => t.done).length

  async function toggle(task) {
    setBusy(true)
    try { await updateWorkOrderTask(wo.id, task.id, { done: !task.done }); await onChanged() }
    catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  async function add(e) {
    e.preventDefault()
    if (!adding.trim()) return
    setBusy(true)
    try { await addWorkOrderTask(wo.id, adding.trim()); setAdding(''); await onChanged() }
    catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
  }

  async function remove(task) {
    setBusy(true)
    try { await deleteWorkOrderTask(wo.id, task.id); await onChanged() }
    catch (e) { toast.error(errorText(e)) } finally { setBusy(false) }
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
export function SpendApproval({ wo, canRead, canSubmit, onChanged }) {
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
      setErr(errorText(ex, 'Could not send the request.', {
        no_matching_rule: 'No approval rule covers job spend at this amount yet. An owner adds one on Approvals → Matrix.',
        already_pending: 'A spend request is already waiting on this job.',
      }))
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

export function PartsSection({ wo, canEdit, onChanged }) {
  const toast = useToast()
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
    catch (e2) { toast.error(errorText(e2)) } finally { setBusy(false) }
  }

  async function remove(line) {
    setBusy(true)
    try { await deleteWorkOrderPart(wo.id, line.id) ; await onChanged() }
    catch (e) { toast.error(errorText(e)) }
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
