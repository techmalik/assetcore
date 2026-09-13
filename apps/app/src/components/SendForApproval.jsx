// Send a record to a named person for approval, and show where it has got to.
//
// The approval matrix (Approvals → Matrix) routes by role and amount. This
// covers the other way sign-off works on site: the person who did the work
// picks who reviews it, usually their line manager. The reviewer accepts it,
// forwards it up, returns it for changes, or discards it. Mounted on a work
// order, an inspection and a maintenance task, so each gets the same panel
// rather than three slightly different ones.
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import {
  listApprovals, listApprovers, submitApproval, resubmitRequest,
  approvalStatusMeta, EVENT_LABEL, DIRECT_ERROR_TEXT,
} from '../lib/db/approvals'
import { errorText } from '../lib/errors'

export function approvalErrorText(ex, fallback) {
  return DIRECT_ERROR_TEXT[ex?.code] || errorText(ex, fallback)
}

/** The people a request can be sent to, and which of them is the caller's
 * line manager. A failed load leaves the list empty, and the pickers say so,
 * rather than breaking the screen they sit on. */
export function useApprovers(enabled = true) {
  const [approvers, setApprovers] = useState([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    listApprovers()
      .then((rows) => { if (!cancelled) { setApprovers(rows || []); setLoaded(true) } })
      .catch(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [enabled])
  const lineManagerId = approvers.find((a) => a.is_line_manager)?.id || ''
  return { approvers, loaded, lineManagerId }
}

export function approverLabel(a) {
  return `${a.full_name || a.email}${a.role_label ? ` · ${a.role_label}` : ''}${a.is_line_manager ? ' (line manager)' : ''}`
}

/** A person picker for approvals. `noneLabel` adds an empty first option
 * (e.g. "Don't send"); without it the empty option is a disabled prompt. */
export function ApproverSelect({ approvers, value, onChange, noneLabel, excludeIds = [], style }) {
  const shown = approvers.filter((a) => !excludeIds.includes(a.id))
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', ...style }}>
      {noneLabel ? <option value="">{noneLabel}</option> : <option value="" disabled>Choose a person…</option>}
      {shown.map((a) => <option key={a.id} value={a.id}>{approverLabel(a)}</option>)}
    </select>
  )
}

function fmtWhen(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function whereItIs(a) {
  if (a.status === 'pending') {
    return a.route === 'direct' ? `With ${a.assignee?.full_name || '—'}` : `With ${a.current_role_label || '—'}`
  }
  if (a.status === 'returned') return `Returned to ${a.requester?.full_name || 'the requester'}`
  if (a.status === 'recalled') return `Recalled by ${a.requester?.full_name || 'the requester'}`
  return a.approver?.full_name ? `By ${a.approver.full_name}` : 'Concluded'
}

export default function SendForApproval({ entityType, entityId, kind, title, onChanged, heading = 'Approval' }) {
  const { roleKey, extraCaps, user } = useAuth()
  const canRead = can(roleKey, 'approval:read', extraCaps)
  const canSubmit = can(roleKey, 'approval:create', extraCaps)

  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  const { approvers, loaded: approversLoaded, lineManagerId } = useApprovers(canSubmit)
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!canRead || !entityId) return
    try {
      const list = await listApprovals({ entity_type: entityType, entity_id: entityId })
      setRows((list || []).filter((a) => a.kind === kind))
    } catch { /* the section stays empty rather than breaking its host panel */ }
    finally { setLoaded(true) }
  }, [canRead, entityType, entityId, kind])
  useEffect(() => { load() }, [load])

  // The obvious recipient is the line manager; preselect them once the list
  // arrives, without overriding a choice already made.
  useEffect(() => { if (!to && lineManagerId) setTo(lineManagerId) }, [lineManagerId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!canRead) return null

  const pending = rows.find((a) => a.status === 'pending')
  // A returned request is resubmitted rather than replaced, so its history
  // (who returned it and why) stays attached to the same request.
  const returnedToMe = !pending && rows.find((a) => a.status === 'returned' && a.requester_id === user?.id)

  async function send(e) {
    e.preventDefault()
    if (!to) { setErr('Choose who to send it to.'); return }
    setErr(''); setBusy(true)
    try {
      if (returnedToMe) {
        await resubmitRequest(returnedToMe.id, to, notes.trim() || null)
      } else {
        await submitApproval({
          entity_type: entityType, entity_id: entityId, kind,
          title: title || null, notes: notes.trim() || null, assignee_id: to,
        })
      }
      setNotes('')
      await load()
      if (onChanged) await onChanged()
    } catch (ex) {
      setErr(approvalErrorText(ex, 'Could not send it.'))
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--n500)', textTransform: 'uppercase', letterSpacing: '.05em', fontFamily: 'var(--ff-m)', marginBottom: 8 }}>
        {heading}
      </div>

      {rows.map((a) => {
        const meta = approvalStatusMeta(a)
        const ev = a.last_event
        return (
          <div key={a.id} style={{ border: 'var(--bdr)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1, color: 'var(--n800)', fontWeight: 500 }}>{whereItIs(a)}</span>
              <span className={`badge ${meta.cls}`}>{meta.label}</span>
            </div>
            {ev && (
              <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 4, lineHeight: 1.5 }}>
                {ev.actor || 'Someone'} {EVENT_LABEL[ev.action] || ev.action}
                {ev.to_user ? ` to ${ev.to_user}` : ''} · {fmtWhen(ev.created_at)}
                {ev.notes && <div style={{ color: 'var(--n600)', fontStyle: 'italic' }}>&ldquo;{ev.notes}&rdquo;</div>}
              </div>
            )}
          </div>
        )
      })}

      {loaded && rows.length === 0 && !canSubmit && (
        <p style={{ fontSize: 12, color: 'var(--n400)' }}>Not sent for approval.</p>
      )}

      {canSubmit && !pending && (loaded || rows.length > 0) && (
        <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: rows.length ? 4 : 0 }}>
          <label style={{ fontSize: 11.5, color: 'var(--n600)' }}>
            {returnedToMe ? 'Resubmit to' : 'Send to'}
          </label>
          {approversLoaded && approvers.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.5 }}>
              Nobody else in the organisation can decide approvals yet. An administrator grants that through a role or Access settings.
            </p>
          ) : (
            <ApproverSelect approvers={approvers} value={to} onChange={setTo} style={{ height: 32, fontSize: 12 }} />
          )}
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder={returnedToMe ? 'What changed (optional)' : 'Note for the reviewer (optional)'}
            className="input" style={{ height: 'auto', padding: '8px 10px', fontSize: 12, resize: 'vertical' }} />
          {err && <div style={{ fontSize: 12, color: 'var(--srt)' }}>{err}</div>}
          <div>
            <button type="submit" disabled={busy || !to} className="btn btn-primary" style={{ height: 30, padding: '0 14px', fontSize: 12 }}>
              {busy ? 'Sending…' : returnedToMe ? 'Resubmit' : 'Send for approval'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
