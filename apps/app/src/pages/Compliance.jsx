import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import {
  listComplianceLicences, createComplianceLicence, updateComplianceLicence,
  softDeleteComplianceLicence, listAuthorities, checkLicenceExpiry,
  licenceStatus, daysUntilExpiry, uploadComplianceDocument, deleteComplianceDocument,
  listComplianceAudits, createComplianceAudit, updateComplianceAudit, softDeleteComplianceAudit, uploadAuditDocument,
  getPmCompliance,
} from '../lib/db/complianceLicences'
import { listSites } from '../lib/db/sites'
import { listOrgUsers } from '../lib/db/orgMembers'
import { listAssets } from '../lib/db/assets'
import { api } from '../lib/apiClient'

const STATUS_META = {
  active:   { label:'Active',        bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)' },
  due_soon: { label:'Due Soon',      bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)' },
  expiring: { label:'Expiring',      bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  expired:  { label:'Expired',       bg:'var(--srb)', c:'var(--srt)', br:'var(--srbr)' },
}

const KIND_LABEL = { licence: 'Licence', permit: 'Permit', certificate: 'Certificate', iso_certificate: 'ISO Certificate' }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })
}

// A "relation ... does not exist" error means a migration hasn't been
// applied yet — give an accurate, generic pointer instead of naming a
// specific migration file (which drifts as new ones are added and, in the
// case this replaces, was already wrong — it said 0004_phase3.sql, a file
// that has never existed in this repo).
function loadErrorMessage(err) {
  if (!err) return null
  if (err.includes('does not exist')) return 'Compliance data unavailable — ensure all database migrations have been applied (npm run migrate).'
  return err
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
    kind:           licence?.kind           || 'licence',
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
        kind:           form.kind,
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
            <label style={labelStyle}>Type
              <select value={form.kind} onChange={e=>set('kind',e.target.value)} style={selectStyle}>
                {Object.entries(KIND_LABEL).map(([k,l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Reference / certificate no.
              <input value={form.licence_number} onChange={e=>set('licence_number',e.target.value)} placeholder="e.g. ISO-9001-2024-001" style={inputStyle}/>
            </label>
          </div>
          <label style={labelStyle}>Regulatory authority
            <select value={form.authority_id} onChange={e=>set('authority_id',e.target.value)} style={selectStyle}>
              <option value="">— Select —</option>
              {authorities.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name.slice(0,30)}</option>)}
            </select>
          </label>
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

  async function removeDoc(url) {
    try { onDocUploaded(await deleteComplianceDocument(lic.id, url)) } catch (ex) { alert(ex.message) }
  }

  const docList = lic.documents?.length ? lic.documents : (lic.document_url ? [{ url: lic.document_url, name: lic.document_url.split('/').pop() }] : [])

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
            <div style={{fontSize:11,color:'var(--n500)',marginBottom:4}}>Documents</div>
            {docList.length === 0 ? (
              <span style={{fontSize:12,color:'var(--n400)'}}>No documents uploaded</span>
            ) : docList.map((d, i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                <button onClick={() => api.download(`/files/${d.url}`, d.name)} style={{fontSize:12,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0,flex:1,textAlign:'left',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>📄 {d.name}</button>
                {canEdit && lic.documents?.length > 0 && <button onClick={() => removeDoc(d.url)} title="Remove" style={{fontSize:13,color:'var(--srt)',background:'none',border:'none',cursor:'pointer',padding:0}}>×</button>}
              </div>
            ))}
            {canEdit && (
              <label style={{display:'block',fontSize:11,color:'var(--b600)',cursor:uploading?'not-allowed':'pointer',marginTop:6}}>
                {uploading ? 'Uploading…' : '+ Add document'}
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

// ── Audit attestations ────────────────────────────────────────────────────────
function YesNo({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[['Yes', true], ['No', false], ['N/A', null]].map(([l, v]) => (
        <button key={l} type="button" onClick={() => onChange(v)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${value === v ? 'var(--b300)' : 'var(--n200)'}`, background: value === v ? 'var(--b50)' : 'var(--n0)', color: value === v ? 'var(--b700)' : 'var(--n600)' }}>{l}</button>
      ))}
    </div>
  )
}

function AuditModal({ audit, sites, users, assets, onClose, onSaved }) {
  const editing = Boolean(audit)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    title: audit?.title || '', standard: audit?.standard || '', iso_reference: audit?.iso_reference || '',
    audit_date: audit?.audit_date || today, site_id: audit?.site_id || '', auditor_id: audit?.auditor_id || '',
    asset_id: audit?.asset_id || '',
    routine_maintenance_complied: audit?.routine_maintenance_complied ?? null,
    iso_audit_conducted: audit?.iso_audit_conducted ?? null,
    notes: audit?.notes || '',
  })
  const [reportFile, setReportFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.title.trim()) return setErr('Title is required.')
    if (!form.audit_date) return setErr('Audit date is required.')
    setSaving(true); setErr(null)
    try {
      const payload = {
        title: form.title.trim(), standard: form.standard || null, iso_reference: form.iso_reference || null,
        audit_date: form.audit_date, site_id: form.site_id || null, auditor_id: form.auditor_id || null,
        asset_id: form.asset_id || null,
        routine_maintenance_complied: form.routine_maintenance_complied, iso_audit_conducted: form.iso_audit_conducted, notes: form.notes || null,
      }
      const saved = editing ? await updateComplianceAudit(audit.id, payload) : await createComplianceAudit(payload)
      if (reportFile) await uploadAuditDocument(saved?.id || audit.id, reportFile)
      onSaved()
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  const labelStyle = { fontSize: 12, fontWeight: 500, color: 'var(--n800)', display: 'flex', flexDirection: 'column', gap: 4 }
  const inputStyle = { height: 34, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: 'var(--n0)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box' }
  const selectStyle = { ...inputStyle, appearance: 'none' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)' }}>
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: 24, width: 500, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', flex: 1 }}>{editing ? 'Edit Audit' : 'New Audit'}</h2>
          <button onClick={onClose} style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--n500)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        {err && <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>Title *
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Q2 ISO 9001 Internal Audit — Lagos DS-04" style={inputStyle} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={labelStyle}>Standard
              <input value={form.standard} onChange={(e) => set('standard', e.target.value)} placeholder="e.g. ISO 9001" style={inputStyle} />
            </label>
            <label style={labelStyle}>ISO certificate reference
              <input value={form.iso_reference} onChange={(e) => set('iso_reference', e.target.value)} placeholder="e.g. ISO-9001-2024-001" style={inputStyle} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={labelStyle}>Audit date *
              <input type="date" value={form.audit_date} onChange={(e) => set('audit_date', e.target.value)} style={inputStyle} />
            </label>
            <label style={labelStyle}>Site
              <select value={form.site_id} onChange={(e) => set('site_id', e.target.value)} style={selectStyle}>
                <option value="">— Not site-specific —</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={labelStyle}>Auditor
              <select value={form.auditor_id} onChange={(e) => set('auditor_id', e.target.value)} style={selectStyle}>
                <option value="">— Select —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Asset
              <select value={form.asset_id} onChange={(e) => set('asset_id', e.target.value)} style={selectStyle}>
                <option value="">— Not asset-specific —</option>
                {(assets || []).map((a) => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--n800)', marginBottom: 6 }}>Did you comply with routine maintenance?</div>
              <YesNo value={form.routine_maintenance_complied} onChange={(v) => set('routine_maintenance_complied', v)} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--n800)', marginBottom: 6 }}>Do you carry out audit as stated in the ISO standard?</div>
              <YesNo value={form.iso_audit_conducted} onChange={(v) => set('iso_audit_conducted', v)} />
            </div>
          </div>
          <label style={labelStyle}>Notes
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical' }} />
          </label>
          <label style={labelStyle}>Certificate / report document
            <input type="file" onChange={(e) => setReportFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
            {audit?.document_url && <button type="button" onClick={() => api.download(`/files/${audit.document_url}`, audit.document_url.split('/').pop())} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 12, padding: 0 }}>View current document</button>}
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ height: 34, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Save Audit'}</button>
        </div>
      </div>
    </div>
  )
}

function AuditsPanel({ canCreate }) {
  const [audits, setAudits] = useState([])
  const [sites, setSites] = useState([])
  const [users, setUsers] = useState([])
  const [assets, setAssets] = useState([])
  const [pmCompliance, setPmCompliance] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [a, s, u, as, pm] = await Promise.all([
        listComplianceAudits(), listSites(), listOrgUsers().catch(() => []),
        listAssets().catch(() => []), getPmCompliance().catch(() => null),
      ])
      setAudits(a); setSites(s); setUsers(u); setAssets(as); setPmCompliance(pm)
    } catch (e) { setErr(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function remove(id) {
    if (!confirm('Archive this audit record?')) return
    try { await softDeleteComplianceAudit(id); load() } catch (e) { alert(e.message) }
  }
  const yn = (v) => v === true ? <span style={{ color: 'var(--sgt)' }}>Yes</span> : v === false ? <span style={{ color: 'var(--srt)' }}>No</span> : <span style={{ color: 'var(--n400)' }}>—</span>

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--n600)' }}>Routine-maintenance & ISO audit attestations</div>
        <div style={{ flex: 1 }} />
        {pmCompliance && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginRight: 16, padding: '4px 12px', background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--n600)' }}>PM compliance (12 mo):</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: pmCompliance.rate == null ? 'var(--n400)' : pmCompliance.rate >= 80 ? 'var(--sgt)' : pmCompliance.rate >= 50 ? 'var(--sat)' : 'var(--srt)' }}>
              {pmCompliance.rate == null ? '—' : `${pmCompliance.rate}%`}
            </span>
            <span style={{ fontSize: 11, color: 'var(--n500)' }}>on-time ({pmCompliance.onTime}/{pmCompliance.total})</span>
          </div>
        )}
        {canCreate && <button onClick={() => setModal('new')} className="btn btn-primary" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>+ New Audit</button>}
      </div>
      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading…</div>
      ) : err ? (
        <div style={{ padding: 24 }}>
          <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{loadErrorMessage(err)}</div>
        </div>
      ) : audits.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>No audits recorded yet.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
              {['Audit', 'Standard / Ref', 'Date', 'Routine maint.', 'ISO audit', 'Site', 'Asset', 'Doc', ''].map((h) => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id} style={{ borderBottom: 'var(--bdr)' }}>
                <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{a.title}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n700)' }}>{[a.standard, a.iso_reference].filter(Boolean).join(' · ') || '—'}</td>
                <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{fmtDate(a.audit_date)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{yn(a.routine_maintenance_complied)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{yn(a.iso_audit_conducted)}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)' }}>{a.site?.name || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)' }}>{a.asset?.name || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>{a.document_url ? <button onClick={() => api.download(`/files/${a.document_url}`, a.document_url.split('/').pop())} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 12, padding: 0 }}>view</button> : '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setModal(a)} style={{ fontSize: 11, color: 'var(--b600)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Edit</button>
                    <button onClick={() => remove(a.id)} style={{ fontSize: 11, color: 'var(--srt)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Archive</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {modal && <AuditModal audit={modal === 'new' ? null : modal} sites={sites} users={users} assets={assets} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Compliance({ dark, toggleDark }) {
  const { roleKey, extraCaps } = useAuth()
  const canCreate = can(roleKey, 'wo:create', extraCaps) // ops_manager+
  const canAudit = can(roleKey, 'compliance:create', extraCaps)
  const canEditDoc = can(roleKey, 'compliance:update', extraCaps)
  const [searchParams] = useSearchParams()
  const [view, setView] = useState(searchParams.get('view') === 'audits' ? 'audits' : 'licences') // 'licences' | 'audits'
  const [licences, setLicences]       = useState([])
  const [authorities, setAuthorities] = useState([])
  const [sites, setSites]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [selected, setSelected]       = useState(null)
  const [modal, setModal]             = useState(null) // null | 'add' | licence-obj (edit)
  // 'alerts' is a client-side pseudo-filter (expiring + due_soon + expired
  // combined) matching the dashboard's "Compliance Alerts" KPI definition.
  const [filter, setFilter]           = useState(searchParams.get('filter') || 'all') // all|active|expiring|expired|alerts

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
    if (filter === 'alerts') return l.status === 'expiring' || l.status === 'due_soon' || l.status === 'expired'
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
              {view === 'licences' && (
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

            {/* View tabs */}
            <div style={{display:'flex',gap:0,marginBottom: view === 'licences' ? 12 : 0}}>
              {[['licences','Licences & Certificates'],['audits','Audits & Attestations']].map(([k,l]) => (
                <button key={k} onClick={() => setView(k)} className={`tab-btn${view===k?' active':''}`}>{l}</button>
              ))}
            </div>

            {/* Summary strip */}
            {view === 'licences' && (
              <div style={{display:'flex',gap:8}}>
                {[
                  { key:'all',      label:`All (${counts.total})`,          c:'var(--n700)',  bg:'var(--n100)', br:'var(--n200)' },
                  { key:'active',   label:`Active (${counts.active + counts.due_soon})`, c:'var(--sgt)', bg:'var(--sgb)', br:'var(--sgbr)' },
                  { key:'expiring', label:`Expiring (${counts.expiring + counts.due_soon})`, c:'var(--sat)', bg:'var(--sab)', br:'var(--sabr)' },
                  { key:'expired',  label:`Expired (${counts.expired})`,    c:'var(--srt)',  bg:'var(--srb)', br:'var(--srbr)' },
                  { key:'alerts',   label:`Alerts (${counts.expiring + counts.due_soon + counts.expired})`, c:'var(--srt)', bg:'var(--srb)', br:'var(--srbr)' },
                ].map(s => (
                  <button key={s.key} onClick={() => setFilter(s.key)} style={{height:28,padding:'0 12px',border:`1px solid ${filter===s.key?s.br:'var(--n200)'}`,borderRadius:4,background:filter===s.key?s.bg:'var(--n0)',fontSize:12,fontWeight:filter===s.key?600:400,color:filter===s.key?s.c:'var(--n600)',cursor:'pointer'}}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === 'audits' ? <AuditsPanel canCreate={canAudit} /> : (
          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {/* Table */}
            <div style={{flex:1,overflowY:'auto'}}>
              {loading ? (
                <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
              ) : err ? (
                <div style={{padding:24}}>
                  <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{loadErrorMessage(err)}</div>
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
                            <div style={{fontSize:13,fontWeight:500,color:'var(--n900)',display:'flex',alignItems:'center',gap:6}}>
                              {lic.name}
                              {lic.kind && lic.kind !== 'licence' && <span style={{fontSize:9,fontWeight:600,color:'var(--b600)',background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:3,padding:'1px 5px',textTransform:'uppercase',whiteSpace:'nowrap'}}>{KIND_LABEL[lic.kind]}</span>}
                            </div>
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
