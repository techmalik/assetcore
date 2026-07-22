import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listSites, createSite, updateSite, softDeleteSite } from '../lib/db/sites.js'
import { listLocations, createLocation, updateLocation, softDeleteLocation } from '../lib/db/locations.js'
import { listCategories, createCategory, updateCategory, deleteCategory } from '../lib/db/categories.js'
import { listAuditLog } from '../lib/db/audit.js'
import { listOrgMembers, inviteOrgMember, updateOrgMemberRole, updateOrgMemberAccess, setOrgMemberStatus, resetOrgMemberPassword } from '../lib/db/orgMembers.js'
import { getOrg, updateOrg } from '../lib/db/org.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac.js'

// Capabilities an admin can grant per-user on top of the role baseline
// (mirrors GRANTABLE_CAPS in apps/api/src/routes/orgMembers.ts).
const GRANTABLE_CAPS = [
  { key: 'asset:update', label: 'Edit assets' },
  { key: 'asset:create', label: 'Create assets' },
  { key: 'wo:create', label: 'Create work orders' },
  { key: 'wo:transition', label: 'Change work-order status' },
  { key: 'pm:update', label: 'Update maintenance status' },
  { key: 'maintenance:complete', label: 'Complete maintenance' },
  { key: 'inspection:update', label: 'Update inspection status' },
  { key: 'compliance:update', label: 'Manage compliance' },
  { key: 'report:create', label: 'Generate reports' },
  { key: 'audit:read', label: 'View audit log' },
]

// A toggle chip with an explicit check when selected — reads more clearly than
// a bare colour swap, especially for people filling the form quickly.
function Chip({ on, disabled, onClick, children, title }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '5px 11px', borderRadius: 999,
        cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--ff-u)',
        border: `1px solid ${on ? 'var(--b400)' : 'var(--n300)'}`,
        background: on ? 'var(--b50)' : 'var(--n0)', color: on ? 'var(--b700)' : 'var(--n700)',
        opacity: disabled ? .6 : 1, fontWeight: on ? 500 : 400,
      }}>
      {on && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.2L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      {children}
    </button>
  )
}

// Shared scope + capability picker used by the invite and edit-access modals.
// Locations and sites are separated visually and sites are grouped under their
// location, so it's obvious what a selection grants (a location grants every
// site in it; individual sites add oversight beyond that).
function ScopeCapsFields({ locations, sites, value, onChange }) {
  const toggle = (field, id) => {
    const cur = value[field] || []
    onChange({ ...value, [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }
  const locSel = value.location_scope || []
  const siteSel = value.site_scope || []
  const capSel = value.extra_caps || []
  const scoped = locSel.length + siteSel.length > 0

  // Group sites under their location (plus an "Unassigned" bucket) for scanning.
  const groups = []
  for (const l of locations) {
    const inLoc = sites.filter((s) => s.location_id === l.id)
    if (inLoc.length) groups.push({ id: l.id, name: l.name, sites: inLoc })
  }
  const orphans = sites.filter((s) => !s.location_id || !locations.some((l) => l.id === s.location_id))
  if (orphans.length) groups.push({ id: 'none', name: 'Unassigned', sites: orphans })

  const summary = scoped
    ? `Limited to ${locSel.length ? `${locSel.length} location${locSel.length !== 1 ? 's' : ''}` : ''}${locSel.length && siteSel.length ? ' + ' : ''}${siteSel.length ? `${siteSel.length} site${siteSel.length !== 1 ? 's' : ''}` : ''}.`
    : 'Full access — every location and site.'

  const secLabel = { fontSize: 13, fontWeight: 600, color: 'var(--n800)' }
  const secHint = { fontSize: 12, color: 'var(--n500)', marginTop: 1, lineHeight: 1.5 }
  const box = { display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Scope */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={secLabel}>Access scope</div>
          <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 999, background: scoped ? 'var(--b50)' : 'var(--sgb)', color: scoped ? 'var(--b700)' : 'var(--sgt)', border: `1px solid ${scoped ? 'var(--b200)' : 'var(--sgbr)'}` }}>{scoped ? 'Restricted' : 'All access'}</span>
        </div>
        <div style={secHint}>{summary}</div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n700)' }}>Locations</div>
          <div style={{ fontSize: 11, color: 'var(--n500)' }}>Selecting a location grants every site inside it.</div>
          <div style={box}>
            {locations.map((l) => (
              <Chip key={l.id} on={locSel.includes(l.id)} onClick={() => toggle('location_scope', l.id)}>
                {l.name}{typeof l.site_count === 'number' ? <span style={{ opacity: .6, marginLeft: 3 }}>· {l.site_count}</span> : null}
              </Chip>
            ))}
            {locations.length === 0 && <span style={{ fontSize: 12, color: 'var(--n400)' }}>No locations yet — add them in Admin → Locations.</span>}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--n700)' }}>Individual sites</div>
          <div style={{ fontSize: 11, color: 'var(--n500)' }}>Add specific sites for oversight beyond the locations above.</div>
          {groups.map((g) => (
            <div key={g.id} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n400)', fontFamily: 'var(--ff-m)' }}>{g.name}</div>
              <div style={box}>
                {g.sites.map((s) => {
                  const viaLoc = g.id !== 'none' && locSel.includes(g.id)
                  return (
                    <Chip key={s.id} on={viaLoc || siteSel.includes(s.id)} disabled={viaLoc}
                      title={viaLoc ? `Included via ${g.name}` : undefined}
                      onClick={() => toggle('site_scope', s.id)}>
                      {s.name}
                    </Chip>
                  )
                })}
              </div>
            </div>
          ))}
          {sites.length === 0 && <div style={{ fontSize: 12, color: 'var(--n400)', marginTop: 8 }}>No sites yet.</div>}
        </div>
      </div>

      {/* Extra permissions */}
      <div style={{ borderTop: 'var(--bdr)', paddingTop: 16 }}>
        <div style={secLabel}>Extra permissions</div>
        <div style={secHint}>Granted on top of the role's defaults.{capSel.length ? ` (${capSel.length} added)` : ''}</div>
        <div style={box}>
          {GRANTABLE_CAPS.map((c) => <Chip key={c.key} on={capSel.includes(c.key)} onClick={() => toggle('extra_caps', c.key)}>{c.label}</Chip>)}
        </div>
      </div>
    </div>
  )
}

// ── Sites Tab ────────────────────────────────────────────────────────────────

function SiteModal({ site, locations, onClose, onSave }) {
  const [form, setForm] = useState({ name: site?.name || '', code: site?.code || '', region: site?.region || '', location_id: site?.location_id || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) { setErr('Name and code are required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, location_id: form.location_id || null }
      if (site) await updateSite(site.id, payload)
      else await createSite(payload)
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
                className="input"/>
            </label>
          ))}
          <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
            Location
            <select value={form.location_id} onChange={e => setForm(f => ({...f,location_id:e.target.value}))}
              className="input">
              <option value="">— Unassigned —</option>
              {(locations||[]).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
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
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null) // null | 'new' | site object
  const locName = (id) => locations.find(l => l.id === id)?.name

  function load() {
    setLoading(true)
    Promise.all([listSites(), listLocations().catch(() => [])])
      .then(([s, l]) => { setSites(s); setLocations(l); setLoading(false) })
      .catch(e => { setErr(e.message); setLoading(false) })
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
                  <button onClick={() => archive(s.id)} style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
                </div>
              </div>
              <div style={{fontSize:11,color:'var(--n500)',display:'flex',gap:8}}>
                {locName(s.location_id) && <span style={{color:'var(--b600)'}}>📍 {locName(s.location_id)}</span>}
                {s.region && <span>{s.region}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <SiteModal
          site={modal === 'new' ? null : modal}
          locations={locations}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

// ── Locations Tab ─────────────────────────────────────────────────────────────

function LocationModal({ location, onClose, onSave }) {
  const [form, setForm] = useState({ name: location?.name || '', code: location?.code || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setErr('Name is required.'); return }
    setSaving(true)
    try {
      if (location) await updateLocation(location.id, form)
      else await createLocation(form)
      onSave()
    } catch (ex) { setErr(ex.message) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:380,padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:18}}>{location ? 'Edit Location' : 'Add Location'}</div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          {[['name','Location Name','e.g. Lagos'],['code','Short Code (optional)','e.g. LG']].map(([k,l,ph]) => (
            <label key={k} style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
              {l}
              <input value={form[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={ph}
                className="input"/>
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

function LocationsTab() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null)

  function load() {
    setLoading(true)
    listLocations().then(l => { setLocations(l); setLoading(false) }).catch(e => { setErr(e.message); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  async function archive(id) {
    if (!confirm('Archive this location? Its sites keep working but lose their location link.')) return
    try { await softDeleteLocation(id); load() } catch (e) { alert(e.message) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Locations ({locations.length})</div>
        <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setModal('new')}>+ Add Location</button>
      </div>
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : err ? (
        <div style={{padding:12,background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,fontSize:13,color:'var(--srt)'}}>{err}</div>
      ) : locations.length === 0 ? (
        <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>No locations yet. A location groups one or more sites; staff can be scoped to whole locations.</div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:10}}>
          {locations.map(l => (
            <div key={l.id} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>📍 {l.name}</div>
                  <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>{l.site_count} site{l.site_count !== 1 ? 's' : ''}{l.code ? ` · ${l.code}` : ''}</div>
                </div>
                <div style={{display:'flex',gap:4}}>
                  <button onClick={() => setModal(l)} style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                  <button onClick={() => archive(l.id)} style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <LocationModal
          location={modal === 'new' ? null : modal}
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
                className="input"/>
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
                <button onClick={() => remove(c.id)} style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Delete</button>
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

// ── Users Tab ──────────────────────────────────────────────────────────────

const ROLES_LIST = [
  {key:'owner',label:'System Admin',desc:'Full access including team, locations, org settings and audit.',perms:['All modules','Admin','Team & RBAC']},
  {key:'ops_manager',label:'Operations Manager',desc:'Full access to assets, work orders, maintenance, reports.',perms:['Assets (full)','Work Orders (full)','Maintenance (full)','Reports (full)']},
  {key:'maint_engineer',label:'Maintenance Engineer',desc:'Create and complete work orders, log maintenance.',perms:['Assets (view/edit)','Work Orders (full)','Maintenance (full)']},
  {key:'field_tech',label:'Field Technician',desc:'View and update assigned work orders.',perms:['Assets (view)','Work Orders (assigned only)','Maintenance (assigned only)']},
  {key:'hse_officer',label:'HSE / Compliance Officer',desc:'Full access to compliance and inspections.',perms:['Assets (view)','Compliance (full)','Inspections (full)','Reports (view)']},
  {key:'auditor',label:'Auditor',desc:'Read-only across all modules, plus full audit-log visibility.',perms:['All modules (read)','Audit log']},
  {key:'viewer',label:'Viewer',desc:'Read-only access to dashboard and reports.',perms:['Dashboard (view)','Reports (view)']},
]

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (!parts.length) return name.trim()[0]?.toUpperCase() || '?'
  return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

function InviteModal({ locations, sites, onClose, onInvited }) {
  const [form, setForm] = useState({ email: '', full_name: '', role_key: 'field_tech' })
  const [scope, setScope] = useState({ location_scope: [], site_scope: [], extra_caps: [] })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [link, setLink] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!form.email.trim() || !form.full_name.trim()) { setErr('Email and name are required.'); return }
    setBusy(true); setErr('')
    try {
      const { invite_link } = await inviteOrgMember({
        ...form,
        location_scope: scope.location_scope.length ? scope.location_scope : null,
        site_scope: scope.site_scope.length ? scope.site_scope : null,
        extra_caps: scope.extra_caps,
      })
      if (invite_link) setLink(invite_link)
      else { onInvited(); onClose() }
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  if (link) {
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,padding:24,boxShadow:'var(--sh-lg)'}}>
          <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:10}}>Invite sent</div>
          <p style={{fontSize:12,color:'var(--n500)',marginBottom:10}}>SMTP isn't configured in dev — share this set-password link with {form.email} directly:</p>
          <code style={{display:'block',fontSize:11,background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:4,padding:'8px 10px',wordBreak:'break-all',marginBottom:16}}>{link}</code>
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

function AccessModal({ member, locations, sites, onClose, onSaved }) {
  const [scope, setScope] = useState({
    location_scope: member.location_scope || [],
    site_scope: member.site_scope || [],
    extra_caps: member.extra_caps || [],
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setSaving(true); setErr('')
    try {
      await updateOrgMemberAccess(member.id, {
        location_scope: scope.location_scope.length ? scope.location_scope : null,
        site_scope: scope.site_scope.length ? scope.site_scope : null,
        extra_caps: scope.extra_caps,
      })
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:480,maxWidth:'94vw',maxHeight:'92vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:4}}>Access & permissions</div>
        <div style={{fontSize:12,color:'var(--n500)',marginBottom:16}}>{member.full_name || member.email}</div>
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

function UsersTab() {
  const [subtab, setSubtab] = useState('members')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [members, setMembers] = useState([])
  const [locations, setLocations] = useState([])
  const [sites, setSites] = useState([])
  const [accessMember, setAccessMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [resetLink, setResetLink] = useState(null)
  const { roleKey, user } = useAuth()
  const canManage = can(roleKey, 'user:manage')

  function load() {
    setLoading(true)
    Promise.all([listOrgMembers(), listLocations().catch(() => []), listSites().catch(() => [])])
      .then(([m, l, s]) => { setMembers(m); setLocations(l); setSites(s); setLoading(false) })
      .catch(e => { setErr(e.message); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  async function changeRole(m, role_key) {
    try { await updateOrgMemberRole(m.id, role_key); load() } catch (e) { alert(e.message) }
  }

  async function toggleStatus(m) {
    const enable = m.status === 'disabled'
    if (!enable && !confirm(`Disable ${m.full_name || m.email}? They will lose access immediately.`)) return
    try { await setOrgMemberStatus(m.id, enable); load() } catch (e) { alert(e.message) }
  }

  async function sendReset(m) {
    try {
      const { action_link } = await resetOrgMemberPassword(m.id)
      setResetLink(action_link || 'Link generated (check email delivery settings).')
    } catch (e) { alert(e.message) }
  }

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
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead>
                  <tr style={{background:'var(--n50)'}}>
                    {['User','Email','Role','Status',''].map(h => (
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
                            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:'#fff',flexShrink:0}}>{initials(m.full_name)}</div>
                            <span style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{m.full_name || '—'}{isSelf && <span style={{color:'var(--n400)',fontWeight:400}}> (you)</span>}</span>
                          </div>
                        </td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)'}}>{m.email}</td>
                        <td style={{padding:'11px 14px'}}>
                          <select value={m.role_key} disabled={!canManage} onChange={e => changeRole(m, e.target.value)}
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
                              <button onClick={() => setAccessMember(m)} style={{padding:'3px 8px',border:'1px solid var(--b200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--b700)',cursor:'pointer'}}>Access</button>
                              <button onClick={() => sendReset(m)} style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Reset password</button>
                              <button onClick={() => toggleStatus(m)} style={{padding:'3px 8px',border:`1px solid ${disabled?'var(--n200)':'var(--srbr)'}`,borderRadius:3,background:disabled?'var(--n0)':'var(--srb)',fontSize:11,color:disabled?'var(--sgt)':'var(--srt)',cursor:'pointer'}}>{disabled?'Enable':'Disable'}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
          </div>
        )}
      </div>
      {inviteOpen && <InviteModal locations={locations} sites={sites} onClose={() => setInviteOpen(false)} onInvited={load} />}
      {accessMember && <AccessModal member={accessMember} locations={locations} sites={sites} onClose={() => setAccessMember(null)} onSaved={() => { setAccessMember(null); load() }} />}
      {resetLink && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,padding:24,boxShadow:'var(--sh-lg)'}}>
            <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:10}}>Password reset link</div>
            <p style={{fontSize:12,color:'var(--n500)',marginBottom:10}}>Share this one-time link with the user (also emailed if SMTP is configured):</p>
            <code style={{display:'block',fontSize:11,background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:4,padding:'8px 10px',wordBreak:'break-all',marginBottom:16}}>{resetLink}</code>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button className="btn btn-primary" onClick={() => setResetLink(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
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

// ── Configuration Tab ─────────────────────────────────────────────────────────

function ConfigTab() {
  const { roleKey } = useAuth()
  const canEdit = can(roleKey, 'org:manage')
  const [org, setOrg] = useState(null)
  const [threshold, setThreshold] = useState(50)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getOrg()
      .then(o => { setOrg(o); setThreshold(o.settings?.health?.inspectionThreshold ?? 50); setLoading(false) })
      .catch(e => { setMsg(e.message); setLoading(false) })
  }, [])

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const t = Math.max(1, Math.min(99, Number(threshold) || 50))
      const settings = { ...(org?.settings || {}), health: { ...(org?.settings?.health || {}), inspectionThreshold: t } }
      const updated = await updateOrg({ settings })
      setOrg(updated); setThreshold(t); setMsg('Saved.')
    } catch (e) { setMsg(e.message) } finally { setSaving(false) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : (
        <div style={{maxWidth:520,background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'18px 20px'}}>
          <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:4}}>Health & inspection threshold</div>
          <div style={{fontSize:12,color:'var(--n500)',marginBottom:14,lineHeight:1.6}}>
            When an asset's health falls to this percentage, an inspection alert is raised. Maintenance alerts and auto-drafted work orders always trigger at 30%.
          </div>
          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)'}}>
            Inspection alert at
            <input type="number" min={1} max={99} value={threshold} disabled={!canEdit}
              onChange={e => setThreshold(e.target.value)}
              style={{width:80,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}/>
            % health
          </label>
          {!canEdit && <div style={{fontSize:11,color:'var(--n400)',marginTop:8}}>Only a System Admin can change this.</div>}
          {msg && <div style={{fontSize:12,color:msg==='Saved.'?'var(--sgt)':'var(--srt)',marginTop:10}}>{msg}</div>}
          {canEdit && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" style={{height:34,padding:'0 16px',fontSize:13}} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { k: 'locations', label: 'Locations', cap: 'org:manage' },
  { k: 'sites', label: 'Sites', cap: 'org:manage' },
  { k: 'categories', label: 'Asset Categories', cap: 'org:manage' },
  { k: 'users', label: 'Users & Roles', cap: 'user:manage' },
  { k: 'config', label: 'Configuration', cap: 'org:manage' },
  { k: 'audit', label: 'Audit Log', cap: 'audit:read' },
]

export default function Admin({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const visibleTabs = TABS.filter((t) => can(roleKey, t.cap))
  const [tab, setTab] = useState(visibleTabs[0]?.k)

  useEffect(() => {
    if (!visibleTabs.some((t) => t.k === tab)) setTab(visibleTabs[0]?.k)
  }, [roleKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
              {visibleTabs.map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            {tab === 'locations' && <LocationsTab />}
            {tab === 'sites' && <SitesTab />}
            {tab === 'categories' && <CategoriesTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'config' && <ConfigTab />}
            {tab === 'audit' && <AuditTab />}
            {!tab && <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>You don't have access to any Admin section.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
