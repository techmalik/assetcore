import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import {
  listComplianceLicences, createComplianceLicence, updateComplianceLicence,
  softDeleteComplianceLicence, listAuthorities, checkLicenceExpiry,
  licenceStatus, daysUntilExpiry, uploadComplianceDocument,
  listAudits, getAuditStats, getAudit, createAudit, updateAudit,
  addFinding, updateFinding, raiseFindingDefect,
  AUDIT_KINDS, AUDIT_OUTCOMES, OUTCOME_LABEL, OUTCOME_CLASS,
  FINDING_SEVERITIES, FINDING_CLASS,
} from '../lib/db/complianceLicences'
import { listSites } from '../lib/db/sites'
import { api } from '../lib/apiClient'

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
function DetailPanel({ lic, onEdit, onDelete, onClose, canEdit, onDocUploaded }) {
  const meta = STATUS_META[lic.status] || STATUS_META.active
  const days = daysUntilExpiry(lic.expiry_date)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  async function viewDocument() {
    try { await api.download(`/files/${lic.document_url}`, lic.document_url.split('/').pop()) }
    catch (ex) { alert(ex.message) }
  }

  async function handleDocPick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try { onDocUploaded(await uploadComplianceDocument(lic.id, file)) }
    catch (ex) { alert(ex.message) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

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
          <div>
            <div style={{fontSize:11,color:'var(--n500)',marginBottom:4}}>Document</div>
            {lic.document_url ? (
              <button onClick={viewDocument} style={{fontSize:12,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>View document</button>
            ) : (
              <span style={{fontSize:12,color:'var(--n400)'}}>No document uploaded</span>
            )}
            {canEdit && (
              <label style={{display:'block',fontSize:11,color:'var(--b600)',cursor:uploading?'not-allowed':'pointer',marginTop:6}}>
                {uploading ? 'Uploading…' : lic.document_url ? 'Replace document' : 'Upload document'}
                <input ref={fileRef} type="file" onChange={handleDocPick} disabled={uploading} style={{display:'none'}} />
              </label>
            )}
          </div>
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
  const canEditDoc = can(roleKey, 'compliance:update')
  const [licences, setLicences]       = useState([])
  const [authorities, setAuthorities] = useState([])
  const [sites, setSites]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [selected, setSelected]       = useState(null)
  const [modal, setModal]             = useState(null) // null | 'add' | licence-obj (edit)
  const [filter, setFilter]           = useState('all') // all|active|expiring|expired
  const [tab, setTab]                 = useState('licences')

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
                <p style={{fontSize:12,color:'var(--n500)'}}>Licences and certificates, and the audits that check them</p>
              </div>
              <div style={{flex:1}}/>
              {tab === 'licences' && (
                <>
                  <button onClick={handleRunExpiry} style={{height:32,padding:'0 14px',border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',fontSize:12,color:'var(--n600)',cursor:'pointer'}}>
                    Check Expiry Alerts
                  </button>
                  {canCreate && (
                    <button onClick={() => setModal('add')} style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      Add Licence
                    </button>
                  )}
                </>
              )}
            </div>

            <div style={{display:'flex',marginBottom: tab === 'licences' ? 10 : 0}}>
              {[{k:'licences',l:`Licences (${counts.total})`},{k:'audits',l:'Audits'}].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => { setTab(t.k); setSelected(null) }}>{t.l}</button>
              ))}
            </div>

            {/* Summary strip — licence expiry states, so licences only. */}
            <div style={{display:'flex',gap:8,...(tab === 'licences' ? {} : {display:'none'})}}>
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

          {tab === 'audits' ? (
            <AuditsTab
              canCreate={canCreate}
              canEdit={canEditDoc}
              canRaiseDefect={can(roleKey, 'defect:create')}
              authorities={authorities}
              sites={sites}
            />
          ) : (
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
                canEdit={canEditDoc}
                onDocUploaded={(updated) => { setSelected(updated); setLicences(prev => prev.map(l => l.id === updated.id ? { ...updated, status: l.status } : l)) }}
              />
            )}
          </div>
          )}
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

// ── Audits ────────────────────────────────────────────────────────────────────
// Licences are documents with an expiry date; an audit is someone coming to
// check. The outcome is the whole point, so the API refuses to complete one
// without it and this tab leads with it.

function AuditModal({ onClose, onSaved, authorities, sites }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ title:'', kind:'internal', scheduled_date:today, authority_id:'', site_id:'', auditor:'', scope:'' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim()) return setErr('Give the audit a title.')
    setSaving(true); setErr(null)
    try {
      await createAudit({
        title: form.title.trim(), kind: form.kind, scheduled_date: form.scheduled_date,
        authority_id: form.authority_id || null, site_id: form.site_id || null,
        auditor: form.auditor.trim() || null, scope: form.scope.trim() || null,
      })
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const inp = { height:34, border:'1px solid var(--n200)', borderRadius:4, padding:'0 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', width:'100%', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }
  const lbl = { fontSize:12, fontWeight:500, color:'var(--n800)', display:'flex', flexDirection:'column', gap:4 }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:24,width:480,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>Schedule an audit</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={lbl}>Title *
            <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Annual DPR facility audit" style={inp}/>
          </label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={lbl}>Kind
              <select value={form.kind} onChange={e=>set('kind',e.target.value)} style={{...inp,appearance:'none'}}>
                {AUDIT_KINDS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label style={lbl}>Scheduled date *
              <input type="date" value={form.scheduled_date} onChange={e=>set('scheduled_date',e.target.value)} style={inp}/>
            </label>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={lbl}>Authority
              <select value={form.authority_id} onChange={e=>set('authority_id',e.target.value)} style={{...inp,appearance:'none'}}>
                <option value="">— None —</option>
                {authorities.map(a => <option key={a.id} value={a.id}>{a.code || a.name}</option>)}
              </select>
            </label>
            <label style={lbl}>Site
              <select value={form.site_id} onChange={e=>set('site_id',e.target.value)} style={{...inp,appearance:'none'}}>
                <option value="">— All sites —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <label style={lbl}>Auditor
            <input value={form.auditor} onChange={e=>set('auditor',e.target.value)} placeholder="Often an external firm" style={inp}/>
          </label>
          <label style={lbl}>Scope
            <textarea value={form.scope} onChange={e=>set('scope',e.target.value)} rows={2} style={{...inp,height:'auto',padding:'8px 10px',resize:'vertical'}}/>
          </label>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Schedule'}</button>
        </div>
      </div>
    </div>
  )
}

/** Completing an audit is recording how it went — the outcome is required, and
 * the dialog says what each one means so two people pick the same word. */
function CompleteAuditModal({ audit, onClose, onSaved }) {
  const [outcome, setOutcome] = useState(audit.outcome || (audit.open_finding_count > 0 ? 'pass_with_findings' : 'pass'))
  const [summary, setSummary] = useState(audit.summary || '')
  const [nextDue, setNextDue] = useState(audit.next_due_date || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const HINTS = {
    pass: 'No non-conformities raised.',
    pass_with_findings: 'Compliant overall, with findings to close out.',
    fail: 'Non-compliant — a finding blocks certification or operation.',
    not_applicable: 'The audit did not go ahead, or the scope did not apply.',
  }

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await updateAudit(audit.id, {
        status: 'completed', outcome,
        summary: summary.trim() || null,
        next_due_date: nextDue || null,
      })
      onSaved()
    } catch (e) {
      setErr(e.message === 'outcome_required' ? 'An outcome is required to complete an audit.' : e.message)
      setSaving(false)
    }
  }

  const inp = { width:'100%', border:'1px solid var(--n200)', borderRadius:4, padding:'8px 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }

  return (
    <div style={{position:'fixed',inset:0,zIndex:210,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:24,width:480,maxWidth:'92vw'}}>
        <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)'}}>Complete audit</h2>
        <p style={{fontSize:12,color:'var(--n500)',marginBottom:16}}>{audit.ref} — {audit.title}</p>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}

        <label className="label" style={{display:'block',marginBottom:6}}>Outcome *</label>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
          {AUDIT_OUTCOMES.map(([v,l]) => (
            <button key={v} type="button" onClick={() => setOutcome(v)}
              style={{textAlign:'left',padding:'9px 11px',borderRadius:5,cursor:'pointer',fontFamily:'inherit',
                border:`1px solid ${outcome===v?'var(--b400)':'var(--n200)'}`,
                background: outcome===v?'var(--slb)':'var(--n0)'}}>
              <div style={{fontSize:12.5,fontWeight:600,color:outcome===v?'var(--slt)':'var(--n800)'}}>{l}</div>
              <div style={{fontSize:11,color:'var(--n500)',lineHeight:1.4}}>{HINTS[v]}</div>
            </button>
          ))}
        </div>
        {audit.open_finding_count > 0 && outcome === 'pass' && (
          <p style={{fontSize:11.5,color:'var(--sat)',marginBottom:12,lineHeight:1.5}}>
            This audit has {audit.open_finding_count} open finding{audit.open_finding_count===1?'':'s'} — &ldquo;pass with findings&rdquo; is probably the honest word.
          </p>
        )}

        <label className="label" style={{display:'block',marginBottom:5}}>Summary</label>
        <textarea value={summary} onChange={e=>setSummary(e.target.value)} rows={3} style={{...inp,resize:'vertical',marginBottom:12}}/>
        <label className="label" style={{display:'block',marginBottom:5}}>Next audit due</label>
        <input type="date" value={nextDue} onChange={e=>setNextDue(e.target.value)} style={{...inp,height:34,padding:'0 10px'}}/>

        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Complete'}</button>
        </div>
      </div>
    </div>
  )
}

function AuditsTab({ canCreate, canEdit, canRaiseDefect, authorities, sites }) {
  const nav = useNavigate()
  const [audits, setAudits] = useState([])
  const [stats, setStats] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)
  const [completing, setCompleting] = useState(null)
  const [newFinding, setNewFinding] = useState({ clause:'', description:'', severity:'minor', due_date:'' })
  const [addingFinding, setAddingFinding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [rows, s] = await Promise.all([listAudits(), getAuditStats()])
      setAudits(rows); setStats(s)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const openDetail = async (id) => {
    setDetail({ id, loading:true })
    try { setDetail(await getAudit(id)) } catch { setDetail(null) }
  }

  const addFindingNow = async () => {
    if (!newFinding.description.trim()) return
    await addFinding(detail.id, {
      clause: newFinding.clause.trim() || null,
      description: newFinding.description.trim(),
      severity: newFinding.severity,
      due_date: newFinding.due_date || null,
    })
    setNewFinding({ clause:'', description:'', severity:'minor', due_date:'' })
    setAddingFinding(false)
    openDetail(detail.id); load()
  }

  const toggleFinding = async (f) => {
    await updateFinding(detail.id, f.id, { status: f.status === 'open' ? 'closed' : 'open' })
    openDetail(detail.id); load()
  }

  const raiseDefect = async (f) => {
    try {
      await raiseFindingDefect(detail.id, f.id)
      openDetail(detail.id)
    } catch (e) {
      if (e.message !== 'already_raised') alert(e.message)
    }
  }

  const inp = { width:'100%', border:'1px solid var(--n200)', borderRadius:4, padding:'6px 9px', fontSize:12, fontFamily:'var(--ff-u)', outline:'none', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }

  if (loading) return <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading audits…</div>
  if (err) return <div style={{padding:24}}><div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{err}</div></div>

  return (
    <div style={{flex:1,overflow:'hidden',display:'flex'}}>
      <div style={{flex:1,overflowY:'auto'}}>
        {stats && (
          <div style={{display:'flex',border:'var(--bdr)',borderRadius:6,margin:'16px 24px 0',overflow:'hidden',background:'var(--n0)'}}>
            {[
              ['Upcoming', stats.upcoming, null],
              ['Completed', stats.completed, null],
              ['Failed', stats.failed, stats.failed > 0 ? 'var(--srt)' : null],
              ['Open findings', stats.open_findings, stats.open_findings > 0 ? 'var(--sat)' : null],
              ['Major or critical', stats.serious_findings, stats.serious_findings > 0 ? 'var(--srt)' : null],
            ].map(([label, value, colour]) => (
              <div key={label} style={{padding:'12px 16px',borderRight:'var(--bdr)',flex:1,minWidth:0}}>
                <div style={{fontFamily:'var(--ff-m)',fontSize:20,fontWeight:500,color:colour || 'var(--n900)'}}>{value}</div>
                <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>{label}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 24px 10px'}}>
          <p style={{fontSize:12.5,color:'var(--n600)',lineHeight:1.6,flex:1,maxWidth:640}}>
            An audit is only worth recording if it ends in an outcome. A finding here can be raised onto the
            defect register, where it becomes a work order like any other repair.
          </p>
          {canCreate && (
            <button onClick={() => setModal('add')} className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13,whiteSpace:'nowrap'}}>Schedule audit</button>
          )}
        </div>

        {audits.length === 0 ? (
          <div style={{padding:'48px 24px',textAlign:'center'}}>
            <p style={{fontSize:14,fontWeight:600,color:'var(--n600)',marginBottom:6}}>No audits recorded</p>
            <p style={{fontSize:13,color:'var(--n400)',maxWidth:420,margin:'0 auto 18px',lineHeight:1.6}}>
              Internal reviews, regulator visits and certification bodies all end in a result somebody will
              ask about later.
            </p>
            {canCreate && <button onClick={() => setModal('add')} className="btn btn-primary" style={{height:36,padding:'0 18px',fontSize:13}}>Schedule the first audit</button>}
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                {['Ref','Audit','Kind','Date','Findings','Outcome'].map(h => (
                  <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audits.map(a => (
                <tr key={a.id} className="row-hover" style={{borderBottom:'var(--bdr)',cursor:'pointer',background:detail?.id===a.id?'var(--b50)':'transparent'}} onClick={() => openDetail(a.id)}>
                  <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b700)',whiteSpace:'nowrap'}}>{a.ref}</td>
                  <td style={{padding:'11px 14px'}}>
                    <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{a.title}</div>
                    {a.auditor && <div style={{fontSize:11,color:'var(--n500)'}}>{a.auditor}</div>}
                  </td>
                  <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>
                    {(AUDIT_KINDS.find(([v]) => v === a.kind) || [null,a.kind])[1]}
                  </td>
                  <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)',whiteSpace:'nowrap'}}>{fmtDate(a.completed_date || a.scheduled_date)}</td>
                  <td style={{padding:'11px 14px',fontSize:12,whiteSpace:'nowrap'}}>
                    {a.finding_count === 0
                      ? <span style={{color:'var(--n400)'}}>None</span>
                      : <span style={{color: a.open_finding_count > 0 ? 'var(--sat)' : 'var(--sgt)'}}>{a.open_finding_count} open of {a.finding_count}</span>}
                  </td>
                  <td style={{padding:'11px 14px'}}>
                    {a.outcome
                      ? <span className={`badge ${OUTCOME_CLASS[a.outcome]}`}>{OUTCOME_LABEL[a.outcome]}</span>
                      : <span className="badge badge-n" style={{textTransform:'capitalize'}}>{a.status.replace('_',' ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detail && (
        <div style={{width:390,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
          {detail.loading ? (
            <div style={{padding:24,fontSize:13,color:'var(--n400)'}}>Loading…</div>
          ) : (
            <>
              <div style={{padding:'16px 20px',borderBottom:'var(--bdr)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{minWidth:0}}>
                  <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b600)',marginBottom:2}}>{detail.ref}</div>
                  <div style={{fontFamily:'var(--ff-d)',fontSize:16,fontWeight:700,color:'var(--n950)',letterSpacing:'-.2px'}}>{detail.title}</div>
                </div>
                <button onClick={() => setDetail(null)} style={{width:26,height:26,border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--n500)',flexShrink:0}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                </button>
              </div>

              <div style={{flex:1,overflowY:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {detail.outcome
                    ? <span className={`badge ${OUTCOME_CLASS[detail.outcome]}`}>{OUTCOME_LABEL[detail.outcome]}</span>
                    : <span className="badge badge-n" style={{textTransform:'capitalize'}}>{detail.status.replace('_',' ')}</span>}
                  <span className="badge badge-n">{(AUDIT_KINDS.find(([v]) => v === detail.kind) || [null,detail.kind])[1]}</span>
                </div>

                {detail.summary && (
                  <div style={{background:'var(--n50)',border:'var(--bdr)',borderRadius:6,padding:'12px 14px',fontSize:12.5,color:'var(--n700)',lineHeight:1.55,whiteSpace:'pre-wrap'}}>{detail.summary}</div>
                )}

                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                  <div style={{padding:'10px 14px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Details</div>
                  {[
                    ['Scheduled', fmtDate(detail.scheduled_date)],
                    ['Completed', detail.completed_date ? fmtDate(detail.completed_date) : null],
                    ['Authority', detail.authority?.name],
                    ['Site', detail.site?.name],
                    ['Auditor', detail.auditor],
                    ['Scope', detail.scope],
                    ['Next due', detail.next_due_date ? fmtDate(detail.next_due_date) : null],
                  ].map(([k,v]) => (
                    <div key={k} style={{display:'flex',justifyContent:'space-between',gap:12,padding:'9px 14px',borderBottom:'var(--bdr)',fontSize:12}}>
                      <span style={{color:'var(--n500)',flexShrink:0}}>{k}</span>
                      <span style={{color:'var(--n800)',fontWeight:500,textAlign:'right'}}>{v || '—'}</span>
                    </div>
                  ))}
                </div>

                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                  <div style={{padding:'10px 14px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Findings</span>
                    <div style={{flex:1}}/>
                    {canEdit && !addingFinding && (
                      <button onClick={() => setAddingFinding(true)} style={{fontSize:11.5,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Add</button>
                    )}
                  </div>

                  {(detail.findings || []).length === 0 && !addingFinding && (
                    <div style={{padding:'12px 14px',fontSize:12,color:'var(--n400)'}}>Nothing raised against this audit.</div>
                  )}

                  {(detail.findings || []).map(f => (
                    <div key={f.id} style={{padding:'10px 14px',borderBottom:'var(--bdr)'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
                        <span className={`badge ${FINDING_CLASS[f.severity]}`} style={{flexShrink:0}}>{f.severity}</span>
                        <div style={{flex:1,minWidth:0}}>
                          {f.clause && <div style={{fontFamily:'var(--ff-m)',fontSize:10.5,color:'var(--n500)'}}>{f.clause}</div>}
                          <div style={{fontSize:12.5,color:'var(--n800)',lineHeight:1.5,textDecoration:f.status==='closed'?'line-through':'none',opacity:f.status==='closed'?0.65:1}}>{f.description}</div>
                          {f.due_date && <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>Due {fmtDate(f.due_date)}</div>}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:6,marginTop:7,paddingLeft:4,alignItems:'center',flexWrap:'wrap'}}>
                        {canEdit && (
                          <button onClick={() => toggleFinding(f)} className="btn btn-secondary" style={{height:24,padding:'0 9px',fontSize:11}}>
                            {f.status === 'open' ? 'Close' : 'Reopen'}
                          </button>
                        )}
                        {f.defect
                          ? <button onClick={() => nav('/defects')} style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>
                              {f.defect.ref} on the register
                            </button>
                          : canRaiseDefect && f.status === 'open' && (
                              <button onClick={() => raiseDefect(f)} className="btn btn-secondary" style={{height:24,padding:'0 9px',fontSize:11}}>Raise a defect</button>
                            )}
                      </div>
                    </div>
                  ))}

                  {addingFinding && (
                    <div style={{padding:'10px 14px',display:'flex',flexDirection:'column',gap:7,background:'var(--n50)'}}>
                      <input value={newFinding.clause} onChange={e=>setNewFinding(f=>({...f,clause:e.target.value}))} placeholder="Clause (optional)" style={{...inp,fontFamily:'var(--ff-m)'}}/>
                      <textarea value={newFinding.description} onChange={e=>setNewFinding(f=>({...f,description:e.target.value}))} rows={2} placeholder="What was found" style={{...inp,resize:'vertical'}}/>
                      <div style={{display:'flex',gap:7}}>
                        <select value={newFinding.severity} onChange={e=>setNewFinding(f=>({...f,severity:e.target.value}))} style={{...inp,flex:1}}>
                          {FINDING_SEVERITIES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <input type="date" value={newFinding.due_date} onChange={e=>setNewFinding(f=>({...f,due_date:e.target.value}))} style={{...inp,flex:1}}/>
                      </div>
                      <div style={{display:'flex',gap:6}}>
                        <button onClick={addFindingNow} disabled={!newFinding.description.trim()} className="btn btn-primary" style={{height:28,padding:'0 12px',fontSize:12}}>Add</button>
                        <button onClick={() => setAddingFinding(false)} className="btn btn-secondary" style={{height:28,padding:'0 12px',fontSize:12}}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>

                {canEdit && detail.status !== 'completed' && (
                  <button onClick={() => setCompleting(detail)} className="btn btn-primary" style={{height:36,fontSize:13}}>Complete the audit</button>
                )}
                {canEdit && detail.status === 'completed' && (
                  <button onClick={() => setCompleting(detail)} className="btn btn-secondary" style={{height:34,fontSize:13}}>Change the outcome</button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {modal === 'add' && (
        <AuditModal authorities={authorities} sites={sites}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }}/>
      )}
      {completing && (
        <CompleteAuditModal audit={completing}
          onClose={() => setCompleting(null)}
          onSaved={() => { setCompleting(null); load(); openDetail(completing.id) }}/>
      )}
    </div>
  )
}
