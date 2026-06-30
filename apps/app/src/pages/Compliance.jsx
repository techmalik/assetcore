import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import {
  listComplianceLicences, createComplianceLicence, updateComplianceLicence,
  softDeleteComplianceLicence, listAuthorities, checkLicenceExpiry,
  licenceStatus, daysUntilExpiry,
} from '../lib/db/complianceLicences'
import { listSites } from '../lib/db/sites'

const STATUS_META = {
  active:   { label:'Active',        bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)' },
  due_soon: { label:'Due Soon',      bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)' },
  expiring: { label:'Expiring',      bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  expired:  { label:'Expired',       bg:'var(--srb)', c:'var(--srt)', br:'var(--srbr)' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })
}

function daysLabel(expiryDate) {
  const d = daysUntilExpiry(expiryDate)
  if (d < 0)  return `${Math.abs(d)}d ago`
  if (d === 0) return 'Today'
  return `${d}d`
}

// ── Licence Modal (add / edit) ────────────────────────────────────────────────
function LicenceModal({ licence, authorities, sites, onClose, onSaved }) {
  const editing = Boolean(licence)
  const [form, setForm] = useState({
    name:           licence?.name           || '',
    licence_number: licence?.licence_number || '',
    authority_id:   licence?.authority_id   || '',
    site_id:        licence?.site_id        || '',
    issued_date:    licence?.issued_date    || '',
    expiry_date:    licence?.expiry_date    || '',
    notes:          licence?.notes          || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim())        return setErr('Name is required.')
    if (!form.issued_date)        return setErr('Issued date is required.')
    if (!form.expiry_date)        return setErr('Expiry date is required.')
    setSaving(true); setErr(null)
    try {
      const payload = {
        name:           form.name.trim(),
        licence_number: form.licence_number || null,
        authority_id:   form.authority_id   || null,
        site_id:        form.site_id        || null,
        issued_date:    form.issued_date,
        expiry_date:    form.expiry_date,
        notes:          form.notes          || null,
      }
      if (editing) await updateComplianceLicence(licence.id, payload)
      else         await createComplianceLicence(payload)
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const labelStyle = { fontSize:12, fontWeight:500, color:'var(--n800)', display:'flex', flexDirection:'column', gap:4 }
  const inputStyle = { height:34, border:'1px solid var(--n200)', borderRadius:4, padding:'0 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', background:'var(--n0)', color:'var(--n900)', width:'100%', boxSizing:'border-box' }
  const selectStyle = { ...inputStyle, appearance:'none' }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'24px',width:480,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>{editing ? 'Edit Licence' : 'Add Licence'}</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={labelStyle}>Licence / Certificate name *
            <input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Operating Licence — Lagos DS-04" style={inputStyle}/>
          </label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={labelStyle}>Regulatory authority
              <select value={form.authority_id} onChange={e=>set('authority_id',e.target.value)} style={selectStyle}>
                <option value="">— Select —</option>
                {authorities.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name.slice(0,30)}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Licence number
              <input value={form.licence_number} onChange={e=>set('licence_number',e.target.value)} placeholder="e.g. NMDPRA/OL/2024/001" style={inputStyle}/>
            </label>
          </div>
          <label style={labelStyle}>Site
            <select value={form.site_id} onChange={e=>set('site_id',e.target.value)} style={selectStyle}>
              <option value="">— All sites / not site-specific —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={labelStyle}>Issued date *
              <input type="date" value={form.issued_date} onChange={e=>set('issued_date',e.target.value)} style={inputStyle}/>
            </label>
            <label style={labelStyle}>Expiry date *
              <input type="date" value={form.expiry_date} onChange={e=>set('expiry_date',e.target.value)} style={inputStyle}/>
            </label>
          </div>
          <label style={labelStyle}>Notes
            <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={2} style={{...inputStyle,height:'auto',padding:'8px 10px',resize:'vertical'}}/>
          </label>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':editing?'Save Changes':'Add Licence'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Detail Panel ─────────────────────────────────────────────────────────────
function DetailPanel({ lic, onEdit, onDelete, onClose }) {
  const meta = STATUS_META[lic.status] || STATUS_META.active
  const days = daysUntilExpiry(lic.expiry_date)
  return (
    <div style={{width:320,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:13,fontWeight:600,color:'var(--n900)',flex:1}}>Licence Detail</span>
        <button onClick={onClose} style={{width:24,height:24,border:'none',background:'none',cursor:'pointer',color:'var(--n400)',fontSize:18,lineHeight:1}}>×</button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'16px'}}>
        <span style={{display:'inline-flex',padding:'2px 8px',borderRadius:2,border:`1px solid ${meta.br}`,fontSize:11,fontWeight:600,background:meta.bg,color:meta.c,marginBottom:12}}>{meta.label}</span>
        <h3 style={{fontFamily:'var(--ff-d)',fontSize:16,fontWeight:700,color:'var(--n950)',marginBottom:4,lineHeight:1.3}}>{lic.name}</h3>
        {lic.licence_number && <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n400)',marginBottom:16}}>{lic.licence_number}</div>}

        <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
          {[
            { label:'Authority',    value: lic.authority?.code ? `${lic.authority.code} — ${lic.authority.name?.slice(0,30)}` : '—' },
            { label:'Site',         value: lic.site?.name || 'Not site-specific' },
            { label:'Issued',       value: fmtDate(lic.issued_date) },
            { label:'Expires',      value: fmtDate(lic.expiry_date) },
            { label:'Days',         value: days < 0 ? `${Math.abs(days)} days ago` : days === 0 ? 'Today' : `${days} days remaining` },
          ].map(r => (
            <div key={r.label} style={{display:'flex',gap:8}}>
              <span style={{fontSize:11,color:'var(--n500)',width:70,flexShrink:0}}>{r.label}</span>
              <span style={{fontSize:12,color:r.label==='Days'&&days<30?'var(--srt)':'var(--n800)',fontWeight:r.label==='Days'?600:400}}>{r.value}</span>
            </div>
          ))}
          {lic.notes && (
            <div>
              <div style={{fontSize:11,color:'var(--n500)',marginBottom:4}}>Notes</div>
              <div style={{fontSize:12,color:'var(--n700)',lineHeight:1.6,background:'var(--n50)',border:'var(--bdr)',borderRadius:4,padding:'8px 10px'}}>{lic.notes}</div>
            </div>
          )}
        </div>

        <div style={{display:'flex',gap:8}}>
          <button onClick={onEdit} className="btn btn-primary" style={{flex:1,height:34,fontSize:13}}>Edit</button>
          <button onClick={onDelete} className="btn btn-secondary" style={{height:34,padding:'0 14px',fontSize:13,color:'var(--srt)'}}>Archive</button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Compliance({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'wo:create') // ops_manager+
  const [licences, setLicences]       = useState([])
  const [authorities, setAuthorities] = useState([])
  const [sites, setSites]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [selected, setSelected]       = useState(null)
  const [modal, setModal]             = useState(null) // null | 'add' | licence-obj (edit)
  const [filter, setFilter]           = useState('all') // all|active|expiring|expired

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [lics, auths, siteList] = await Promise.all([listComplianceLicences(), listAuthorities(), listSites()])
      setLicences(lics)
      setAuthorities(auths)
      setSites(siteList)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = licences.filter(l => {
    if (filter === 'all') return true
    if (filter === 'active') return l.status === 'active' || l.status === 'due_soon'
    if (filter === 'expiring') return l.status === 'expiring' || l.status === 'due_soon'
    if (filter === 'expired') return l.status === 'expired'
    return true
  })

  const counts = { total: licences.length, active: 0, due_soon: 0, expiring: 0, expired: 0 }
  for (const l of licences) counts[l.status] = (counts[l.status] || 0) + 1

  const handleDelete = async (id) => {
    await softDeleteComplianceLicence(id)
    setSelected(null)
    load()
  }

  const handleRunExpiry = async () => {
    try { await checkLicenceExpiry() } catch { /* non-fatal */ }
  }

  return (
    <div className="app-shell">
      <Sidebar active="compliance"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Compliance" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {/* Header */}
          <div style={{padding:'14px 24px 12px',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Compliance</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Licences, certificates & regulatory requirements</p>
              </div>
              <div style={{flex:1}}/>
              <button onClick={handleRunExpiry} style={{height:32,padding:'0 14px',border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',fontSize:12,color:'var(--n600)',cursor:'pointer'}}>
                Check Expiry Alerts
              </button>
              {canCreate && (
                <button onClick={() => setModal('add')} style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  Add Licence
                </button>
              )}
            </div>

            {/* Summary strip */}
            <div style={{display:'flex',gap:8}}>
              {[
                { key:'all',      label:`All (${counts.total})`,          c:'var(--n700)',  bg:'var(--n100)', br:'var(--n200)' },
                { key:'active',   label:`Active (${counts.active + counts.due_soon})`, c:'var(--sgt)', bg:'var(--sgb)', br:'var(--sgbr)' },
                { key:'expiring', label:`Expiring (${counts.expiring + counts.due_soon})`, c:'var(--sat)', bg:'var(--sab)', br:'var(--sabr)' },
                { key:'expired',  label:`Expired (${counts.expired})`,    c:'var(--srt)',  bg:'var(--srb)', br:'var(--srbr)' },
              ].map(s => (
                <button key={s.key} onClick={() => setFilter(s.key)} style={{height:28,padding:'0 12px',border:`1px solid ${filter===s.key?s.br:'var(--n200)'}`,borderRadius:4,background:filter===s.key?s.bg:'var(--n0)',fontSize:12,fontWeight:filter===s.key?600:400,color:filter===s.key?s.c:'var(--n600)',cursor:'pointer'}}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {/* Table */}
            <div style={{flex:1,overflowY:'auto'}}>
              {loading ? (
                <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
              ) : err ? (
                <div style={{padding:24}}>
                  <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{err.includes('does not exist') ? 'Run migration 0004_phase3.sql to enable compliance licences.' : err}</div>
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState canCreate={canCreate} onAdd={() => setModal('add')} />
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,zIndex:10}}>
                    <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                      {['Licence / Certificate','Authority','Site','Issued','Expires','Days','Status',''].map(h => (
                        <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(lic => {
                      const meta = STATUS_META[lic.status] || STATUS_META.active
                      const active = selected?.id === lic.id
                      return (
                        <tr key={lic.id} onClick={() => setSelected(active ? null : lic)} className="row-hover" style={{borderBottom:'var(--bdr)',background:active?'var(--b50)':'transparent',cursor:'pointer',borderLeft:`3px solid ${active?'var(--b500)':'transparent'}`}}>
                          <td style={{padding:'11px 14px'}}>
                            <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{lic.name}</div>
                            {lic.licence_number && <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{lic.licence_number}</div>}
                          </td>
                          <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{lic.authority?.code || '—'}</td>
                          <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{lic.site?.name || '—'}</td>
                          <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{fmtDate(lic.issued_date)}</td>
                          <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:lic.status==='expired'?'var(--srt)':lic.status==='expiring'?'var(--sat)':'var(--n600)',whiteSpace:'nowrap'}}>{fmtDate(lic.expiry_date)}</td>
                          <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:lic.status==='expired'?'var(--srt)':lic.status==='expiring'||lic.status==='due_soon'?'var(--sat)':'var(--n600)',whiteSpace:'nowrap',fontWeight:lic.status!=='active'?600:400}}>{daysLabel(lic.expiry_date)}</td>
                          <td style={{padding:'11px 14px'}}>
                            <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:`1px solid ${meta.br}`,fontSize:10,fontWeight:500,background:meta.bg,color:meta.c}}>{meta.label}</span>
                          </td>
                          <td style={{padding:'11px 14px'}}>
                            <button onClick={e => { e.stopPropagation(); setModal(lic) }} style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Edit</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Detail panel */}
            {selected && (
              <DetailPanel
                lic={selected}
                onEdit={() => { setModal(selected); setSelected(null) }}
                onDelete={() => handleDelete(selected.id)}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      </div>

      {modal && (
        <LicenceModal
          licence={modal === 'add' ? null : modal}
          authorities={authorities}
          sites={sites}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); setSelected(null); load() }}
        />
      )}
    </div>
  )
}

function EmptyState({ canCreate, onAdd }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',gap:12,textAlign:'center'}}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="var(--n300)" strokeWidth="1.4"/><path d="M12 8v4.5l2.5 1.5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>No licences or certificates yet</div>
      <div style={{fontSize:13,color:'var(--n500)',maxWidth:320}}>Track regulatory licences, certificates, and their renewal deadlines. Alerts fire at 90, 30, and 7 days before expiry.</div>
      {canCreate && <button onClick={onAdd} className="btn btn-primary" style={{marginTop:8,height:36,padding:'0 18px',fontSize:13}}>Add first licence</button>}
    </div>
  )
}
