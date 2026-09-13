import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listApprovals, getApproval, getApprovalStats, listApprovalRules,
  createApprovalRule, updateApprovalRule, retireApprovalRule,
  approveRequest, rejectRequest, recallRequest,
  forwardRequest, returnRequest, discardRequest, resubmitRequest,
  APPROVAL_ENTITY_TYPES, ENTITY_LABEL, APPROVAL_KINDS, KIND_LABEL,
  approvalStatusMeta, EVENT_LABEL, DIRECT_ERROR_TEXT,
} from '../lib/db/approvals'
import { useApprovers, ApproverSelect } from '../components/SendForApproval.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { can, ROLE_LABELS } from '../lib/rbac'
import { useMoney, Money } from '../lib/money'
import { errorText } from '../lib/errors'

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).filter(([k]) => k !== 'viewer')


function fmtWhen(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value, tone }) {
  const color = tone === 'warn' ? 'var(--sat)' : tone === 'bad' ? 'var(--srt)' : 'var(--n900)'
  return (
    <div style={{ padding: '12px 16px', borderRight: 'var(--bdr)', flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: 20, fontWeight: 500, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

/** Where a request has got to: one dot per level, filled up to the current one. */
function LevelTrack({ approval }) {
  const dots = Array.from({ length: approval.max_levels }, (_, i) => i + 1)
  const settled = approval.status !== 'pending'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {dots.map((n) => {
        const done = approval.status === 'approved' || n < approval.level
        const current = approval.status === 'pending' && n === approval.level
        return (
          <span key={n} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: done ? 'var(--sg)' : current ? 'var(--sa)' : 'var(--n200)',
            outline: current ? '2px solid var(--sab)' : 'none',
            opacity: settled && !done ? 0.4 : 1,
          }} />
        )
      })}
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 10.5, color: 'var(--n500)', marginLeft: 3 }}>
        {approval.status === 'pending' ? `${approval.level}/${approval.max_levels}` : `${approval.max_levels} step${approval.max_levels === 1 ? '' : 's'}`}
      </span>
    </span>
  )
}

// ── Decision ─────────────────────────────────────────────────────────────────
// One modal for every action on a request, matrix or person-routed. The
// actions differ mainly in whether they need a person (forward, resubmit), and
// whether they need a reason the requester will read (reject, return, discard).
const ACTION_VERB = {
  approve: 'Approve', reject: 'Reject', recall: 'Recall',
  forward: 'Forward', return: 'Return', discard: 'Discard', resubmit: 'Resubmit',
}
const NEEDS_REASON = ['reject', 'return', 'discard']
const NEEDS_PERSON = ['forward', 'resubmit']

function DecisionModal({ approval, action, onClose, onDone }) {
  const { money } = useMoney()
  const { user } = useAuth()
  const direct = approval.route === 'direct'
  const needsPerson = NEEDS_PERSON.includes(action)
  const needsReason = NEEDS_REASON.includes(action)
  const [notes, setNotes] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { approvers, loaded: approversLoaded, lineManagerId } = useApprovers(needsPerson)

  // Forwarding goes "above me", which is usually my line manager, so
  // preselect them. Never the requester, whom the API refuses as a target.
  useEffect(() => {
    if (needsPerson && !to && lineManagerId && lineManagerId !== approval.requester_id) setTo(lineManagerId)
  }, [lineManagerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const verb = direct && action === 'approve' ? 'Accept' : ACTION_VERB[action]
  const lastStep = approval.level >= approval.max_levels
  const destructive = needsReason || action === 'recall'

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (needsPerson && !to) { setErr('Choose who it goes to.'); return }
    if (needsReason && !notes.trim()) { setErr('Say why. The requester sees this note.'); return }
    setBusy(true)
    try {
      if (action === 'approve') await approveRequest(approval.id, notes)
      else if (action === 'reject') await rejectRequest(approval.id, notes)
      else if (action === 'forward') await forwardRequest(approval.id, to, notes)
      else if (action === 'return') await returnRequest(approval.id, notes.trim())
      else if (action === 'discard') await discardRequest(approval.id, notes.trim())
      else if (action === 'resubmit') await resubmitRequest(approval.id, to, notes)
      else await recallRequest(approval.id, notes)
      onDone()
    } catch (ex) {
      const map = {
        self_approval: 'You submitted this request, so you cannot sign it off. It needs someone else.',
        wrong_approver: 'This request is not waiting on your role.',
        not_pending: 'This request has already been decided.',
        not_requester: 'Only the person who submitted a request can do that.',
        ...DIRECT_ERROR_TEXT,
      }
      setErr(map[ex.code] || errorText(ex, 'That did not go through.'))
      setBusy(false)
    }
  }

  const explain = {
    approve: direct
      ? ' — accepting concludes it and keeps it on record.'
      : lastStep
        ? ' — this is the final step; approving settles the request.'
        : ` — step ${approval.level} of ${approval.max_levels}; approving passes it to the next level.`,
    reject: ' — rejection ends the request. The requester submits again rather than it going back a step.',
    forward: ' — it moves to the person you choose and leaves your inbox.',
    return: ' — it goes back to the requester to fix and resubmit.',
    discard: ' — this concludes it without accepting it. It stays on record.',
    resubmit: ' — it goes to the person you choose for review again.',
    recall: ' — pulling it back concludes it. Send it again if you still need it.',
  }[action]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 460, maxWidth: '94vw', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)' }}>{verb} request</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16, lineHeight: 1.55 }}>
          {approval.title || KIND_LABEL[approval.kind] || approval.kind}
          {approval.amount_cents != null ? ` · ${money(approval.amount_cents)}` : ''}
          {explain}
        </p>

        {needsPerson && (
          <div style={{ marginBottom: 12 }}>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>{action === 'forward' ? 'Forward to *' : 'Send to *'}</label>
            {approversLoaded && approvers.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--n500)' }}>Nobody else in the organisation can decide approvals.</p>
            ) : (
              <ApproverSelect approvers={approvers} value={to} onChange={setTo}
                excludeIds={action === 'forward' ? [approval.requester_id, user?.id].filter(Boolean) : []} />
            )}
          </div>
        )}

        <label className="label" style={{ display: 'block', marginBottom: 5 }}>
          {needsReason ? 'Why (the requester sees this) *' : 'Notes'}
        </label>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />

        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={busy || (needsReason && !notes.trim()) || (needsPerson && !to)}
            className={destructive ? 'btn btn-secondary' : 'btn btn-primary'}
            style={{ height: 36, padding: '0 18px', fontSize: 13,
              ...(destructive ? { borderColor: 'var(--srbr)', color: 'var(--srt)' } : {}) }}>
            {busy ? 'Working…' : verb}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── The matrix ───────────────────────────────────────────────────────────────
const EMPTY_RULE = {
  name: '', entity_type: 'work_order', kind: 'wo_cost',
  min_naira: '0', max_naira: '', levels: [{ role_key: 'manager', label: '' }],
}

function RuleModal({ rule, onClose, onSave }) {
  const [form, setForm] = useState(() => rule ? {
    name: rule.name, entity_type: rule.entity_type, kind: rule.kind,
    min_naira: String(Number(rule.min_amount_cents) / 100),
    max_naira: rule.max_amount_cents == null ? '' : String(Number(rule.max_amount_cents) / 100),
    levels: rule.levels.map((l) => ({ role_key: l.role_key, label: l.label ?? '' })),
  } : { ...EMPTY_RULE })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  const kinds = APPROVAL_KINDS[form.entity_type] || []
  const setEntity = (entity) => {
    // The kind belongs to the entity — carrying the old one over would make a
    // rule nothing can ever match.
    setForm((p) => ({ ...p, entity_type: entity, kind: (APPROVAL_KINDS[entity] || [['', '']])[0][0] }))
  }

  const setLevel = (i, patch) => setForm((p) => ({ ...p, levels: p.levels.map((l, n) => n === i ? { ...l, ...patch } : l) }))
  const addLevel = () => setForm((p) => ({ ...p, levels: [...p.levels, { role_key: 'owner', label: '' }] }))
  const dropLevel = (i) => setForm((p) => ({ ...p, levels: p.levels.filter((_, n) => n !== i) }))

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) { setErr('Give the rule a name people will recognise in their inbox.') ; return }
    if (form.levels.length === 0) { setErr('A rule needs at least one level.'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      entity_type: form.entity_type,
      kind: form.kind,
      min_amount_cents: form.min_naira === '' ? 0 : Math.round(Number(form.min_naira) * 100),
      max_amount_cents: form.max_naira === '' ? null : Math.round(Number(form.max_naira) * 100),
      levels: form.levels.map((l) => ({ role_key: l.role_key, label: l.label.trim() || null })),
    }
    try {
      if (rule) await updateApprovalRule(rule.id, payload)
      else await createApprovalRule(payload)
      onSave()
    } catch (ex) {
      setErr(ex.message === 'invalid_band' ? 'The ceiling has to be above the floor.' : errorText(ex, 'Save failed.'))
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 560, maxHeight: '90vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{rule ? 'Edit rule' : 'New approval rule'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>Rule name *</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Job spend above ₦500,000" style={{ width: '100%' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>Applies to</label>
              <select className="input" value={form.entity_type} onChange={(e) => setEntity(e.target.value)} style={{ width: '100%' }}>
                {APPROVAL_ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>For</label>
              <select className="input" value={form.kind} onChange={(e) => set('kind', e.target.value)} style={{ width: '100%' }}>
                {kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>Amount band</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="input" type="number" min={0} step="0.01" value={form.min_naira} onChange={(e) => set('min_naira', e.target.value)} placeholder="0" style={{ flex: 1, fontFamily: 'var(--ff-m)' }} />
              <span style={{ fontSize: 12, color: 'var(--n500)' }}>up to</span>
              <input className="input" type="number" min={0} step="0.01" value={form.max_naira} onChange={(e) => set('max_naira', e.target.value)} placeholder="no ceiling" style={{ flex: 1, fontFamily: 'var(--ff-m)' }} />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 6, lineHeight: 1.55 }}>
              In naira, floor included and ceiling excluded, so bands sit end to end without overlapping.
              Leave the ceiling empty for the top band. A request with no matching band is refused rather
              than approved by default, so make sure the bands cover everything.
            </p>
          </div>

          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>Who signs, in order</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {form.levels.map((level, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n500)', width: 16 }}>{i + 1}.</span>
                  <select className="input" value={level.role_key} onChange={(e) => setLevel(i, { role_key: e.target.value })} style={{ width: 180, height: 32, fontSize: 12.5 }}>
                    {ROLE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input className="input" value={level.label} onChange={(e) => setLevel(i, { label: e.target.value })} placeholder="Step label (optional)" style={{ flex: 1, height: 32, fontSize: 12.5 }} />
                  {form.levels.length > 1 && (
                    <button type="button" onClick={() => dropLevel(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 4, display: 'flex' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {form.levels.length < 5 && (
              <button type="button" onClick={addLevel} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12, marginTop: 8 }}>Add a level</button>
            )}
            <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 8, lineHeight: 1.55 }}>
              Each level is a role, not a person: anyone holding that role can sign — except whoever
              submitted the request.
            </p>
          </div>

          {err && <p style={{ fontSize: 12, color: 'var(--srt)' }}>{err}</p>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : rule ? 'Save rule' : 'Create rule'}</button>
        </div>
      </form>
    </div>
  )
}

function MatrixTab({ canManage }) {
  const { money } = useMoney()
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRules(await listApprovalRules()) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const retire = async (id) => { await retireApprovalRule(id); load() }

  const band = (r) => {
    const from = money(r.min_amount_cents)
    const to = r.max_amount_cents == null ? null : money(r.max_amount_cents)
    if (Number(r.min_amount_cents) === 0 && to === null) return 'Any amount'
    return to === null ? `${from} and above` : `${from} — ${to}`
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading the matrix…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 12.5, color: 'var(--n600)', lineHeight: 1.6, maxWidth: 620 }}>
          A request&apos;s amount picks the band; the band&apos;s levels decide who signs, in order.
          Anything no band covers is refused rather than approved by default — so the bands need to
          meet end to end, with one of them left open at the top.
        </p>
        <div style={{ flex: 1 }} />
        {canManage && (
          <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 32, padding: '0 14px', fontSize: 13, whiteSpace: 'nowrap' }}>New rule</button>
        )}
      </div>

      {rules.length === 0 ? (
        <div style={{ border: 'var(--bdr)', borderRadius: 8, padding: 40, textAlign: 'center', background: 'var(--n0)' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>No approval rules yet</p>
          <p style={{ fontSize: 13, color: 'var(--n400)', maxWidth: 420, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Until a band exists, nothing can be sent for approval — which is the safe default, but not a useful one.
          </p>
          {canManage && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Create the first rule</button>}
        </div>
      ) : (
        <div style={{ border: 'var(--bdr)', borderRadius: 8, overflow: 'hidden', background: 'var(--n0)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                {['Rule', 'Applies to', 'Band', 'Signs, in order', ''].map((h) => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: 'var(--bdr)', opacity: r.active ? 1 : 0.55 }}>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{r.name}</div>
                    {!r.active && <div style={{ fontSize: 11, color: 'var(--n500)' }}>Inactive</div>}
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>
                    {ENTITY_LABEL[r.entity_type]} · {KIND_LABEL[r.kind] || r.kind}
                  </td>
                  <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{band(r)}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {r.levels.map((l, i) => (
                        <span key={l.level} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {i > 0 && <span style={{ color: 'var(--n400)', fontSize: 11 }}>→</span>}
                          <span className="badge badge-n" title={l.label || undefined}>{ROLE_LABELS[l.role_key] || l.role_key}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', width: '1%' }}>
                    {canManage && (
                      // .btn is display:flex, so two of them in a cell stack
                      // unless they sit in a row of their own.
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => setModal(r)} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Edit</button>
                        <button onClick={() => retire(r.id)} style={{ height: 26, padding: '0 10px', fontSize: 11.5, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Retire</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <RuleModal rule={modal === 'add' ? null : modal} onClose={() => setModal(null)} onSave={() => { setModal(null); load() }} />
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Approvals({ dark, toggleDark }) {
  const { money } = useMoney()
  const { roleKey, user } = useAuth()
  const userId = user?.id
  const canDecide = can(roleKey, 'approval:decide')
  const canManage = can(roleKey, 'approval:manage')

  const [tab, setTab] = useState('inbox')
  const [rows, setRows] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [deciding, setDeciding] = useState(null)

  const load = useCallback(async () => {
    if (tab === 'matrix') return
    setLoading(true)
    setError('')
    try {
      const [list, s] = await Promise.all([listApprovals({ scope: tab }), getApprovalStats()])
      setRows(list)
      setStats(s)
    } catch (ex) {
      setError(errorText(ex, 'Could not load approvals.'))
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { load() }, [load])

  const openDetail = async (id) => {
    setDetail({ id, loading: true })
    try { setDetail(await getApproval(id)) } catch { setDetail(null) }
  }

  // ?id=<uuid> is how an approval notification ("sent to you", "forwarded",
  // "returned") lands on the request itself rather than on a list to search.
  const [searchParams] = useSearchParams()
  const deepLinkId = searchParams.get('id')
  useEffect(() => { if (deepLinkId) openDetail(deepLinkId) }, [deepLinkId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { extraCaps } = useAuth()
  // The direct-route actions are gated server-side on approval:decide with
  // per-user grants counted, so these buttons count the grants too.
  const canDecideDirect = can(roleKey, 'approval:decide', extraCaps)

  // Waiting on me: a matrix request routed to my role that I did not raise,
  // or a request sent to me by name.
  const isForMe = (a) => a.status === 'pending' && (a.route === 'direct'
    ? a.assignee_id === userId
    : a.requester_id !== userId && (a.current_role_key === roleKey || roleKey === 'owner'))

  const tabs = [
    { k: 'inbox', l: `Waiting on me${stats?.awaiting_me ? ` (${stats.awaiting_me})` : ''}` },
    { k: 'mine', l: `I submitted${stats?.returned_to_me ? ` (${stats.returned_to_me} returned)` : ''}` },
    { k: 'all', l: 'Everything' },
    { k: 'matrix', l: 'Approval matrix' },
  ]

  return (
    <div className="app-shell">
      <Sidebar active="approvals" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Approvals" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 0', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Approvals</h1>
              <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                Work and reports <strong style={{ fontWeight: 600 }}>sent to a person</strong> (usually a line manager) and
                requests routed by the <strong style={{ fontWeight: 600 }}>approval matrix</strong>. Who has each one, and where it has got to.
              </p>
            </div>

            {stats && tab !== 'matrix' && (
              <div style={{ display: 'flex', border: 'var(--bdr)', borderRadius: 6, marginBottom: 12, overflow: 'hidden', background: 'var(--n0)', flexWrap: 'wrap' }}>
                <Stat label="Waiting on me" value={stats.awaiting_me} tone={stats.awaiting_me > 0 ? 'warn' : undefined} />
                <Stat label="Returned to me" value={stats.returned_to_me ?? 0} tone={stats.returned_to_me > 0 ? 'warn' : undefined} />
                <Stat label="Mine, still pending" value={stats.my_pending} />
                <Stat label="Pending across the org" value={stats.pending} />
                <Stat label="Approved" value={stats.approved} />
                <Stat label="Rejected" value={stats.rejected} />
              </div>
            )}

            <div className="tab-strip" style={{ display: 'flex' }}>
              {tabs.map((t) => (
                <button key={t.k} className={`tab-btn${tab === t.k ? ' active' : ''}`} onClick={() => { setTab(t.k); setDetail(null) }}>{t.l}</button>
              ))}
            </div>
          </div>

          {tab === 'matrix' ? (
            <div style={{ flex: 1, overflowY: 'auto' }}><MatrixTab canManage={canManage} /></div>
          ) : (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                  <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading…</div>
                ) : error ? (
                  <div style={{ padding: 48, textAlign: 'center' }}>
                    <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                    <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
                  </div>
                ) : rows.length === 0 ? (
                  <div style={{ padding: 64, textAlign: 'center' }}>
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 16px' }}>
                      <path d="M8 20l8 8 16-16" stroke="var(--n300)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                      {tab === 'inbox' ? 'Nothing waiting on you' : tab === 'mine' ? 'You have not submitted anything' : 'No approval requests yet'}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--n400)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
                      Requests are raised from the record itself: a work order, inspection or maintenance report sent
                      to a person, or a job&apos;s closure or spend routed by the approval matrix.
                    </p>
                  </div>
                ) : (
                  <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                      <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                        {['Request', 'For', 'Amount', 'Where it is', 'Status', ''].map((h) => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => {
                        const meta = approvalStatusMeta(a)
                        const mine = a.requester_id === userId
                        const forMe = isForMe(a)
                        const direct = a.route === 'direct'
                        return (
                          <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: detail?.id === a.id ? 'var(--b50)' : 'transparent' }} onClick={() => openDetail(a.id)}>
                            <td style={{ padding: '11px 14px' }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{a.title || KIND_LABEL[a.kind] || a.kind}</div>
                              <div style={{ fontSize: 11, color: 'var(--n500)' }}>by {a.requester?.full_name || '—'} · {fmtWhen(a.created_at)}</div>
                            </td>
                            <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{KIND_LABEL[a.kind] || a.kind}</td>
                            <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}><Money cents={a.amount_cents} /></td>
                            {/* A person-routed request has no levels to track, so it
                                says who has it instead. */}
                            <td style={{ padding: '11px 14px', whiteSpace: 'nowrap' }}>
                              {direct ? (
                                <>
                                  <div style={{ fontSize: 12, color: 'var(--n800)' }}>
                                    {a.status === 'pending' ? `With: ${a.assignee?.full_name || '—'}`
                                      : a.status === 'returned' ? `Returned to ${a.requester?.full_name || 'the requester'}`
                                      : a.approver?.full_name ? `By ${a.approver.full_name}` : '—'}
                                  </div>
                                  <div style={{ fontSize: 10.5, color: 'var(--n500)' }}>Sent to a person</div>
                                </>
                              ) : (
                                <>
                                  <LevelTrack approval={a} />
                                  {a.status === 'pending' && a.current_role_label && (
                                    <div style={{ fontSize: 10.5, color: 'var(--n500)', marginTop: 2 }}>With {a.current_role_label}</div>
                                  )}
                                </>
                              )}
                            </td>
                            <td style={{ padding: '11px 14px' }}><span className={`badge ${meta.cls}`}>{meta.label}</span></td>
                            <td style={{ padding: '11px 14px', whiteSpace: 'nowrap', width: '1%' }}>
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              {forMe && (direct ? canDecideDirect : canDecide) && (
                                // A direct request has four possible answers, so Review opens
                                // the panel instead of jumping straight to Approve.
                                <button onClick={(e) => { e.stopPropagation(); if (direct) openDetail(a.id); else setDeciding({ approval: a, action: 'approve' }) }} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Review</button>
                              )}
                              {mine && a.status === 'pending' && (
                                <button onClick={(e) => { e.stopPropagation(); setDeciding({ approval: a, action: 'recall' }) }} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Recall</button>
                              )}
                              {mine && a.status === 'returned' && (
                                <button onClick={(e) => { e.stopPropagation(); setDeciding({ approval: a, action: 'resubmit' }) }} className="btn btn-primary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Resubmit</button>
                              )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table></div>
                )}
              </div>

              {detail && (
                <div className="detail-panel" style={{ '--panel-w': '380px', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {detail.loading ? (
                    <div style={{ padding: 24, fontSize: 13, color: 'var(--n400)' }}>Loading…</div>
                  ) : (
                    <>
                      <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{KIND_LABEL[detail.kind] || detail.kind}</div>
                          <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{detail.title || ENTITY_LABEL[detail.entity_type]}</div>
                        </div>
                        <button onClick={() => setDetail(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                        </button>
                      </div>

                      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className={`badge ${approvalStatusMeta(detail).cls}`}>{approvalStatusMeta(detail).label}</span>
                          {detail.route === 'direct'
                            ? <span className="badge badge-n">Sent to a person</span>
                            : <LevelTrack approval={detail} />}
                        </div>

                        <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Details</div>
                          {[
                            ['Amount', detail.amount_cents == null ? null : <Money key="amt" cents={detail.amount_cents} />],
                            detail.route === 'direct' ? ['Route', 'Sent to a person'] : ['Routed by', detail.rule?.name],
                            ['Now with', detail.status === 'pending'
                              ? (detail.route === 'direct' ? detail.assignee?.full_name : detail.current_role_label)
                              : detail.status === 'returned'
                                ? `${detail.requester?.full_name || 'The requester'}, to fix and resubmit`
                                : null],
                            ['Submitted by', detail.requester?.full_name],
                            [detail.route === 'direct' && detail.status === 'approved' ? 'Accepted by'
                              : detail.status === 'discarded' ? 'Discarded by' : 'Decided by', detail.approver?.full_name],
                            ['Decided', detail.decided_at ? fmtWhen(detail.decided_at) : null],
                          ].map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                              <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                              <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v || '—'}</span>
                            </div>
                          ))}
                          {detail.notes && <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n700)', lineHeight: 1.55 }}>{detail.notes}</div>}
                        </div>

                        {/* Every step, including the ones that changed nothing. */}
                        <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>History</div>
                          {(detail.events || []).map((e) => (
                            <div key={e.id} style={{ padding: '10px 14px', borderBottom: 'var(--bdr)' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                {/* Levels mean nothing on a person-routed request. */}
                                <span style={{ fontFamily: 'var(--ff-m)', fontSize: 10.5, color: 'var(--n500)', width: 20 }}>{detail.route === 'direct' ? '•' : `L${e.level}`}</span>
                                <span style={{ flex: 1, fontSize: 12, color: 'var(--n800)' }}>
                                  <strong style={{ fontWeight: 600 }}>{e.actor?.full_name || 'Someone'}</strong> {EVENT_LABEL[e.action] || e.action}
                                  {e.to_user && <> {e.action === 'forwarded' ? '→' : 'to'} <strong style={{ fontWeight: 600 }}>{e.to_user.full_name}</strong></>}
                                  {e.role_key && detail.route !== 'direct' ? ` as ${ROLE_LABELS[e.role_key] || e.role_key}` : ''}
                                </span>
                                <span style={{ fontSize: 10.5, color: 'var(--n400)', whiteSpace: 'nowrap' }}>{fmtWhen(e.created_at)}</span>
                              </div>
                              {e.notes && <div style={{ fontSize: 11.5, color: 'var(--n600)', marginTop: 3, paddingLeft: 28, lineHeight: 1.5 }}>{e.notes}</div>}
                            </div>
                          ))}
                        </div>

                        {/* Returned: back with the requester, who fixes it and sends it again. */}
                        {detail.status === 'returned' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
                            {detail.requester_id === userId ? (
                              <>
                                <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                                  This was returned to you. Make the changes asked for in the history above, then resubmit it to whoever should review it.
                                </p>
                                <button onClick={() => setDeciding({ approval: detail, action: 'resubmit' })} className="btn btn-primary" style={{ height: 36, fontSize: 13 }}>Resubmit</button>
                              </>
                            ) : (
                              <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                                Returned to {detail.requester?.full_name || 'the requester'} to fix and resubmit.
                              </p>
                            )}
                          </div>
                        )}

                        {detail.status === 'pending' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
                            {detail.requester_id === userId ? (
                              <>
                                <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                                  {detail.route === 'direct'
                                    ? `It is with ${detail.assignee?.full_name || 'the person you sent it to'}. You can pull it back if it was sent in error.`
                                    : 'You submitted this, so it needs someone else at this level. You can pull it back if it was raised in error.'}
                                </p>
                                <button onClick={() => setDeciding({ approval: detail, action: 'recall' })} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Recall it</button>
                              </>
                            ) : detail.route === 'direct' ? (
                              detail.assignee_id === userId && canDecideDirect ? (
                                <>
                                  <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                                    Accept it to conclude it and keep it on record, forward it to someone above you,
                                    return it for changes, or discard it.
                                  </p>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <button onClick={() => setDeciding({ approval: detail, action: 'approve' })} className="btn btn-primary" style={{ height: 36, fontSize: 13 }}>Accept</button>
                                    <button onClick={() => setDeciding({ approval: detail, action: 'forward' })} className="btn btn-secondary" style={{ height: 36, fontSize: 13 }}>Forward</button>
                                    <button onClick={() => setDeciding({ approval: detail, action: 'return' })} style={{ height: 36, fontSize: 13, background: 'none', border: '1px solid var(--sabr)', color: 'var(--sat)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Return</button>
                                    <button onClick={() => setDeciding({ approval: detail, action: 'discard' })} style={{ height: 36, fontSize: 13, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Discard</button>
                                  </div>
                                </>
                              ) : (
                                <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                                  With {detail.assignee?.full_name || 'someone else'}. Only they can act on it.
                                </p>
                              )
                            ) : canDecide && (detail.current_role_key === roleKey || roleKey === 'owner') ? (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <button onClick={() => setDeciding({ approval: detail, action: 'approve' })} className="btn btn-primary" style={{ height: 36, fontSize: 13 }}>Approve</button>
                                <button onClick={() => setDeciding({ approval: detail, action: 'reject' })} style={{ height: 36, fontSize: 13, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Reject</button>
                              </div>
                            ) : (
                              <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.55 }}>
                                Waiting on {detail.current_role_label || 'another role'}.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {deciding && (
        <DecisionModal
          approval={deciding.approval}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onDone={() => { setDeciding(null); load(); if (detail?.id) openDetail(detail.id) }}
        />
      )}
    </div>
  )
}
