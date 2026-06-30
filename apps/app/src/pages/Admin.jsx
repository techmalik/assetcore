import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listSites, createSite, updateSite, softDeleteSite } from '../lib/db/sites.js'
import { listCategories, createCategory, updateCategory, deleteCategory } from '../lib/db/categories.js'
import { listAuditLog } from '../lib/db/audit.js'
import { useAuth } from '../lib/AuthContext.jsx'

// ── Sites Tab ────────────────────────────────────────────────────────────────

function SiteModal({ site, onClose, onSave }) {
  const [form, setForm] = useState({ name: site?.name || '', code: site?.code || '', region: site?.region || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) { setErr('Name and code are required.'); return }
    setSaving(true)
    try {
      if (site) await updateSite(site.id, form)
      else await createSite(form)
      onSave()
    } catch (ex) { setErr(ex.message) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:400,padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:18}}>{site ? 'Edit Site' : 'Add Site'}</div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          {[['name','Site Name','e.g. Lagos DS-04'],['code','Site Code','e.g. LG-DS04'],['region','Region (optional)','e.g. South West']].map(([k,l,ph]) => (
            <label key={k} style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
              {l}
              <input value={form[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={ph}
                style={{height:36,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,color:'var(--n900)',background:'var(--n0)'}}/>
            </label>
          ))}
          {err && <div style={{fontSize:12,color:'var(--srt)'}}>{err}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function SitesTab() {
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null) // null | 'new' | site object

  function load() {
    setLoading(true)
    listSites().then(s => { setSites(s); setLoading(false) }).catch(e => { setErr(e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function archive(id) {
    if (!confirm('Archive this site? It will no longer appear in lists.')) return
    try { await softDeleteSite(id); load() } catch (e) { alert(e.message) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Sites ({sites.length})</div>
        <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setModal('new')}>+ Add Site</button>
      </div>
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : err ? (
        <div style={{padding:12,background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,fontSize:13,color:'var(--srt)'}}>{err}</div>
      ) : sites.length === 0 ? (
        <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>No sites yet. Add your first site to get started.</div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:10}}>
          {sites.map(s => (
            <div key={s.id} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>{s.name}</div>
                  <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b600)',marginTop:2}}>{s.code}</div>
                </div>
                <div style={{display:'flex',gap:4}}>
                  <button onClick={() => setModal(s)} style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                  <button onClick={() => archive(s.id)} style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
                </div>
              </div>
              {s.region && <div style={{fontSize:11,color:'var(--n500)'}}>{s.region}</div>}
            </div>
          ))}
        </div>
      )}
      {modal && (
        <SiteModal
          site={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

// ── Categories Tab ────────────────────────────────────────────────────────────

function CatModal({ cat, onClose, onSave }) {
  const [form, setForm] = useState({ name: cat?.name || '', code: cat?.code || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) { setErr('Name and code are required.'); return }
    setSaving(true)
    try {
      if (cat) await updateCategory(cat.id, form)
      else await createCategory(form)
      onSave()
    } catch (ex) { setErr(ex.message) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:380,padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:18}}>{cat ? 'Edit Category' : 'Add Category'}</div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          {[['name','Category Name','e.g. Metering Station'],['code','Short Code','e.g. MTR']].map(([k,l,ph]) => (
            <label key={k} style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
              {l}
              <input value={form[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={ph}
                style={{height:36,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,color:'var(--n900)',background:'var(--n0)'}}/>
            </label>
          ))}
          {err && <div style={{fontSize:12,color:'var(--srt)'}}>{err}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CategoriesTab() {
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null)

  function load() {
    setLoading(true)
    listCategories().then(c => { setCats(c); setLoading(false) }).catch(e => { setErr(e.message); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    if (!confirm('Delete this category? This cannot be undone.')) return
    try { await deleteCategory(id); load() } catch (e) { alert(e.message) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Asset Categories ({cats.length})</div>
        <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setModal('new')}>+ Add Category</button>
      </div>
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : err ? (
        <div style={{padding:12,background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,fontSize:13,color:'var(--srt)'}}>{err}</div>
      ) : cats.length === 0 ? (
        <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>No categories yet.</div>
      ) : (
        <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden',maxWidth:640}}>
          {cats.map((c, i) => (
            <div key={c.id} style={{display:'flex',alignItems:'center',padding:'11px 14px',borderBottom:i<cats.length-1?'var(--bdr)':'none'}}>
              <span style={{fontFamily:'var(--ff-m)',fontSize:11,fontWeight:600,color:'var(--b600)',background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:3,padding:'1px 7px',marginRight:12,flexShrink:0}}>{c.code}</span>
              <span style={{flex:1,fontSize:13,color:'var(--n900)'}}>{c.name}</span>
              <div style={{display:'flex',gap:6}}>
                <button onClick={() => setModal(c)} style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                <button onClick={() => remove(c.id)} style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <CatModal
          cat={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

// ── Users Tab (static + invite stub) ─────────────────────────────────────────

const STATIC_USERS = [
  {id:1,name:'Adaeze Okeke',email:'a.okeke@ngml.example',role:'Owner',sites:['All Sites'],active:true,initials:'AO'},
]

const ROLES_LIST = [
  {key:'owner',label:'Owner',desc:'Full access including billing and org settings.',perms:['All modules','Admin','Billing']},
  {key:'ops_manager',label:'Ops Manager',desc:'Full access to assets, work orders, maintenance, reports.',perms:['Assets (full)','Work Orders (full)','Maintenance (full)','Reports (full)']},
  {key:'maint_engineer',label:'Maintenance Engineer',desc:'Create and complete work orders, log maintenance.',perms:['Assets (view/edit)','Work Orders (full)','Maintenance (full)']},
  {key:'field_tech',label:'Field Technician',desc:'View and update assigned work orders.',perms:['Assets (view)','Work Orders (assigned only)','Maintenance (assigned only)']},
  {key:'hse_officer',label:'HSE / Compliance Officer',desc:'Full access to compliance and inspections.',perms:['Assets (view)','Compliance (full)','Inspections (full)','Reports (view)']},
  {key:'viewer',label:'Viewer',desc:'Read-only access to dashboard and reports.',perms:['Dashboard (view)','Reports (view)']},
]

function UsersTab() {
  const [subtab, setSubtab] = useState('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const { org } = useAuth()

  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'12px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0,display:'flex',gap:0}}>
        {[{k:'members',l:'Team Members'},{k:'roles',l:'Roles & Permissions'}].map(t => (
          <button key={t.k} className={`tab-btn${subtab===t.k?' active':''}`} onClick={() => setSubtab(t.k)}>{t.l}</button>
        ))}
      </div>
      <div style={{flex:1,overflow:'hidden',display:'flex'}}>
        {subtab === 'members' && (
          <div style={{flex:1,overflowY:'auto'}}>
            <div style={{padding:'16px 24px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8}}>
              <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setInviteOpen(true)}>
                + Invite User
              </button>
              <span style={{fontSize:12,color:'var(--n400)',marginLeft:4}}>Invite team members by email</span>
            </div>
            {inviteOpen && (
              <div style={{padding:'16px 24px',background:'var(--b50)',borderBottom:'1px solid var(--b200)'}}>
                <div style={{fontSize:13,fontWeight:500,color:'var(--b800)',marginBottom:10}}>Invite a team member</div>
                <div style={{display:'flex',gap:8,alignItems:'flex-end',flexWrap:'wrap'}}>
                  <input placeholder="Email address" style={{height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,color:'var(--n900)',background:'var(--n0)',width:220}}/>
                  <select style={{height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 28px 0 10px',fontSize:13,color:'var(--n700)',background:'var(--n0)'}}>
                    {ROLES_LIST.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                  <button className="btn btn-primary" style={{height:34,fontSize:13}}>Send Invite</button>
                  <button className="btn btn-secondary" style={{height:34,fontSize:13}} onClick={() => setInviteOpen(false)}>Cancel</button>
                </div>
                <div style={{marginTop:8,fontSize:11,color:'var(--b700)',background:'var(--b100)',border:'1px solid var(--b200)',borderRadius:4,padding:'6px 10px'}}>
                  Email invitations are coming soon. For now, add team members by creating accounts through the sign-up flow.
                </div>
              </div>
            )}
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'var(--n50)'}}>
                  {['User','Email','Role','Status',''].map(h => (
                    <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STATIC_USERS.map(u => (
                  <tr key={u.id} style={{borderBottom:'var(--bdr)'}}>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:28,height:28,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:'#fff',flexShrink:0}}>{u.initials}</div>
                        <span style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{u.name}</span>
                      </div>
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)'}}>{u.email}</td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)'}}>{u.role}</td>
                    <td style={{padding:'11px 14px'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'var(--sgt)',fontWeight:500}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:'var(--sg)'}}/>Active
                      </span>
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--n400)'}}>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          </div>
        )}
      </div>
    </div>
  )
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────

const ACTION_COLORS = {
  'asset.create': 'var(--sgt)', 'asset.update': 'var(--sat)', 'asset.delete': 'var(--srt)',
  'wo.create': 'var(--sgt)', 'wo.update': 'var(--sat)', 'wo.transition': 'var(--b600)',
  'wo.delete': 'var(--srt)', 'site.create': 'var(--sgt)', 'category.create': 'var(--sgt)',
}

function AuditTab() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [offset, setOffset] = useState(0)
  const PAGE = 50

  function load(off = 0) {
    setLoading(true)
    listAuditLog({ limit: PAGE, offset: off })
      .then(({ rows: r, total: t }) => { setRows(r); setTotal(t); setLoading(false) })
      .catch(e => { setErr(e.message); setLoading(false) })
  }

  useEffect(() => { load(0) }, [])

  function page(dir) {
    const next = offset + dir * PAGE
    setOffset(next)
    load(next)
  }

  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'12px 24px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:500,color:'var(--n600)'}}>
          {total > 0 ? `${total} total events` : 'Audit log'}
        </div>
        <div style={{flex:1}}/>
        {total > PAGE && (
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button disabled={offset === 0} onClick={() => page(-1)} style={{height:28,padding:'0 10px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:12,color:'var(--n600)',cursor:'pointer',opacity:offset===0?.5:1}}>← Prev</button>
            <span style={{fontSize:12,color:'var(--n500)'}}>{Math.floor(offset/PAGE)+1} / {Math.ceil(total/PAGE)}</span>
            <button disabled={offset + PAGE >= total} onClick={() => page(1)} style={{height:28,padding:'0 10px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:12,color:'var(--n600)',cursor:'pointer',opacity:offset+PAGE>=total?.5:1}}>Next →</button>
          </div>
        )}
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        {loading ? (
          <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
        ) : err ? (
          <div style={{padding:16,color:'var(--srt)',fontSize:13}}>{err}</div>
        ) : rows.length === 0 ? (
          <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>No audit events yet.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead style={{position:'sticky',top:0,zIndex:10}}>
              <tr style={{background:'var(--n50)'}}>
                {['Time','Actor','Action','Entity',''].map(h => (
                  <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{borderBottom:'var(--bdr)'}}>
                  <td style={{padding:'9px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>
                    {new Date(r.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                  </td>
                  <td style={{padding:'9px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>
                    {r.actor?.full_name || r.actor?.email || r.actor_id?.slice(0,8) || '—'}
                  </td>
                  <td style={{padding:'9px 14px'}}>
                    <span style={{fontFamily:'var(--ff-m)',fontSize:11,fontWeight:600,color:ACTION_COLORS[r.action]||'var(--n600)',background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:3,padding:'1px 7px'}}>
                      {r.action}
                    </span>
                  </td>
                  <td style={{padding:'9px 14px',fontSize:12,color:'var(--n600)'}}>
                    <span style={{color:'var(--n400)'}}>{r.entity_type} </span>
                    <span style={{fontFamily:'var(--ff-m)',fontSize:11}}>{r.entity_id?.slice(0,8)}</span>
                  </td>
                  <td style={{padding:'9px 14px',fontSize:11,color:'var(--n400)'}}>
                    {r.ip && <span style={{fontFamily:'var(--ff-m)'}}>{r.ip}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { k: 'sites', label: 'Sites' },
  { k: 'categories', label: 'Asset Categories' },
  { k: 'users', label: 'Users & Roles' },
  { k: 'audit', label: 'Audit Log' },
]

export default function Admin({ dark, toggleDark }) {
  const [tab, setTab] = useState('sites')

  return (
    <div className="app-shell">
      <Sidebar active="admin"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Admin" dark={dark} toggleDark={toggleDark}/>
        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{marginBottom:12}}>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Admin</h1>
              <p style={{fontSize:12,color:'var(--n500)'}}>Manage your organisation settings, team, and audit trail</p>
            </div>
            <div style={{display:'flex',gap:0}}>
              {TABS.map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {tab === 'sites' && <SitesTab />}
            {tab === 'categories' && <CategoriesTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'audit' && <AuditTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
