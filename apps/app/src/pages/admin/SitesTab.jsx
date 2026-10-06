import { useState, useEffect } from 'react'
import { listSites, createSite, updateSite, softDeleteSite, shutdownSite, reopenSite } from '../../lib/db/sites.js'
import { listLocations } from '../../lib/db/locations.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'

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

// Shutting a site down is reversible but not small — every asset there goes
// Inactive and nobody can raise work at it — so it asks for a reason and says
// how many assets it will touch before it does anything.
function ShutdownSiteModal({ site, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const n = site.asset_count ?? 0

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) { setErr('Give a reason — it is shown on the site and kept in the audit log.'); return }
    setSaving(true); setErr('')
    try {
      const res = await shutdownSite(site.id, reason.trim())
      toast.success(`${site.name} shut down. ${res.assets_affected} asset${res.assets_affected !== 1 ? 's' : ''} marked Inactive.`)
      onDone()
    } catch (ex) { setErr(errorText(ex, 'Could not shut the site down.')); setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:420,maxWidth:'92vw',padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:6}}>Shut down {site.name}</div>
        <div style={{padding:'10px 12px',background:'var(--sab)',border:'1px solid var(--sabr)',borderRadius:6,fontSize:12,color:'var(--sat)',lineHeight:1.5,marginBottom:14}}>
          {n} asset{n !== 1 ? 's' : ''} at this site will be marked Inactive and no new work can be raised there.
          Reopening the site gives each asset back the status it has now.
        </div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
            Reason *
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000} className="input"
              style={{height:'auto',padding:'8px 10px',resize:'vertical'}} placeholder="e.g. Field decommissioned pending sale" />
          </label>
          {err && <div style={{fontSize:12,color:'var(--srt)'}}>{err}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-danger-soft" disabled={saving}>{saving ? 'Shutting down…' : 'Shut down site'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function SitesTab() {
  const ask = useConfirm()
  const toast = useToast()
  const [sites, setSites] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null) // null | 'new' | site object
  const [shuttingDown, setShuttingDown] = useState(null) // site being shut down
  const locName = (id) => locations.find(l => l.id === id)?.name

  function load() {
    setLoading(true)
    Promise.all([listSites(), listLocations().catch(() => [])])
      .then(([s, l]) => { setSites(s); setLocations(l); setLoading(false) })
      .catch(e => { setErr(errorText(e)); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function archive(id) {
    if (!(await ask('Archive this site? It will no longer appear in lists.', { danger: true, confirmLabel: 'Archive' }))) return
    try { await softDeleteSite(id); load() } catch (e) { toast.error(errorText(e)) }
  }

  async function reopen(s) {
    if (!(await ask(`Reopen ${s.name}? Its inactive assets get back the status they had before the shutdown, and work can be raised there again.`, { confirmLabel: 'Reopen' }))) return
    try {
      const res = await reopenSite(s.id)
      toast.success(`${s.name} reopened. ${res.assets_affected} asset${res.assets_affected !== 1 ? 's' : ''} restored.`)
      load()
    } catch (e) { toast.error(errorText(e, 'Could not reopen the site.')) }
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
          {sites.map(s => {
            const shut = s.status === 'shutdown'
            return (
            <div key={s.id} style={{background:shut ? 'var(--n50)' : 'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                    <span style={{fontSize:13,fontWeight:600,color:shut ? 'var(--n600)' : 'var(--n900)'}}>{s.name}</span>
                    {shut && <span style={{padding:'1px 6px',border:'1px solid var(--n300)',borderRadius:2,background:'var(--n100)',fontSize:10,fontWeight:500,color:'var(--n600)'}}>Shut down</span>}
                  </div>
                  <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b600)',marginTop:2}}>{s.code}</div>
                </div>
                <div style={{display:'flex',gap:4,flexWrap:'wrap',justifyContent:'flex-end'}}>
                  <button onClick={() => setModal(s)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                  {shut
                    ? <button onClick={() => reopen(s)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--sgbr)',borderRadius:3,background:'var(--sgb)',fontSize:11,color:'var(--sgt)',cursor:'pointer'}}>Reopen</button>
                    : <button onClick={() => setShuttingDown(s)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--sabr)',borderRadius:3,background:'var(--sab)',fontSize:11,color:'var(--sat)',cursor:'pointer'}}>Shut down</button>}
                  <button onClick={() => archive(s.id)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
                </div>
              </div>
              <div style={{fontSize:11,color:'var(--n500)',display:'flex',gap:8,flexWrap:'wrap'}}>
                {locName(s.location_id) && <span style={{color:'var(--b600)'}}>📍 {locName(s.location_id)}</span>}
                {s.region && <span>{s.region}</span>}
                <span>{s.asset_count ?? 0} asset{s.asset_count === 1 ? '' : 's'}</span>
              </div>
              {shut && (
                <div style={{fontSize:11,color:'var(--n600)',lineHeight:1.5,borderTop:'var(--bdr)',paddingTop:6}}>
                  Shut down {s.shutdown_at ? new Date(s.shutdown_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : ''}
                  {s.shutdown_reason && <> — {s.shutdown_reason}</>}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
      {shuttingDown && (
        <ShutdownSiteModal
          site={shuttingDown}
          onClose={() => setShuttingDown(null)}
          onDone={() => { setShuttingDown(null); load() }}
        />
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
