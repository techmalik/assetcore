import { useState, useEffect } from 'react'
import { listLocations, createLocation, updateLocation, softDeleteLocation } from '../../lib/db/locations.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'

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

export default function LocationsTab() {
  const toast = useToast()
  const ask = useConfirm()
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
    if (!(await ask('Archive this location? Its sites keep working but lose their location link.', { danger: true, confirmLabel: 'Archive' }))) return
    try { await softDeleteLocation(id); load() } catch (e) { toast.error(errorText(e)) }
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
