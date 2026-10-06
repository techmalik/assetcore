import { useState, useEffect, useCallback, useRef } from 'react'
import StatusBadge from '../../components/StatusBadge.jsx'
import { getWorkOrder, transitionWorkOrder, addWorkOrderComment, uploadWorkOrderAttachment, WO_TRANSITIONS, WO_STATUS_LABEL, woStatusStyle } from '../../lib/db/workOrders'
import { useCan } from '../../lib/AuthContext.jsx'
import { downloadFile } from '../../lib/db/files'
import { useToast } from '../../lib/ToastContext'
import { useMoney } from '../../lib/money'
import SendForApproval from '../../components/SendForApproval.jsx'
import { errorText } from '../../lib/errors'
import { PriorityBadge, TypeBadge, SlaDue } from './badges.jsx'
import { WorkOrderForm } from './WorkOrderForm.jsx'
import { Checklist, SpendApproval, PartsSection } from './detailSections.jsx'

export function WODetail({ woId, onClose, onUpdate, canTransition, canEdit, canAssign, users }) {
  const { money } = useMoney()
  const can = useCan()
  const toast = useToast()
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
      await transitionWorkOrder(wo.id, newStatus)
      const fresh = await getWorkOrder(wo.id)
      setWo(fresh)
      onUpdate()
      toast.success(`Work order moved to ${WO_STATUS_LABEL[newStatus] || newStatus}.`)
    } catch (e) {
      toast.error(errorText(e, 'Failed to update work order status.'))
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
    try { await downloadFile(att.url, att.name) }
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
            {/* Drafts now come from two places: the health monitor (no creator)
                and a person who sent the job for approval when raising it. */}
            {wo.created_by
              ? <>A draft waiting for approval. It moves to <strong>New</strong> when the person it was sent to accepts it.</>
              : <>Auto-drafted by the health monitor. Review it and approve it into <strong>New</strong> below, or close it to dismiss.</>}
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
            ['Cost', wo.cost_cents ? money(wo.cost_cents) : '—'],
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

        <SpendApproval wo={wo} canRead={can('approval:read')}
          canSubmit={can('approval:create')} onChanged={reload} />

        {/* Letting a draft go ahead, decided by the person it is sent to.
            Accepting it moves the job to New on the server. */}
        {wo.status === 'draft' && (
          <SendForApproval entityType="work_order" entityId={wo.id} kind="wo_approval"
            title={`${wo.ref} — ${wo.title}`} heading="Approval to proceed" onChanged={reload} />
        )}

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
        <WorkOrderForm wo={wo} users={users} canAssign={canAssign}
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
