import { useState } from 'react'

// Shared assign/reassign picker for PM tasks and inspections — same shape as
// the "Assigned operator" select in Assets.jsx's AssetModal, and the assignee
// selects Work Orders already has (WorkOrders.jsx). One modal instead of
// three near-identical inline forms.
/** "Jane Doe · assigned by Sam Okoro, 14 Mar 25" — shared so the PM task and
 * inspection tables phrase it identically. Returns null when nobody is
 * assigned, so callers can fall back to a dash. */
export function assignmentSummary({ assignee, assigner, assignedAt }) {
  const who = assignee?.full_name
  if (!who) return null
  if (!assigner?.full_name) return who
  const when = assignedAt
    ? `, ${new Date(assignedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}`
    : ''
  return `${who} · assigned by ${assigner.full_name}${when}`
}

export default function AssignModal({ title, subtitle, users, currentId, current, onClose, onSave }) {
  const [userId, setUserId] = useState(currentId || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await onSave(userId || null)
    } catch (ex) { setErr(ex.message || 'Failed to save.'); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 380, maxWidth: '92vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)' }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: current ? 6 : 14 }}>{subtitle}</p>}
        {/* Neither PM tasks nor inspections have a detail view, so this modal
            is the only place the existing assignment can be shown in full. */}
        {current && (
          <p style={{ fontSize: 12, color: 'var(--n600)', marginBottom: 14, background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 4, padding: '6px 10px' }}>
            Currently {current}
          </p>
        )}
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: '100%' }} autoFocus>
          <option value="">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 34, padding: '0 18px', fontSize: 13, opacity: saving ? .7 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
