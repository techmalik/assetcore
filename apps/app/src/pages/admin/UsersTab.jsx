import { useState, useEffect } from 'react'
import { listSites } from '../../lib/db/sites.js'
import { listLocations } from '../../lib/db/locations.js'
import { listOrgMembers, inviteOrgMember, updateOrgMemberRole, updateOrgMemberAccess, setOrgMemberStatus, resetOrgMemberPassword } from '../../lib/db/orgMembers.js'
import { useAuth, initialsOf, useCan } from '../../lib/AuthContext.jsx'
// The permissions matrix shows what each ROLE grants, before any per-user
// grant, so it calls the role-only check directly rather than useCan().
import { can as roleCan, ROLE_CAPABILITIES, ROLE_KEYS, ROLE_LABELS, ROLE_DESCRIPTIONS, ADMIN_ENTRY_CAPS } from '../../lib/rbac.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'
import { ScopeCapsFields } from './accessFields.jsx'

// ── Users Tab ──────────────────────────────────────────────────────────────

const ROLES_LIST = ROLE_KEYS.map((key) => ({
  key, label: ROLE_LABELS[key], desc: ROLE_DESCRIPTIONS[key]?.summary ?? '', perms: ROLE_DESCRIPTIONS[key]?.covers ?? [],
}))

// Capability groups for the read-only permissions matrix below — each ✓/–
// cell is derived live from ROLE_CAPABILITIES via can(), not hardcoded, so
// editing the map changes the table. A group's `cap` (or first match in
// `caps`) is checked with can() the same way the rest of the app gates UI —
// wildcards ('*', '*:read') resolve through that same function, not a
// second, driftable expansion here.
const PERMISSION_MATRIX_GROUPS = [
  { label: 'Assets', cap: 'asset:read' },
  { label: 'Work Orders', cap: 'wo:read' },
  { label: 'Maintenance', cap: 'pm:read' },
  { label: 'Inspections', cap: 'inspection:read' },
  { label: 'Compliance', cap: 'compliance:read' },
  { label: 'Export', cap: 'report:read' },
  { label: 'Admin', caps: ADMIN_ENTRY_CAPS },
]

function PermissionsMatrix() {
  const [open, setOpen] = useState(false)
  const roleKeys = Object.keys(ROLE_CAPABILITIES)

  return (
    <div style={{marginTop:16,background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
      <button onClick={() => setOpen(o => !o)} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:'var(--n900)'}}>
        Role permissions matrix
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{transform:open?'rotate(180deg)':'none',transition:'transform .15s'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n500)" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </button>
      {open && (
        <div style={{padding:'0 16px 16px'}}>
          <div className="table-scroll">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr>
                  <th style={{textAlign:'left',padding:'6px 10px',color:'var(--n500)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',whiteSpace:'nowrap'}}>Role</th>
                  {PERMISSION_MATRIX_GROUPS.map(g => (
                    <th key={g.label} style={{textAlign:'center',padding:'6px 10px',color:'var(--n500)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',whiteSpace:'nowrap'}}>{g.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roleKeys.map(rk => (
                  <tr key={rk} style={{borderTop:'var(--bdr)'}}>
                    <td style={{padding:'8px 10px',fontWeight:500,color:'var(--n800)',whiteSpace:'nowrap'}}>{ROLE_LABELS[rk] || rk}</td>
                    {PERMISSION_MATRIX_GROUPS.map(g => {
                      const has = g.caps ? g.caps.some((c) => roleCan(rk, c)) : roleCan(rk, g.cap)
                      return (
                        <td key={g.label} style={{textAlign:'center',padding:'8px 10px',color:has?'var(--sgt)':'var(--n300)',fontWeight:600}}>
                          {has ? '✓' : '–'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{fontSize:11,color:'var(--n400)',marginTop:10}}>
            Individual members may hold additional granted permissions (see each member's Access settings).
          </div>
        </div>
      )}
    </div>
  )
}

function InviteModal({ locations, sites, onClose, onInvited }) {
  const toast = useToast()
  const [form, setForm] = useState({ email: '', full_name: '', role_key: 'officer' })
  const [scope, setScope] = useState({ location_scope: [], site_scope: [], extra_caps: [] })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!form.email.trim() || !form.full_name.trim()) { setErr('Email and name are required.'); return }
    setBusy(true); setErr('')
    try {
      const { invite_link, email_sent } = await inviteOrgMember({
        ...form,
        location_scope: scope.location_scope.length ? scope.location_scope : null,
        site_scope: scope.site_scope.length ? scope.site_scope : null,
        extra_caps: scope.extra_caps,
      })
      if (invite_link) setLink({ url: invite_link, emailed: Boolean(email_sent) })
      else { toast.success(`Invite sent to ${form.email}.`); onInvited(); onClose() }
    } catch (ex) { setErr(errorText(ex)) } finally { setBusy(false) }
  }

  if (link) {
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
          {/* The server says whether the mail actually went out; this used to
              claim SMTP was unconfigured even on an instance that had just
              emailed the invite. */}
          <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:10}}>{link.emailed ? 'Invite sent' : 'Invite created'}</div>
          <p style={{fontSize:12,color:'var(--n500)',marginBottom:10}}>
            {link.emailed
              ? <>We emailed the set-password link to {form.email}. If it doesn't arrive, share this link directly:</>
              : <>Email delivery isn't available on this instance — share this set-password link with {form.email} directly:</>}
          </p>
          <code style={{display:'block',fontSize:11,background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:4,padding:'8px 10px',wordBreak:'break-all',marginBottom:16}}>{link.url}</code>
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <button className="btn btn-primary" onClick={() => { onInvited(); onClose() }}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:480,maxWidth:'94vw',maxHeight:'92vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:18}}>Invite a team member</div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
            Full name
            <input value={form.full_name} onChange={e => setForm(f => ({...f,full_name:e.target.value}))} placeholder="e.g. Chidi Umeh"
              className="input"/>
          </label>
          <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
            Email address
            <input type="email" value={form.email} onChange={e => setForm(f => ({...f,email:e.target.value}))} placeholder="name@company.com"
              className="input"/>
          </label>
          <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
            Role
            <select value={form.role_key} onChange={e => setForm(f => ({...f,role_key:e.target.value}))}
              className="input">
              {ROLES_LIST.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <ScopeCapsFields locations={locations} sites={sites} value={scope} onChange={setScope} />
          {err && <div style={{fontSize:12,color:'var(--srt)'}}>{err}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AccessModal({ member, members = [], locations, sites, onClose, onSaved }) {
  const toast = useToast()
  const [scope, setScope] = useState({
    location_scope: member.location_scope || [],
    site_scope: member.site_scope || [],
    extra_caps: member.extra_caps || [],
  })
  // Line manager (0028). Grants nothing: it is who this member's work and
  // reports are preselected to go to when they send them for approval.
  const [managerId, setManagerId] = useState(member.manager_id || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      await updateOrgMemberAccess(member.id, {
        location_scope: scope.location_scope.length ? scope.location_scope : null,
        site_scope: scope.site_scope.length ? scope.site_scope : null,
        extra_caps: scope.extra_caps,
        manager_id: managerId || null,
      })
      toast.success('Access updated.')
      onSaved()
    } catch (e) {
      const managerErrors = {
        invalid_manager: 'A line manager has to be another active member of this organisation.',
        manager_cycle: 'That person already has this member as their line manager. Two people cannot manage each other.',
      }
      setErr(managerErrors[e.code] || errorText(e)); setSaving(false)
    }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:480,maxWidth:'94vw',maxHeight:'92vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:4}}>Access & permissions</div>
        <div style={{fontSize:12,color:'var(--n500)',marginBottom:16}}>{member.full_name || member.email}</div>
        <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)',marginBottom:14}}>
          Line manager
          <select className="input" value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="">No line manager</option>
            {members.filter(m => m.user_id !== member.user_id && m.status === 'active').map(m => (
              <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
            ))}
          </select>
          <span style={{fontSize:11,color:'var(--n400)',lineHeight:1.5}}>
            Preselected when this member sends a work order or report for approval. It grants no access on its own.
          </span>
        </label>
        <ScopeCapsFields locations={locations} sites={sites} value={scope} onChange={setScope} />
        {err && <div style={{fontSize:12,color:'var(--srt)',marginTop:10}}>{err}</div>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:18}}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save access'}</button>
        </div>
      </div>
    </div>
  )
}

export default function UsersTab() {
  const ask = useConfirm()
  const can = useCan()
  const toast = useToast()
  const [subtab, setSubtab] = useState('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [members, setMembers] = useState([])
  const [locations, setLocations] = useState([])
  const [sites, setSites] = useState([])
  const [accessMember, setAccessMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [resetLink, setResetLink] = useState(null)
  const { user } = useAuth()
  const canManage = can('user:manage')

  function load() {
    setLoading(true)
    Promise.all([listOrgMembers(), listLocations().catch(() => []), listSites().catch(() => [])])
      .then(([m, l, s]) => { setMembers(m); setLocations(l); setSites(s); setLoading(false) })
      .catch(e => { setErr(errorText(e)); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  async function changeRole(m, role_key) {
    try { await updateOrgMemberRole(m.id, role_key); load(); toast.success('Role updated.') }
    catch (e) { toast.error(errorText(e, 'Failed to update role.')) }
  }

  async function toggleStatus(m) {
    const enable = m.status === 'disabled'
    if (!enable && !(await ask(`Disable ${m.full_name || m.email}? They will lose access immediately.`, { danger: true, confirmLabel: 'Disable' }))) return
    try { await setOrgMemberStatus(m.id, enable); load(); toast.success(enable ? 'Member enabled.' : 'Member disabled.') }
    catch (e) { toast.error(errorText(e, 'Failed to update member status.')) }
  }

  async function sendReset(m) {
    try {
      const { action_link, email_sent } = await resetOrgMemberPassword(m.id)
      setResetLink({ url: action_link || 'Link generated (check email delivery settings).', emailed: Boolean(email_sent) })
      toast.success('Password reset link generated.')
    } catch (e) { toast.error(errorText(e, 'Failed to generate reset link.')) }
  }

  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div className="tab-strip" style={{padding:'12px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0,display:'flex',gap:0}}>
        {[{k:'members',l:'Team Members'},{k:'roles',l:'Roles & Permissions'}].map(t => (
          <button key={t.k} className={`tab-btn${subtab===t.k?' active':''}`} onClick={() => setSubtab(t.k)}>{t.l}</button>
        ))}
      </div>
      <div style={{flex:1,overflow:'hidden',display:'flex'}}>
        {subtab === 'members' && (
          <div style={{flex:1,overflowY:'auto'}}>
            {canManage && (
              <div style={{padding:'16px 24px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8}}>
                <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setInviteOpen(true)}>
                  + Invite User
                </button>
                <span style={{fontSize:12,color:'var(--n400)',marginLeft:4}}>Invite team members by email</span>
              </div>
            )}
            {loading ? (
              <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
            ) : err ? (
              <div style={{padding:12,background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,fontSize:13,color:'var(--srt)'}}>{err}</div>
            ) : (
              <div className="table-scroll"><table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{background:'var(--n50)'}}>
                    {['User','Email','Line manager','Role','Status',''].map(h => (
                      <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const isSelf = m.user_id === user?.id
                    const disabled = m.status === 'disabled'
                    return (
                      <tr key={m.id} style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:10}}>
                            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--b-solid)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:'#fff',flexShrink:0}}>{initialsOf(m.full_name)}</div>
                            <span style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{m.full_name || '—'}{isSelf && <span style={{color:'var(--n400)',fontWeight:400}}> (you)</span>}</span>
                          </div>
                        </td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)'}}>{m.email}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:m.manager_name?'var(--n700)':'var(--n400)',whiteSpace:'nowrap'}}>{m.manager_name || '—'}</td>
                        <td style={{padding:'11px 14px'}}>
                          <select value={m.role_key} disabled={!canManage} onChange={e => changeRole(m, e.target.value)} className="select"
                            style={{height:28,border:'1px solid var(--n200)',borderRadius:4,padding:'0 6px',fontSize:12,color:'var(--n700)',background:canManage?'var(--n0)':'var(--n50)'}}>
                            {ROLES_LIST.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                          </select>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:disabled?'var(--n500)':'var(--sgt)',fontWeight:500}}>
                            <div style={{width:6,height:6,borderRadius:'50%',background:disabled?'var(--n400)':'var(--sg)'}}/>{disabled?'Disabled':'Active'}
                          </span>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          {canManage && !isSelf && (
                            <div style={{display:'flex',gap:6}}>
                              <button onClick={() => setAccessMember(m)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--b200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--b700)',cursor:'pointer'}}>Access</button>
                              <button onClick={() => sendReset(m)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Reset password</button>
                              <button onClick={() => toggleStatus(m)} className="row-action" style={{padding:'3px 8px',border:`1px solid ${disabled?'var(--n200)':'var(--srbr)'}`,borderRadius:3,background:disabled?'var(--n0)':'var(--srb)',fontSize:11,color:disabled?'var(--sgt)':'var(--srt)',cursor:'pointer'}}>{disabled?'Enable':'Disable'}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        )}
        {subtab === 'roles' && (
          <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
            <div style={{display:'flex',flexDirection:'column',gap:10,maxWidth:780}}>
              {ROLES_LIST.map(r => (
                <div key={r.key} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'16px 18px'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'var(--n900)',marginBottom:4}}>{r.label}</div>
                  <div style={{fontSize:12,color:'var(--n500)',marginBottom:10,lineHeight:1.5}}>{r.desc}</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {r.perms.map(p => (
                      <span key={p} style={{background:'var(--n50)',color:'var(--n700)',border:'1px solid var(--n200)',borderRadius:3,fontSize:11,padding:'2px 8px'}}>{p}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div style={{maxWidth:780}}>
              <PermissionsMatrix />
            </div>
          </div>
        )}
      </div>
      {inviteOpen && <InviteModal locations={locations} sites={sites} onClose={() => setInviteOpen(false)} onInvited={load} />}
      {accessMember && <AccessModal member={accessMember} members={members} locations={locations} sites={sites} onClose={() => setAccessMember(null)} onSaved={() => { setAccessMember(null); load() }} />}
      {resetLink && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
            <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:10}}>Password reset link</div>
            <p style={{fontSize:12,color:'var(--n500)',marginBottom:10}}>
              {resetLink.emailed
                ? 'We emailed this one-time link to the user. Share it directly only if it does not arrive:'
                : 'Email delivery isn\'t available on this instance — share this one-time link with the user directly:'}
            </p>
            <code style={{display:'block',fontSize:11,background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:4,padding:'8px 10px',wordBreak:'break-all',marginBottom:16}}>{resetLink.url}</code>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button className="btn btn-primary" onClick={() => setResetLink(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
