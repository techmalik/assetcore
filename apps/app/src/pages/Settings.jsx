import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import { api } from '../lib/apiClient'
import { SUPPORT_EMAIL } from '../lib/instance'
import { getLicence, licenceDaysRemaining } from '../lib/db/licence'
import {
  listEscalationRules, listEscalationEvents, createEscalationRule,
  retireEscalationRule, runEscalationsNow,
  ESCALATION_ENTITY_TYPES, VALID_TRIGGERS, TRIGGER_LABEL,
} from '../lib/db/escalations'
import { ROLE_LABELS } from '../lib/rbac'

function SuccessBanner({ msg }) {
  if (!msg) return null
  return (
    <div style={{ background: 'var(--sgb)', border: '1px solid var(--sgbr)', borderRadius: 4, padding: '8px 14px', fontSize: 13, color: 'var(--sgt)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="var(--sgt)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {msg}
    </div>
  )
}

function ErrorBanner({ msg }) {
  if (!msg) return null
  return (
    <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 14px', fontSize: 13, color: 'var(--srt)', marginBottom: 16 }}>{msg}</div>
  )
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab() {
  const { fullName, initials } = useAuth()
  const [form, setForm] = useState({ full_name: '', phone: '' })
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving]   = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [ok, setOk]     = useState(null)
  const [err, setErr]   = useState(null)
  const [pwOk, setPwOk] = useState(null)
  const [pwErr, setPwErr] = useState(null)

  useEffect(() => {
    api.get('/profile')
      .then(data => { if (data) setForm({ full_name: data.full_name || '', phone: data.phone || '' }) })
      .catch(() => {})
  }, [])

  const saveProfile = async () => {
    setSaving(true); setErr(null); setOk(null)
    try {
      await api.patch('/profile', { full_name: form.full_name, phone: form.phone || null })
      setOk('Profile updated.')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const changePassword = async () => {
    if (!pwForm.current) return setPwErr('Enter your current password.')
    if (pwForm.next !== pwForm.confirm) return setPwErr('Passwords do not match.')
    if (pwForm.next.length < 8) return setPwErr('Password must be at least 8 characters.')
    setPwSaving(true); setPwErr(null); setPwOk(null)
    try {
      await api.post('/auth/change-password', { currentPassword: pwForm.current, newPassword: pwForm.next })
      setPwOk('Password changed successfully.')
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (e) { setPwErr(e.message) }
    finally { setPwSaving(false) }
  }

  const inp = { height: 36, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: 'var(--n0)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--n700)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--b700)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600, color: '#fff' }}>{initials}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--n900)' }}>{fullName || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--n500)' }}>Profile photo coming soon</div>
        </div>
      </div>

      {/* Profile form */}
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Personal details</div>
        <SuccessBanner msg={ok} />
        <ErrorBanner msg={err} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={lbl}>Full name</span>
            <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} style={inp} placeholder="e.g. Adaeze Okeke" />
          </label>
          <label>
            <span style={lbl}>Phone number</span>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} placeholder="+234 803 xxx xxxx" />
          </label>
        </div>
        <button onClick={saveProfile} disabled={saving} className="btn btn-primary" style={{ marginTop: 16, height: 36, padding: '0 20px', fontSize: 13 }}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      {/* Password */}
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Change password</div>
        <SuccessBanner msg={pwOk} />
        <ErrorBanner msg={pwErr} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={lbl}>Current password</span>
            <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} style={inp} autoComplete="current-password" />
          </label>
          <label>
            <span style={lbl}>New password</span>
            <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} style={inp} placeholder="Min 8 characters" autoComplete="new-password" />
          </label>
          <label>
            <span style={lbl}>Confirm new password</span>
            <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} style={inp} autoComplete="new-password" />
          </label>
        </div>
        <button onClick={changePassword} disabled={pwSaving || !pwForm.next} className="btn btn-secondary" style={{ marginTop: 16, height: 36, padding: '0 20px', fontSize: 13 }}>
          {pwSaving ? 'Updating…' : 'Change password'}
        </button>
      </div>
    </div>
  )
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function LicenceCard() {
  const [licence, setLicence] = useState(undefined) // undefined = loading, null = none configured
  useEffect(() => {
    getLicence().then(setLicence).catch(() => setLicence(null))
  }, [])

  const daysLeft = licence ? licenceDaysRemaining(licence.expires_at) : null
  const expired = daysLeft !== null && daysLeft < 0

  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Licence</div>
      {licence === undefined ? (
        <div style={{ fontSize: 12, color: 'var(--n500)' }}>Loading…</div>
      ) : licence ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Licensed to</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)' }}>{licence.licensed_to}</div>
            </div>
            {licence.contract_ref && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Contract ref</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)', fontFamily: 'var(--ff-m)' }}>{licence.contract_ref}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Expires</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: expired ? 'var(--srt)' : 'var(--n900)' }}>{fmtDate(licence.expires_at)}</div>
            </div>
            {licence.seats != null && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Seats</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)' }}>{licence.seats}</div>
              </div>
            )}
          </div>
          {expired && (
            <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 14px', fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>
              This licence has expired.
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 12 }}>Licence details are not yet configured for this instance.</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.6 }}>
        For licence terms, renewal, or support, contact <span style={{ color: 'var(--b600)', fontWeight: 500 }}>{SUPPORT_EMAIL}</span>.
      </div>
    </div>
  )
}

// ── Organisation Tab ──────────────────────────────────────────────────────────
function OrgTab() {
  const { org, roleKey } = useAuth()
  const canEdit = can(roleKey, 'org:manage')
  const [form, setForm] = useState({ name: '', short_name: '', region: '' })
  const [saving, setSaving] = useState(false)
  const [ok, setOk]   = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (org) setForm({ name: org.name || '', short_name: org.short_name || '', region: org.region || '' })
  }, [org])

  const save = async () => {
    setSaving(true); setErr(null); setOk(null)
    try {
      await api.patch('/org', { name: form.name, short_name: form.short_name, region: form.region || null })
      setOk('Organisation details saved.')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const inp = { height: 36, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: canEdit ? 'var(--n0)' : 'var(--n50)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--n700)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Organisation details</div>
        {!canEdit && (
          <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 4, padding: '8px 14px', fontSize: 12, color: 'var(--n500)', marginBottom: 12 }}>
            Only the Org Owner can edit organisation details.
          </div>
        )}
        <SuccessBanner msg={ok} />
        <ErrorBanner msg={err} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={lbl}>Organisation name</span>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} disabled={!canEdit} />
          </label>
          <label>
            <span style={lbl}>Short name / trading name</span>
            <input value={form.short_name} onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))} style={inp} disabled={!canEdit} placeholder="e.g. NGML" />
          </label>
          <label>
            <span style={lbl}>Region</span>
            <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} style={inp} disabled={!canEdit} placeholder="e.g. South-South" />
          </label>
        </div>
        {canEdit && (
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ marginTop: 16, height: 36, padding: '0 20px', fontSize: 13 }}>
            {saving ? 'Saving…' : 'Save organisation'}
          </button>
        )}
      </div>

      <LicenceCard />
    </div>
  )
}


// ── Escalations Tab ───────────────────────────────────────────────────────────
/**
 * "If a critical job is still open three days past its SLA, tell the operations
 * manager." Rules are evaluated by the nightly cron; each one fires once per
 * item, because an escalation is an event rather than a daily reminder.
 */
const EMPTY_RULE = {
  name: '', entity_type: 'work_order', trigger: 'overdue',
  threshold_days: 3, priority: '', severity: '', notify_role_key: 'ops_manager',
}

function EscalationForm({ onSaved, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_RULE })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const triggers = VALID_TRIGGERS[form.entity_type] || []
  const setEntity = (entity) => {
    // Only some triggers exist for each entity — carrying an invalid one over
    // would make a rule the evaluator silently skips every night.
    const next = VALID_TRIGGERS[entity] || []
    setForm(f => ({ ...f, entity_type: entity, trigger: next.includes(f.trigger) ? f.trigger : next[0], priority: '', severity: '' }))
  }

  const save = async () => {
    if (!form.name.trim()) return setErr('Give the rule a name — it is what people see in the notification.')
    setSaving(true); setErr(null)
    try {
      await createEscalationRule({
        name: form.name.trim(),
        entity_type: form.entity_type,
        trigger: form.trigger,
        threshold_days: Number(form.threshold_days),
        priority: form.entity_type === 'work_order' && form.priority ? form.priority : null,
        severity: form.entity_type === 'defect' && form.severity ? form.severity : null,
        notify_role_key: form.notify_role_key,
      })
      onSaved()
    } catch (e) {
      setErr(e.message === 'invalid_trigger_for_entity' ? 'That trigger does not apply to this record type.' : e.message)
      setSaving(false)
    }
  }

  const inp = { height: 34, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: 'var(--n0)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--n700)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>New escalation rule</div>
      <ErrorBanner msg={err} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          <span style={lbl}>Rule name</span>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Critical job past SLA" style={inp} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            <span style={lbl}>When a</span>
            <select value={form.entity_type} onChange={e => setEntity(e.target.value)} style={{ ...inp, appearance: 'none' }}>
              {ESCALATION_ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            <span style={lbl}>has been</span>
            <select value={form.trigger} onChange={e => set('trigger', e.target.value)} style={{ ...inp, appearance: 'none' }}>
              {triggers.map(t => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            <span style={lbl}>for more than (days)</span>
            <input type="number" min={0} max={365} value={form.threshold_days} onChange={e => set('threshold_days', e.target.value)} style={{ ...inp, fontFamily: 'var(--ff-m)' }} />
          </label>
          <label>
            <span style={lbl}>tell everyone who is</span>
            <select value={form.notify_role_key} onChange={e => set('notify_role_key', e.target.value)} style={{ ...inp, appearance: 'none' }}>
              {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
        {form.entity_type === 'work_order' && (
          <label>
            <span style={lbl}>Only jobs at this priority (optional)</span>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} style={{ ...inp, appearance: 'none' }}>
              <option value="">Any priority</option>
              {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        {form.entity_type === 'defect' && (
          <label>
            <span style={lbl}>Only defects at this severity (optional)</span>
            <select value={form.severity} onChange={e => set('severity', e.target.value)} style={{ ...inp, appearance: 'none' }}>
              <option value="">Any severity</option>
              {['minor', 'moderate', 'major', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={save} disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 20px', fontSize: 13 }}>{saving ? 'Saving…' : 'Create rule'}</button>
        <button onClick={onCancel} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  )
}

function EscalationsTab() {
  const { roleKey } = useAuth()
  const canManage = can(roleKey, 'escalation:manage')
  const [rules, setRules] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [ok, setOk] = useState(null)
  const [err, setErr] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [r, e] = await Promise.all([listEscalationRules(), listEscalationEvents(20)])
      setRules(r); setEvents(e)
    } catch (ex) { setErr(ex.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const runNow = async () => {
    setOk(null); setErr(null)
    try {
      const { fired } = await runEscalationsNow()
      setOk(fired === 0
        ? 'Nothing crossed a threshold — no escalations raised.'
        : `${fired} escalation${fired === 1 ? '' : 's'} raised.`)
      load()
    } catch (ex) { setErr(ex.message) }
  }

  const retire = async (id) => { await retireEscalationRule(id); load() }

  if (loading) return <div style={{ padding: 20, fontSize: 13, color: 'var(--n400)' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 720 }}>
      <SuccessBanner msg={ok} />
      <ErrorBanner msg={err} />

      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)' }}>Escalation rules</div>
            <p style={{ fontSize: 12.5, color: 'var(--n500)', marginTop: 4, lineHeight: 1.6 }}>
              Checked every morning at 07:15, after overdue work has been marked. Each rule raises
              a notification once per item — an escalation is an event, not a daily reminder.
            </p>
          </div>
          {canManage && !adding && (
            <button onClick={() => setAdding(true)} className="btn btn-primary" style={{ height: 32, padding: '0 14px', fontSize: 13, whiteSpace: 'nowrap' }}>New rule</button>
          )}
        </div>

        {rules.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--n400)', padding: '12px 0' }}>
            No rules yet. Nothing escalates on its own until one exists.
          </p>
        ) : (
          <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
            {rules.map((r, i) => (
              <div key={r.id} style={{ padding: '11px 14px', borderBottom: i < rules.length - 1 ? 'var(--bdr)' : 'none', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 2, lineHeight: 1.5 }}>
                    {(ESCALATION_ENTITY_TYPES.find(([v]) => v === r.entity_type) || [null, r.entity_type])[1]}
                    {r.priority ? ` (${r.priority})` : ''}{r.severity ? ` (${r.severity})` : ''}
                    {' · '}{(TRIGGER_LABEL[r.trigger] || r.trigger).toLowerCase()} for {r.threshold_days} day{r.threshold_days === 1 ? '' : 's'}
                    {' → '}{r.notify_role_label || r.notify_role_key}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--n400)', marginTop: 3 }}>
                    {r.fired_count > 0
                      ? `Raised ${r.fired_count} time${r.fired_count === 1 ? '' : 's'}, last ${new Date(r.last_fired_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                      : 'Has not fired yet'}
                  </div>
                </div>
                {canManage && (
                  <button onClick={() => retire(r.id)} style={{ height: 26, padding: '0 10px', fontSize: 11.5, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Retire</button>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && rules.length > 0 && (
          <button onClick={runNow} className="btn btn-secondary" style={{ height: 32, padding: '0 14px', fontSize: 12.5, marginTop: 14 }}>
            Run the rules now
          </button>
        )}
      </div>

      {adding && <EscalationForm onSaved={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} />}

      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 4 }}>What has escalated</div>
        <p style={{ fontSize: 12.5, color: 'var(--n500)', marginBottom: 14, lineHeight: 1.6 }}>
          A list of rules tells you what should happen; this tells you what did.
        </p>
        {events.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--n400)' }}>Nothing has escalated yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map(e => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5 }}>
                <span style={{ fontFamily: 'var(--ff-m)', fontSize: 10.5, color: 'var(--n400)', width: 52, flexShrink: 0 }}>
                  {new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
                <span style={{ flex: 1, color: 'var(--n800)' }}>{e.entity_label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--n500)', whiteSpace: 'nowrap' }}>
                  {e.rule_name} · {e.notified_count} notified
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Settings({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const [tab, setTab] = useState('profile')
  const canSeeEscalations = can(roleKey, 'escalation:read')

  return (
    <div className="app-shell">
      <Sidebar active="settings" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Settings" dark={dark} toggleDark={toggleDark} />
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 24px 0', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Settings</h1>
            </div>
            <div style={{ display: 'flex' }}>
              {[
                { k: 'profile', l: 'Profile' },
                { k: 'org', l: 'Organisation' },
                ...(canSeeEscalations ? [{ k: 'escalations', l: 'Escalations' }] : []),
              ].map(t => (
                <button key={t.k} className={`tab-btn${tab === t.k ? ' active' : ''}`} onClick={() => setTab(t.k)}>{t.l}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'org' && <OrgTab />}
            {tab === 'escalations' && <EscalationsTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
