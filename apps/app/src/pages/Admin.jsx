import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listSites, createSite, updateSite, softDeleteSite } from '../lib/db/sites.js'
import { listLocations, createLocation, updateLocation, softDeleteLocation } from '../lib/db/locations.js'
import { listCategories, createCategory, updateCategory, deleteCategory } from '../lib/db/categories.js'
import { listAuditLog } from '../lib/db/audit.js'
import { actionLabel, actionColor, entityTypeLabel } from '../lib/auditLabels.js'
import { listOrgMembers, inviteOrgMember, updateOrgMemberRole, updateOrgMemberAccess, setOrgMemberStatus, resetOrgMemberPassword } from '../lib/db/orgMembers.js'
import { getOrg, updateOrgSettings } from '../lib/db/org.js'
import {
  listEscalationRules, listEscalationEvents, createEscalationRule, updateEscalationRule,
  retireEscalationRule, runEscalationsNow, ESCALATION_ENTITY_TYPES, VALID_TRIGGERS, TRIGGER_LABEL,
} from '../lib/db/escalations.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { can, ROLE_CAPABILITIES, ROLE_KEYS, ROLE_LABELS, ADMIN_ENTRY_CAPS, GRANTABLE_CAPS as GRANTABLE_CAP_KEYS } from '../lib/rbac.js'
import { useToast } from '../lib/ToastContext'
import { errorText } from '../lib/errors'

// Human labels for the grantable capabilities. The KEYS come from
// @assetcore/rbac (the same list the API's invite/access schemas validate
// against), so the chips offered here always match what the server accepts.
const CAP_LABELS = {
  'asset:create': 'Create assets',
  'asset:update': 'Edit assets',
  'wo:create': 'Create work orders',
  'wo:update': 'Edit work orders',
  'wo:assign': 'Assign work orders',
  'wo:transition': 'Change work-order status',
  'pm:create': 'Create maintenance schedules',
  'pm:update': 'Update maintenance status',
  'maintenance:complete': 'Complete maintenance',
  'inspection:create': 'Create inspections',
  'inspection:update': 'Update inspection status',
  'compliance:create': 'Create compliance records',
  'compliance:update': 'Manage compliance',
  'report:create': 'Generate reports',
  'audit:read': 'View audit log',
}
const GRANTABLE_CAPS = GRANTABLE_CAP_KEYS.map((key) => ({ key, label: CAP_LABELS[key] || key }))

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
    } catch (ex) { setErr(errorText(ex)) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:400,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
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
      .catch(e => { setErr(errorText(e)); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function archive(id) {
    if (!confirm('Archive this site? It will no longer appear in lists.')) return
    try { await softDeleteSite(id); load() } catch (e) { alert(errorText(e)) }
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
                  <button onClick={() => setModal(s)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                  <button onClick={() => archive(s.id)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
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
    } catch (ex) { setErr(errorText(ex)) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:380,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
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
    listLocations().then(l => { setLocations(l); setLoading(false) }).catch(e => { setErr(errorText(e)); setLoading(false) })
  }
  useEffect(() => { load() }, [])

  async function archive(id) {
    if (!confirm('Archive this location? Its sites keep working but lose their location link.')) return
    try { await softDeleteLocation(id); load() } catch (e) { alert(errorText(e)) }
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
                  <button onClick={() => setModal(l)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                  <button onClick={() => archive(l.id)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
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
    } catch (ex) { setErr(errorText(ex)) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:380,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
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
    listCategories().then(c => { setCats(c); setLoading(false) }).catch(e => { setErr(errorText(e)); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    if (!confirm('Delete this category? This cannot be undone.')) return
    try { await deleteCategory(id); load() } catch (e) { alert(errorText(e)) }
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
                <button onClick={() => setModal(c)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                <button onClick={() => remove(c.id)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Delete</button>
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
  { label: 'Reports', cap: 'report:read' },
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
                      const has = g.caps ? g.caps.some((c) => can(rk, c)) : can(rk, g.cap)
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

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
  if (!parts.length) return name.trim()[0]?.toUpperCase() || '?'
  return ((parts[0][0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

function InviteModal({ locations, sites, onClose, onInvited }) {
  const toast = useToast()
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
      else { toast.success(`Invite sent to ${form.email}.`); onInvited(); onClose() }
    } catch (ex) { setErr(errorText(ex)) } finally { setBusy(false) }
  }

  if (link) {
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
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
  const toast = useToast()
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
      toast.success('Access updated.')
      onSaved()
    } catch (e) { setErr(errorText(e)); setSaving(false) }
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
  const { roleKey, extraCaps, user } = useAuth()
  const canManage = can(roleKey, 'user:manage', extraCaps)

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
    if (!enable && !confirm(`Disable ${m.full_name || m.email}? They will lose access immediately.`)) return
    try { await setOrgMemberStatus(m.id, enable); load(); toast.success(enable ? 'Member enabled.' : 'Member disabled.') }
    catch (e) { toast.error(errorText(e, 'Failed to update member status.')) }
  }

  async function sendReset(m) {
    try {
      const { action_link } = await resetOrgMemberPassword(m.id)
      setResetLink(action_link || 'Link generated (check email delivery settings).')
      toast.success('Password reset link generated.')
    } catch (e) { toast.error(errorText(e, 'Failed to generate reset link.')) }
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
              <div className="table-scroll"><table style={{width:'100%',borderCollapse:'collapse'}}>
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
      {accessMember && <AccessModal member={accessMember} locations={locations} sites={sites} onClose={() => setAccessMember(null)} onSaved={() => { setAccessMember(null); load() }} />}
      {resetLink && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:460,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
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
      .catch(e => { setErr(errorText(e)); setLoading(false) })
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
          <div className="table-scroll"><table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead style={{position:'sticky',top:0,zIndex:10}}>
              <tr style={{background:'var(--n50)'}}>
                {['Time','Actor','Action','Entity'].map(h => (
                  <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{borderBottom:'var(--bdr)'}}>
                  {/* Year and seconds included: without them two events a year
                      apart rendered identically. */}
                  <td style={{padding:'9px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>
                    {new Date(r.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                  </td>
                  <td style={{padding:'9px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>
                    {r.actor?.full_name || r.actor?.email || 'System'}
                  </td>
                  <td style={{padding:'9px 14px'}}>
                    <span style={{fontSize:12,fontWeight:500,color:actionColor(r.action)}}>
                      {actionLabel(r.action)}
                    </span>
                  </td>
                  {/* The snapshot label written with the row (0018). This cell
                      used to read `work_order 3f9a2c1b` — the entity type plus
                      the first eight characters of a UUID, not even a complete
                      one, so it couldn't be pasted into a lookup. */}
                  <td style={{padding:'9px 14px',fontSize:12,color:'var(--n800)'}}>
                    {r.entity_label
                      ? <span>{r.entity_label}</span>
                      : <span style={{color:'var(--n400)'}}>{entityTypeLabel(r.entity_type)}</span>}
                    {r.entity_label && (
                      <span style={{color:'var(--n400)',fontSize:11,marginLeft:6}}>{entityTypeLabel(r.entity_type)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}

// ── Configuration Tab ─────────────────────────────────────────────────────────

function ConfigTab() {
  const { roleKey, extraCaps } = useAuth()
  const canEdit = can(roleKey, 'org:manage', extraCaps)
  const [org, setOrg] = useState(null)
  const [threshold, setThreshold] = useState(50)
  const [maintThreshold, setMaintThreshold] = useState(30)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  // Org-wide depreciation policy. Every asset inherits this unless it carries
  // its own override, and saving it recomputes the whole register server-side
  // (PATCH /org/settings) rather than waiting for the 02:00 job.
  const [depMethod, setDepMethod] = useState('straight_line')
  const [depLife, setDepLife] = useState(10)
  const [depSalvage, setDepSalvage] = useState(0)
  const [depRate, setDepRate] = useState(20)
  const [depStart, setDepStart] = useState('install_date')
  const [depSaving, setDepSaving] = useState(false)
  const [depMsg, setDepMsg] = useState(null)

  useEffect(() => {
    getOrg()
      .then(o => {
        setOrg(o)
        setThreshold(o.settings?.health?.inspectionThreshold ?? 50)
        setMaintThreshold(o.settings?.health?.maintenanceThreshold ?? 30)
        const d = o.settings?.depreciation || {}
        setDepMethod(d.method ?? 'straight_line')
        setDepLife(d.usefulLifeYears ?? 10)
        setDepSalvage(d.salvageRatePct ?? 0)
        setDepRate(d.decliningRatePct ?? 20)
        setDepStart(d.startFrom ?? 'install_date')
        setLoading(false)
      })
      .catch(e => { setMsg(errorText(e)); setLoading(false) })
  }, [])

  async function saveDepreciation() {
    setDepSaving(true); setDepMsg(null)
    try {
      const life = Math.max(0.5, Math.min(200, Number(depLife) || 10))
      const salvage = Math.max(0, Math.min(99, Number(depSalvage) || 0))
      const rate = Math.max(0.1, Math.min(99.9, Number(depRate) || 20))
      // Merge, don't replace — PATCH /org/settings writes the whole settings
      // object, so building it from scratch here would wipe the health
      // thresholds saved by the card above.
      const settings = {
        ...(org?.settings || {}),
        depreciation: { method: depMethod, usefulLifeYears: life, salvageRatePct: salvage, decliningRatePct: rate, startFrom: depStart },
      }
      const updated = await updateOrgSettings(settings)
      setOrg(updated); setDepLife(life); setDepSalvage(salvage); setDepRate(rate)
      setDepMsg('Saved — book values recalculated.')
    } catch (e) { setDepMsg(errorText(e, 'Could not save the depreciation policy.')) } finally { setDepSaving(false) }
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const t = Math.max(1, Math.min(99, Number(threshold) || 50))
      const m = Math.max(1, Math.min(99, Number(maintThreshold) || 30))
      // The maintenance band must sit below the inspection band — otherwise an
      // asset would trigger maintenance before (or instead of) an inspection.
      if (m >= t) { setMsg('Maintenance threshold must be below the inspection threshold.'); setSaving(false); return }
      const settings = { ...(org?.settings || {}), health: { ...(org?.settings?.health || {}), inspectionThreshold: t, maintenanceThreshold: m } }
      const updated = await updateOrgSettings(settings)
      setOrg(updated); setThreshold(t); setMaintThreshold(m); setMsg('Saved.')
    } catch (e) { setMsg(errorText(e)) } finally { setSaving(false) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : (
        <div style={{maxWidth:520,background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'18px 20px'}}>
          <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:4}}>Health thresholds</div>
          <div style={{fontSize:12,color:'var(--n500)',marginBottom:14,lineHeight:1.6}}>
            When an asset's health falls to the inspection threshold, an inspection is raised.
            At the maintenance threshold, a maintenance alert is sent and a work order is auto-drafted.
            The maintenance threshold must be below the inspection threshold.
          </div>
          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
            Inspection alert at
            <input type="number" min={1} max={99} value={threshold} disabled={!canEdit}
              onChange={e => setThreshold(e.target.value)}
              style={{width:80,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}/>
            % health
          </label>
          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)'}}>
            Maintenance trigger at
            <input type="number" min={1} max={99} value={maintThreshold} disabled={!canEdit}
              onChange={e => setMaintThreshold(e.target.value)}
              style={{width:80,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}/>
            % health
          </label>
          {!canEdit && <div style={{fontSize:11,color:'var(--n400)',marginTop:8}}>Only a System Admin or Operations Manager can change this.</div>}
          {msg && <div style={{fontSize:12,color:msg==='Saved.'?'var(--sgt)':'var(--srt)',marginTop:10}}>{msg}</div>}
          {canEdit && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" style={{height:34,padding:'0 16px',fontSize:13}} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div style={{maxWidth:520,background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'18px 20px',marginTop:16}}>
          <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:4}}>Depreciation</div>
          <div style={{fontSize:12,color:'var(--n500)',marginBottom:14,lineHeight:1.6}}>
            How book value is calculated across the asset register. Individual assets
            can override any of these; anything left unset here uses the defaults below.
            Assets without a purchase value or a start date show no book value at all
            rather than zero.
          </div>

          <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
            <span style={{width:150,flexShrink:0}}>Method</span>
            <select value={depMethod} disabled={!canEdit} onChange={e => setDepMethod(e.target.value)}
              style={{flex:1,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 8px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}>
              <option value="straight_line">Straight-line</option>
              <option value="declining_balance">Declining balance</option>
              <option value="none">Do not depreciate</option>
            </select>
          </label>

          {depMethod !== 'none' && (
            <>
              <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
                <span style={{width:150,flexShrink:0}}>Depreciate from</span>
                <select value={depStart} disabled={!canEdit} onChange={e => setDepStart(e.target.value)}
                  style={{flex:1,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 8px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}>
                  <option value="install_date">Install date</option>
                  <option value="purchase_date">Purchase date</option>
                </select>
              </label>

              {depMethod === 'straight_line' && (
                <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
                  <span style={{width:150,flexShrink:0}}>Useful life</span>
                  <input type="number" min={0.5} max={200} step={0.5} value={depLife} disabled={!canEdit}
                    onChange={e => setDepLife(e.target.value)}
                    style={{width:90,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}/>
                  years
                </label>
              )}

              {depMethod === 'declining_balance' && (
                <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)',marginBottom:10}}>
                  <span style={{width:150,flexShrink:0}}>Declining rate</span>
                  <input type="number" min={0.1} max={99.9} step={0.1} value={depRate} disabled={!canEdit}
                    onChange={e => setDepRate(e.target.value)}
                    style={{width:90,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}/>
                  % per year
                </label>
              )}

              <label style={{display:'flex',alignItems:'center',gap:10,fontSize:13,color:'var(--n700)'}}>
                <span style={{width:150,flexShrink:0}}>Residual value</span>
                <input type="number" min={0} max={99} value={depSalvage} disabled={!canEdit}
                  onChange={e => setDepSalvage(e.target.value)}
                  style={{width:90,height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,background:canEdit?'var(--n0)':'var(--n50)',color:'var(--n900)'}}/>
                % of purchase value
              </label>
            </>
          )}

          {!canEdit && <div style={{fontSize:11,color:'var(--n400)',marginTop:8}}>Only a System Admin or Operations Manager can change this.</div>}
          {depMsg && <div style={{fontSize:12,color:depMsg.startsWith('Saved')?'var(--sgt)':'var(--srt)',marginTop:10}}>{depMsg}</div>}
          {canEdit && (
            <div style={{marginTop:16}}>
              <button className="btn btn-primary" style={{height:34,padding:'0 16px',fontSize:13}} disabled={depSaving} onClick={saveDepreciation}>{depSaving ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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
    notify_role_key: rule?.notify_role_key || 'ops_manager',
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
      setErr(ex.message === 'invalid_trigger_for_entity'
        ? 'That trigger does not apply to this kind of record.'
        : errorText(ex, 'Could not save the rule.'))
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

function EscalationsTab() {
  const toast = useToast()
  const { roleKey, extraCaps } = useAuth()
  const canManage = can(roleKey, 'escalation:manage', extraCaps)
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
    if (!confirm(`Retire “${rule.name}”? It stops being evaluated; the escalations it already raised are kept.`)) return
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

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { k: 'locations', label: 'Locations', cap: 'org:manage' },
  { k: 'sites', label: 'Sites', cap: 'org:manage' },
  { k: 'categories', label: 'Asset Categories', cap: 'org:manage' },
  { k: 'users', label: 'Users & Roles', cap: 'user:manage' },
  { k: 'config', label: 'Configuration', cap: 'org:manage' },
  { k: 'escalations', label: 'Escalations', cap: 'escalation:read' },
  { k: 'audit', label: 'Audit Log', cap: 'audit:read' },
]

export default function Admin({ dark, toggleDark }) {
  const { roleKey, extraCaps } = useAuth()
  const visibleTabs = TABS.filter((t) => can(roleKey, t.cap, extraCaps))
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
            <div className="tab-strip" style={{gap:0}}>
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
            {tab === 'escalations' && <EscalationsTab />}
            {tab === 'audit' && <AuditTab />}
            {!tab && <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>You don't have access to any Admin section.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
