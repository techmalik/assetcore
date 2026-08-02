// The Inspections feature body, extracted from pages/Inspections.jsx so it can
// be mounted twice: as the standalone /inspections page, and as the
// Maintenance page's Inspections tab (which was a "Phase 3 — coming soon"
// placeholder while this exact feature already existed and worked).
//
// The panel owns its own data loading and its own capability gates, so both
// mount points stay in sync without the host threading anything through. It
// reports its counts back via onCounts so a host can badge a tab without
// issuing a second request.
//
// `embedded` only suppresses the page-level title block — the feature itself,
// modals included, is identical in both places. A read-only embed would leave
// a technician looking at an inspection they can't act on and having to be
// told to navigate elsewhere, which is the confusion this replaces.
import { useState, useEffect, useCallback, useRef } from 'react'
import StatusBadge from './StatusBadge.jsx'
import AssignModal, { assignmentSummary } from './AssignModal.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import { listInspections, createInspection, updateInspection, uploadInspectionReport } from '../lib/db/inspections'
import { listSites } from '../lib/db/sites'
import { listOrgUsers } from '../lib/db/orgMembers'
import { api } from '../lib/apiClient'
import { useToast } from '../lib/ToastContext'
import { useLocationFilter } from '../lib/LocationFilterContext'

export const STATUS_META = {
  scheduled:   { label:'Scheduled',   bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)' },
  due:         { label:'Due',          bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  in_progress: { label:'In Progress',  bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  completed:   { label:'Completed',    bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)' },
  overdue:     { label:'Overdue',      bg:'var(--srb)', c:'var(--srt)', br:'var(--srbr)' },
}
export const KIND_META = {
  safety:        { label:'Safety',        c:'var(--srt)' },
  condition:     { label:'Condition',     c:'var(--sat)' },
  integrity:     { label:'Integrity',     c:'var(--sl)'  },
  regulatory:    { label:'Regulatory',   c:'var(--b600)' },
  environmental: { label:'Environmental', c:'var(--sgt)' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })
}

/** An inspection still open past its scheduled date. Drives the tab badge. */
function isOverdue(ins) {
  if (ins.status === 'completed') return false
  if (!ins.scheduled_date) return false
  return new Date(ins.scheduled_date).setHours(0,0,0,0) < new Date().setHours(0,0,0,0)
}

// ── Create Modal ─────────────────────────────────────────────────────────────
function InspectionModal({ onClose, onSaved, sites, users }) {
  const today = new Date().toISOString().slice(0,10)
  const [form, setForm] = useState({ title:'', kind:'condition', scheduled_date:today, site_id:'', inspector_id:'', notes:'' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim())     return setErr('Title is required.')
    if (!form.scheduled_date)   return setErr('Date is required.')
    setSaving(true); setErr(null)
    try {
      await createInspection({
        title:          form.title.trim(),
        kind:           form.kind,
        scheduled_date: form.scheduled_date,
        site_id:        form.site_id || null,
        inspector_id:   form.inspector_id || null,
        notes:          form.notes   || null,
        status:         'scheduled',
      })
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const inp = { height:34, border:'1px solid var(--n200)', borderRadius:4, padding:'0 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', width:'100%', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }
  const lbl = { fontSize:12, fontWeight:500, color:'var(--n800)', display:'flex', flexDirection:'column', gap:4 }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'24px',width:440,maxWidth:'92vw'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>New Inspection</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={lbl}>Title *
            <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. Lagos DS-04 Safety Inspection" style={inp}/>
          </label>
          <div className="form-grid" style={{ gap:10 }}>
            <label style={lbl}>Type
              <select value={form.kind} onChange={e=>set('kind',e.target.value)} style={{...inp,appearance:'none'}}>
                {Object.entries(KIND_META).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </label>
            <label style={lbl}>Scheduled date *
              <input type="date" value={form.scheduled_date} onChange={e=>set('scheduled_date',e.target.value)} style={inp}/>
            </label>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={lbl}>Site
              <select value={form.site_id} onChange={e=>set('site_id',e.target.value)} style={{...inp,appearance:'none'}}>
                <option value="">— Not site-specific —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label style={lbl}>Inspector
              <select value={form.inspector_id} onChange={e=>set('inspector_id',e.target.value)} style={{...inp,appearance:'none'}}>
                <option value="">Unassigned</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </label>
          </div>
          <label style={lbl}>Notes
            <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={2} style={{...inp,height:'auto',padding:'8px 10px',resize:'vertical'}}/>
          </label>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Create Inspection'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Findings Modal ────────────────────────────────────────────────────────────
function FindingsModal({ inspection, onClose, onSaved }) {
  const [findings, setFindings] = useState(inspection.findings || '')
  const [notes, setNotes]       = useState(inspection.notes    || '')
  const [reportFile, setReportFile] = useState(null)
  const [reportUrl] = useState(inspection.report_url || null)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState(null)

  const save = async () => {
    setSaving(true); setErr(null)
    try {
      await updateInspection(inspection.id, { status:'completed', findings, notes })
      if (reportFile) await uploadInspectionReport(inspection.id, reportFile)
      onSaved()
    } catch (e) { setErr(e.message || 'Failed to save.'); setSaving(false) }
  }

  async function viewReport() {
    try { await api.download(`/files/${reportUrl}`, reportUrl.split('/').pop()) } catch (e) { alert(e.message) }
  }

  const inp = { width:'100%', border:'1px solid var(--n200)', borderRadius:4, padding:'8px 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', resize:'vertical', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'24px',width:480,maxWidth:'92vw'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>Complete Inspection</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        <div style={{fontSize:12,color:'var(--n600)',marginBottom:14}}>{inspection.title}</div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:4}}>Findings *
            <textarea value={findings} onChange={e=>setFindings(e.target.value)} rows={4} placeholder="Describe what was observed, measured, or discovered…" style={inp}/>
          </label>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:4}}>Additional notes
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} style={inp}/>
          </label>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:4}}>Inspection report (optional)
            <input type="file" onChange={e=>setReportFile(e.target.files?.[0]||null)} style={{fontSize:12}}/>
            {reportUrl && <button type="button" onClick={viewReport} style={{alignSelf:'flex-start',background:'none',border:'none',color:'var(--b600)',cursor:'pointer',fontSize:12,padding:0}}>View uploaded report</button>}
          </label>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginTop:12}}>{err}</div>}
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving||!findings.trim()} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Mark Complete'}</button>
        </div>
      </div>
    </div>
  )
}

export default function InspectionsPanel({ embedded = false, selectedId = null, onCounts = null }) {
  const toast = useToast()
  const { roleKey, extraCaps, user } = useAuth()
  // POST /inspections is gated on inspection:create (not wo:create), and
  // per-user grants count as much as the role baseline — extraCaps is passed
  // so a capability granted in Admin -> Access settings actually surfaces the
  // button the API would already accept.
  const canCreate   = can(roleKey, 'inspection:create', extraCaps)
  const canReassign = can(roleKey, 'inspection:update', extraCaps)
  const { locationId: globalLocationId, setLocationId: setGlobalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)
  const [inspections, setInspections] = useState([])
  const [sites, setSites]             = useState([])
  const [users, setUsers]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [modal, setModal]             = useState(null) // null|'create'|inspection-obj
  const [assigning, setAssigning]     = useState(null)
  const [tab, setTab]                 = useState('open')
  const [mineOnly, setMineOnly]       = useState(false)
  const selectedRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [insp, siteList, userList] = await Promise.all([
        listInspections({ locationId: globalLocationId }), listSites(), listOrgUsers().catch(() => []),
      ])
      setInspections(insp)
      setSites(siteList)
      setUsers(userList)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [globalLocationId])

  useEffect(() => { load() }, [load])

  // Report counts up so a host (the Maintenance tab strip) can badge without
  // re-fetching the same list.
  useEffect(() => {
    if (!onCounts) return
    onCounts({
      total: inspections.length,
      open: inspections.filter(i => i.status !== 'completed').length,
      overdue: inspections.filter(isOverdue).length,
    })
  }, [inspections, onCounts])

  // Deep-link landing (?id=): show the tab that actually contains the target,
  // then scroll it into view.
  useEffect(() => {
    if (!selectedId || !inspections.length) return
    const target = inspections.find(i => i.id === selectedId)
    if (!target) return
    setTab(target.status === 'completed' ? 'closed' : 'open')
    setMineOnly(false)
  }, [selectedId, inspections])

  useEffect(() => {
    if (selectedId && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'center' })
    }
  }, [selectedId, tab, loading])

  async function saveAssignment(inspectionId, inspectorId) {
    await updateInspection(inspectionId, { inspector_id: inspectorId })
    setAssigning(null)
    toast.success(inspectorId ? 'Inspector assigned.' : 'Inspector unassigned.')
    load()
  }

  const mineFiltered = mineOnly ? inspections.filter(i => i.inspector_id === user?.id) : inspections
  const open   = mineFiltered.filter(i => i.status !== 'completed')
  const closed = mineFiltered.filter(i => i.status === 'completed')
  const shown  = tab === 'open' ? open : closed

  return (
    <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding: embedded ? '10px 24px 0' : '14px 24px 0', borderBottom:'var(--bdr)', background:'var(--n0)', flexShrink:0}}>
        {!embedded && (
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
            <div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Inspections</h1>
              <p style={{fontSize:12,color:'var(--n500)'}}>Safety, condition, integrity &amp; regulatory inspections</p>
            </div>
            <div style={{flex:1}}/>
            {canCreate && (
              <button onClick={() => setModal('create')} className="row-action" style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',borderRadius:4,fontSize:13,fontWeight:500,gap:6}}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                New Inspection
              </button>
            )}
          </div>
        )}
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{display:'flex',gap:0}}>
            {[
              { k:'open',   label:`Open (${open.length})`     },
              { k:'closed', label:`Completed (${closed.length})` },
            ].map(t => (
              <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
            ))}
          </div>
          <button onClick={() => setMineOnly(m => !m)}
            style={{height:26,padding:'0 10px',marginBottom:8,border:`1px solid ${mineOnly?'var(--b300)':'var(--n200)'}`,borderRadius:99,background:mineOnly?'var(--b50)':'var(--n0)',fontSize:11,fontWeight:mineOnly?600:400,color:mineOnly?'var(--b700)':'var(--n600)',cursor:'pointer'}}>
            Assigned to me
          </button>
          {embedded && canCreate && (
            <>
              <div style={{flex:1}}/>
              <button onClick={() => setModal('create')} className="row-action" style={{height:28,padding:'0 12px',marginBottom:8,background:'var(--b500)',color:'#fff',borderRadius:4,fontSize:12,fontWeight:500,gap:6}}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                New Inspection
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto'}}>
        {loading ? (
          <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
        ) : err ? (
          <div style={{padding:24}}>
            <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{err.includes('does not exist') ? 'Inspection data unavailable — ensure all database migrations have been applied (npm run migrate).' : err}</div>
          </div>
        ) : shown.length === 0 ? (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',gap:12,textAlign:'center'}}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="var(--n300)" strokeWidth="1.4"/><path d="M8 9h8M8 13h5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/><path d="M16 16l1.5 1.5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/><circle cx="15" cy="15" r="2" stroke="var(--n300)" strokeWidth="1.4"/></svg>
            <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>
              {globalLocation ? `No ${tab==='open'?'open':'completed'} inspections in ${globalLocation.name}` : tab==='open' ? 'No open inspections' : 'No completed inspections'}
            </div>
            {globalLocation ? (
              <button onClick={() => setGlobalLocationId(null)} className="btn btn-secondary" style={{marginTop:8,height:34,padding:'0 16px',fontSize:13}}>Show all locations</button>
            ) : tab==='open' && canCreate && <button onClick={() => setModal('create')} className="btn btn-primary" style={{marginTop:8,height:34,padding:'0 16px',fontSize:13}}>Schedule first inspection</button>}
          </div>
        ) : (
          <div className="table-scroll"><table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead style={{position:'sticky',top:0,zIndex:10}}>
              <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                {['Title','Type','Asset','Site','Date','Inspector','Status',''].map(h => (
                  <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(ins => {
                const sm = STATUS_META[ins.status] || STATUS_META.scheduled
                const km = KIND_META[ins.kind] || KIND_META.condition
                const isTarget = selectedId === ins.id
                return (
                  <tr key={ins.id} ref={isTarget ? selectedRef : null} className="row-hover"
                    style={{borderBottom:'var(--bdr)', background: isTarget ? 'var(--b50)' : undefined, boxShadow: isTarget ? 'inset 3px 0 0 var(--b500)' : undefined}}>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--n900)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ins.title}</div>
                      {ins.findings && <div style={{fontSize:11,color:'var(--n500)',marginTop:2,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ins.findings}</div>}
                    </td>
                    <td style={{padding:'11px 14px',whiteSpace:'nowrap'}}>
                      <span style={{fontSize:11,fontWeight:500,color:km.c}}>{km.label}</span>
                    </td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{ins.asset?.ain || '—'}</td>
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{ins.site?.name || '—'}</td>
                    <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)',whiteSpace:'nowrap'}}>
                      {fmtDate(ins.completed_date || ins.scheduled_date)}
                    </td>
                    {/* Second line rather than a new column — inspections have
                        no detail view to put the assigner in. */}
                    <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>
                      <div>{ins.inspector?.full_name || '—'}</div>
                      {ins.assigner?.full_name && (
                        <div style={{fontSize:10,color:'var(--n400)'}}>
                          by {ins.assigner.full_name}{ins.assigned_at ? `, ${fmtDate(ins.assigned_at)}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <StatusBadge tone={sm} />
                    </td>
                    <td style={{padding:'11px 14px'}}>
                      <div style={{display:'flex',gap:10,whiteSpace:'nowrap'}}>
                        {ins.status !== 'completed' && (
                          <button onClick={() => setModal(ins)} style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Complete</button>
                        )}
                        {ins.status !== 'completed' && canReassign && (
                          <button onClick={() => setAssigning(ins)} style={{fontSize:11,color:'var(--n500)',background:'none',border:'none',cursor:'pointer',padding:0}}>
                            {ins.inspector ? 'Reassign' : 'Assign'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        )}
      </div>

      {modal === 'create' && (
        <InspectionModal sites={sites} users={users} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }}/>
      )}
      {modal && modal !== 'create' && (
        <FindingsModal inspection={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }}/>
      )}
      {assigning && (
        <AssignModal title="Assign inspector" subtitle={assigning.title} users={users} currentId={assigning.inspector_id}
          current={assignmentSummary({ assignee: assigning.inspector, assigner: assigning.assigner, assignedAt: assigning.assigned_at })}
          onClose={() => setAssigning(null)} onSave={(userId) => saveAssignment(assigning.id, userId)}/>
      )}
    </div>
  )
}
