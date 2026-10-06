import { useState } from 'react'
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
import { useResource } from '../../lib/useResource'
import Modal from '../../components/Modal.jsx'
import { Field, FormError, useForm } from '../../components/form.jsx'
import TableState from '../../components/TableState.jsx'

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

/** A one-time link to show an admin: an invite or a password reset. */
function LinkModal({ title, intro, url, buttonLabel, onClose }) {
  return (
    <Modal
      title={title}
      width={460}
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>{buttonLabel}</button>}
    >
      <p style={{fontSize:12,color:'var(--n500)',marginBottom:10}}>{intro}</p>
      <code style={{display:'block',fontSize:11,background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:4,padding:'8px 10px',wordBreak:'break-all'}}>{url}</code>
    </Modal>
  )
}

function InviteModal({ locations, sites, onClose, onInvited }) {
  const toast = useToast()
  const { form, set } = useForm({ email: '', full_name: '', role_key: 'officer' })
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
    // The server says whether the mail actually went out; this used to claim
    // SMTP was unconfigured even on an instance that had just emailed the invite.
    return (
      <LinkModal
        title={link.emailed ? 'Invite sent' : 'Invite created'}
        intro={link.emailed
          ? <>We emailed the set-password link to {form.email}. If it doesn&apos;t arrive, share this link directly:</>
          : <>Email delivery isn&apos;t available on this instance — share this set-password link with {form.email} directly:</>}
        url={link.url}
        buttonLabel="Done"
        onClose={() => { onInvited(); onClose() }}
      />
    )
  }

  return (
    <Modal
      title="Invite a team member"
      width={480}
      as="form"
      onSubmit={submit}
      onClose={onClose}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send Invite'}</button>
        </>
      )}
    >
      <Field label="Full name" required>
        <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="e.g. Chidi Umeh" />
      </Field>
      <Field label="Email address" required>
        <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="name@company.com" />
      </Field>
      <Field label="Role">
        <select className="input" value={form.role_key} onChange={(e) => set('role_key', e.target.value)}>
          {ROLES_LIST.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </Field>
      <ScopeCapsFields locations={locations} sites={sites} value={scope} onChange={setScope} />
      <FormError>{err}</FormError>
    </Modal>
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
      setErr(errorText(e, undefined, {
        invalid_manager: 'A line manager has to be another active member of this organisation.',
        manager_cycle: 'That person already has this member as their line manager. Two people cannot manage each other.',
      }))
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Access & permissions"
      width={480}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save access'}</button>
        </>
      )}
    >
      <div style={{fontSize:12,color:'var(--n500)',marginBottom:16}}>{member.full_name || member.email}</div>
      <Field label="Line manager" style={{marginBottom:14}}
        hint="Preselected when this member sends a work order or report for approval. It grants no access on its own.">
        <select className="input" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
          <option value="">No line manager</option>
          {members.filter((m) => m.user_id !== member.user_id && m.status === 'active').map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>
          ))}
        </select>
      </Field>
      <ScopeCapsFields locations={locations} sites={sites} value={scope} onChange={setScope} />
      <FormError style={{marginTop:10}}>{err}</FormError>
    </Modal>
  )
}

export default function UsersTab() {
  const ask = useConfirm()
  const can = useCan()
  const toast = useToast()
  const [subtab, setSubtab] = useState('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [accessMember, setAccessMember] = useState(null)
  const [resetLink, setResetLink] = useState(null)
  const { user } = useAuth()
  const canManage = can('user:manage')
  // Locations and sites only feed the scope pickers, so the member list
  // still shows without them.
  const { data, loading, error, reload: load } = useResource(
    () => Promise.all([listOrgMembers(), listLocations().catch(() => []), listSites().catch(() => [])])
      .then(([members, locations, sites]) => ({ members, locations, sites })),
    [], { initial: { members: [], locations: [], sites: [] }, keepPrevious: true },
  )
  const { members, locations, sites } = data

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
            <TableState loading={loading} error={error} onRetry={load}>
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
            </TableState>
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
        <LinkModal
          title="Password reset link"
          intro={resetLink.emailed
            ? 'We emailed this one-time link to the user. Share it directly only if it does not arrive:'
            : 'Email delivery isn\'t available on this instance — share this one-time link with the user directly:'}
          url={resetLink.url}
          buttonLabel="Close"
          onClose={() => setResetLink(null)}
        />
      )}
    </div>
  )
}
