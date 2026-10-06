import { useState, useEffect } from 'react'
import { listEscalationRules, listEscalationEvents, createEscalationRule, updateEscalationRule, retireEscalationRule, runEscalationsNow, ESCALATION_ENTITY_TYPES, VALID_TRIGGERS, TRIGGER_LABEL } from '../../lib/db/escalations.js'
import { useCan } from '../../lib/AuthContext.jsx'
import { ROLE_KEYS, ROLE_LABELS } from '../../lib/rbac.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'

// ── Escalations Tab ───────────────────────────────────────────────────────────
/**
 * The rules that decide who gets woken up when something is left sitting.
 *
 * Reading them is enough for an operations manager; changing them is
 * owner-only (escalation:manage), on the same reasoning as the approval
 * matrix — a rule that says "nobody is told about this" is exactly the rule
 * somebody with a backlog would be tempted to write about themselves.
 *
 * Every rule shows how many times it has actually fired, because a list of
 * rules on its own cannot answer the only question worth asking about one:
 * is it doing anything?
 */
function RuleModal({ rule, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: rule?.name || '',
    entity_type: rule?.entity_type || 'work_order',
    trigger: rule?.trigger || 'overdue',
    threshold_days: rule?.threshold_days ?? 3,
    priority: rule?.priority || '',
    severity: rule?.severity || '',
    notify_role_key: rule?.notify_role_key || 'manager',
    active: rule?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Changing the entity can strand the trigger on a pair the evaluator has no
  // query for, which the API rejects. Move to the first valid one instead of
  // letting the form carry an invalid combination to the server.
  const triggers = VALID_TRIGGERS[form.entity_type] || []
  useEffect(() => {
    if (!triggers.includes(form.trigger)) set('trigger', triggers[0])
  }, [form.entity_type]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Give the rule a name — it is what appears in the notification.'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        name: form.name.trim(),
        entity_type: form.entity_type,
        trigger: form.trigger,
        threshold_days: Math.max(0, Math.min(365, Number(form.threshold_days) || 0)),
        priority: form.entity_type === 'work_order' && form.priority ? form.priority : null,
        severity: form.entity_type === 'defect' && form.severity ? form.severity : null,
        notify_role_key: form.notify_role_key,
        active: form.active,
      }
      if (rule) await updateEscalationRule(rule.id, payload)
      else await createEscalationRule(payload)
      toast.success(rule ? 'Rule updated.' : 'Rule created.')
      onSaved()
    } catch (ex) {
      setErr(errorText(ex, 'Could not save the rule.', { invalid_trigger_for_entity: 'That trigger does not apply to this kind of record.' }))
      setSaving(false)
    }
  }

  const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--n600)' }
  const sel = { height: 36, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 8px', fontSize: 13, background: 'var(--n0)', color: 'var(--n900)', width: '100%' }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:18}}>{rule ? 'Edit Escalation Rule' : 'New Escalation Rule'}</div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={lbl}>Rule name
            <input value={form.name} onChange={e => set('name', e.target.value)} className="input"
              placeholder="e.g. Critical work orders unresolved after 2 days" />
          </label>

          <div className="form-grid" style={{gap:10}}>
            <label style={lbl}>Applies to
              <select value={form.entity_type} onChange={e => set('entity_type', e.target.value)} style={sel}>
                {ESCALATION_ENTITY_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label style={lbl}>When it has been
              <select value={form.trigger} onChange={e => set('trigger', e.target.value)} style={sel}>
                {triggers.map(t => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
              </select>
            </label>
          </div>

          <label style={lbl}>For at least
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <input type="number" min={0} max={365} value={form.threshold_days}
                onChange={e => set('threshold_days', e.target.value)}
                style={{...sel, width: 90}} />
              <span style={{fontSize:13,color:'var(--n600)'}}>days</span>
            </div>
            <span style={{fontSize:11,color:'var(--n400)'}}>
              Zero means the moment it qualifies — the rules are evaluated once a night.
            </span>
          </label>

          {form.entity_type === 'work_order' && (
            <label style={lbl}>Only when priority is
              <select value={form.priority} onChange={e => set('priority', e.target.value)} style={sel}>
                <option value="">— Any priority —</option>
                {['low','medium','high','critical'].map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </label>
          )}
          {form.entity_type === 'defect' && (
            <label style={lbl}>Only when severity is
              <select value={form.severity} onChange={e => set('severity', e.target.value)} style={sel}>
                <option value="">— Any severity —</option>
                {['minor','moderate','major','critical'].map(sv => <option key={sv} value={sv}>{sv[0].toUpperCase() + sv.slice(1)}</option>)}
              </select>
            </label>
          )}

          <label style={lbl}>Notify
            <select value={form.notify_role_key} onChange={e => set('notify_role_key', e.target.value)} style={sel}>
              {ROLE_KEYS.map(k => <option key={k} value={k}>{ROLE_LABELS[k] || k}</option>)}
            </select>
            <span style={{fontSize:11,color:'var(--n400)'}}>
              Everyone holding that role, subject to their own notification preferences.
            </span>
          </label>

          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--n700)'}}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active — evaluated nightly
          </label>

          {err && <div style={{fontSize:12,color:'var(--srt)'}}>{err}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Rule'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function EscalationsTab() {
  const ask = useConfirm()
  const can = useCan()
  const toast = useToast()
  const canManage = can('escalation:manage')
  const [rules, setRules] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null)
  const [running, setRunning] = useState(false)

  function load() {
    setLoading(true)
    Promise.all([listEscalationRules(), listEscalationEvents(15)])
      .then(([r, e]) => { setRules(r); setEvents(e); setLoading(false) })
      .catch(e => { setErr(errorText(e)); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  async function retire(rule) {
    if (!(await ask(`Retire “${rule.name}”? It stops being evaluated; the escalations it already raised are kept.`, { danger: true, confirmLabel: 'Retire' }))) return
    try { await retireEscalationRule(rule.id); toast.success('Rule retired.'); load() }
    catch (e) { toast.error(errorText(e)) }
  }

  async function runNow() {
    setRunning(true)
    try {
      const { fired } = await runEscalationsNow()
      toast.success(fired ? `${fired} escalation${fired === 1 ? '' : 's'} raised.` : 'Nothing met a rule.')
      load()
    } catch (e) { toast.error(errorText(e)) } finally { setRunning(false) }
  }

  const entityLabel = Object.fromEntries(ESCALATION_ENTITY_TYPES)

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6,gap:12}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Escalation rules ({rules.length})</div>
        {canManage && (
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" style={{height:32,padding:'0 14px',fontSize:13}} disabled={running} onClick={runNow}>
              {running ? 'Running…' : 'Run now'}
            </button>
            <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setModal('new')}>+ Add Rule</button>
          </div>
        )}
      </div>
      <div style={{fontSize:12,color:'var(--n500)',marginBottom:16,lineHeight:1.6,maxWidth:640}}>
        Every night at 07:15 each active rule looks for records that have been sitting too long and
        notifies the role you name. An escalation fires once per record, so nobody is told the same
        thing twice. “Run now” evaluates them immediately — the only way to see whether a new rule
        catches anything without waiting until morning.
      </div>

      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : err ? (
        <div style={{padding:12,background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,fontSize:13,color:'var(--srt)'}}>{err}</div>
      ) : rules.length === 0 ? (
        <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>
          No escalation rules yet — nothing is chased automatically.
        </div>
      ) : (
        <div className="table-scroll" style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{background:'var(--n50)',textAlign:'left'}}>
                {['Rule','Applies to','After','Notifies','Fired','Status', ''].map((h, i) => (
                  <th key={i} style={{padding:'8px 12px',fontSize:11,fontWeight:600,color:'var(--n500)',textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'var(--bdr)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                  <td style={{padding:'10px 12px',color:'var(--n900)'}}>
                    {r.name}
                    {(r.priority || r.severity) && (
                      <span style={{marginLeft:6,fontSize:11,color:'var(--n500)'}}>· {r.priority || r.severity} only</span>
                    )}
                  </td>
                  <td style={{padding:'10px 12px',color:'var(--n700)'}}>
                    {entityLabel[r.entity_type] || r.entity_type}
                    <div style={{fontSize:11,color:'var(--n500)'}}>{TRIGGER_LABEL[r.trigger] || r.trigger}</div>
                  </td>
                  <td style={{padding:'10px 12px',color:'var(--n700)',whiteSpace:'nowrap'}}>{r.threshold_days}d</td>
                  <td style={{padding:'10px 12px',color:'var(--n700)'}}>{r.notify_role_label || ROLE_LABELS[r.notify_role_key] || r.notify_role_key}</td>
                  <td style={{padding:'10px 12px',color:r.fired_count ? 'var(--n700)' : 'var(--n400)',whiteSpace:'nowrap'}}>
                    {r.fired_count || 'never'}
                    {r.last_fired_at && (
                      <div style={{fontSize:11,color:'var(--n500)'}}>{new Date(r.last_fired_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
                    )}
                  </td>
                  <td style={{padding:'10px 12px'}}>
                    <span className={`badge ${r.active ? 'badge-g' : 'badge-n'}`}>{r.active ? 'Active' : 'Paused'}</span>
                  </td>
                  <td style={{padding:'10px 12px',textAlign:'right',whiteSpace:'nowrap'}}>
                    {canManage && (
                      <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                        <button onClick={() => setModal(r)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)'}}>Edit</button>
                        <button onClick={() => retire(r)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)'}}>Retire</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div style={{marginTop:24,maxWidth:720}}>
          <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:8}}>Recently escalated</div>
          <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
            {events.map((e, i) => (
              <div key={e.id} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 14px',fontSize:12,borderBottom:i<events.length-1?'var(--bdr)':'none'}}>
                <span style={{flex:1,color:'var(--n800)'}}>{e.rule_name}</span>
                <span style={{color:'var(--n500)'}}>{ROLE_LABELS[e.notify_role_key] || e.notify_role_key}</span>
                <span style={{color:'var(--n400)',fontFamily:'var(--ff-m)',fontSize:11}}>
                  {new Date(e.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!canManage && !loading && (
        <div style={{fontSize:11,color:'var(--n400)',marginTop:12}}>Only a System Admin can add or change escalation rules.</div>
      )}

      {modal && (
        <RuleModal
          rule={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
