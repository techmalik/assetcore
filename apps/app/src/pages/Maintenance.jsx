import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listPMSchedules, createPMSchedule, softDeletePMSchedule } from '../lib/db/pmSchedules'
import { listPMTasks, updatePMTask, generatePMTasks } from '../lib/db/pmTasks'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'

const TASK_STATUS = {
  pending:     { bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)', label:'Pending' },
  in_progress: { bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)', label:'In Progress' },
  completed:   { bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)', label:'Complete' },
  overdue:     { bg:'var(--srb)', c:'var(--srt)', br:'var(--srbr)', label:'Overdue' },
  skipped:     { bg:'var(--n100)', c:'var(--n500)', br:'var(--n200)', label:'Skipped' },
}
const FREQ_LABEL = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', quarterly:'Quarterly', semi_annual:'Semi-annual', annual:'Annual' }
const PRIORITY_COLOR = { critical:'var(--srt)', high:'var(--sat)', medium:'var(--n600)', low:'var(--sgt)' }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'2-digit'})
}
function isoToday() { return new Date().toISOString().slice(0,10) }
function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10) }

function weekDays(refDate) {
  const ref = new Date(refDate)
  const mon = new Date(ref); mon.setDate(ref.getDate() - ((ref.getDay()+6)%7))
  return Array.from({length:7},(_,i) => { const d=new Date(mon); d.setDate(mon.getDate()+i); return d })
}

// ── Schedule Modal ────────────────────────────────────────────────────────────
function ScheduleModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ title:'', frequency:'monthly', next_due:isoToday() })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  const save = async () => {
    if (!form.title.trim()) return setErr('Title is required.')
    setSaving(true); setErr(null)
    try {
      await createPMSchedule({ title:form.title.trim(), frequency:form.frequency, next_due:form.next_due, description:form.description||null })
      onSaved()
    } catch(e) { setErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'24px',width:420,maxWidth:'90vw'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>New PM Schedule</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>Title *
            <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. Quarterly Calibration — MTR-0042" style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',boxSizing:'border-box'}}/>
          </label>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>Description
            <textarea value={form.description||''} onChange={e=>set('description',e.target.value)} rows={2} style={{marginTop:4,width:'100%',border:'1px solid var(--n200)',borderRadius:4,padding:'8px 10px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',resize:'vertical',boxSizing:'border-box'}}/>
          </label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>Frequency *
              <select value={form.frequency} onChange={e=>set('frequency',e.target.value)} style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 8px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',background:'var(--n0)'}}>
                {Object.entries(FREQ_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>First due *
              <input type="date" value={form.next_due} onChange={e=>set('next_due',e.target.value)} style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',boxSizing:'border-box'}}/>
            </label>
          </div>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Save Schedule'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Compliance tab (Phase 3 stub) ─────────────────────────────────────────────
const compliance = [
  {id:'LIC-001',name:'Operating Licence — Lagos DS-04',issuer:'NMDPRA',issued:'15 Jan 24',expires:'14 Jan 26',status:'Active',site:'Lagos DS-04',days:385},
  {id:'LIC-002',name:'Environmental Permit — Delta CS',issuer:'NESREA',issued:'1 Mar 23',expires:'28 Feb 26',status:'Active',site:'Delta CS',days:430},
  {id:'LIC-003',name:'Pressure Vessel Certificate — CMP-0017',issuer:'NSC',issued:'10 Oct 24',expires:'9 Jan 25',status:'Expired',site:'Delta CS',days:-5},
  {id:'LIC-004',name:'Fire Safety Certificate — Warri Terminal A',issuer:'NSCDC',issued:'5 Aug 24',expires:'20 Jan 25',status:'Expiring',site:'Warri Terminal A',days:6},
  {id:'LIC-005',name:'Metering Certification — MTR-0042',issuer:'NMI',issued:'14 Jan 24',expires:'13 Jul 25',status:'Active',site:'Lagos DS-04',days:180},
  {id:'LIC-006',name:'Pipeline Operating Certificate — PIP-0312',issuer:'NMDPRA',issued:'2 Feb 23',expires:'1 Feb 26',status:'Active',site:'Aba Network',days:383},
  {id:'LIC-007',name:'ESD System Certificate — Lagos',issuer:'NSC',issued:'20 Jun 24',expires:'19 Jun 26',status:'Active',site:'Lagos DS-04',days:521},
]
const licStatus = {Active:{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},Expiring:{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},Expired:{bg:'var(--srb)',c:'var(--srt)',br:'var(--srbr)'}}

export default function Maintenance({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'wo:create')

  const [tab, setTab] = useState('pm')
  const [tasks, setTasks] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const today = isoToday()
  const weekStart = weekDays(today)[0].toISOString().slice(0,10)
  const weekEnd   = weekDays(today)[6].toISOString().slice(0,10)

  const load = useCallback(async () => {
    if (tab !== 'pm') return
    setLoading(true); setErr(null)
    try {
      const [t, s] = await Promise.all([
        listPMTasks({ statuses:['pending','in_progress','overdue'], dueBefore: addDays(today,30) }),
        listPMSchedules(),
      ])
      setTasks(t)
      setSchedules(s)
    } catch(e) {
      setErr(e.message)
    } finally { setLoading(false) }
  }, [tab, today])

  useEffect(() => { load() }, [load])

  const handleGenerate = async () => {
    setGenerating(true)
    try { await generatePMTasks(); await load() } catch { /* ignore */ } finally { setGenerating(false) }
  }

  const handleComplete = async (taskId) => {
    try {
      await updatePMTask(taskId, { status:'completed' })
      setTasks(prev => prev.filter(t => t.id !== taskId))
    } catch { /* ignore */ }
  }

  const weekTaskMap = {}
  for (const t of tasks) {
    const d = t.due_date
    if (d >= weekStart && d <= weekEnd) {
      if (!weekTaskMap[d]) weekTaskMap[d] = []
      weekTaskMap[d].push(t)
    }
  }

  const overdue = tasks.filter(t => t.status === 'overdue').length

  return (
    <div className="app-shell">
      <Sidebar active="maintenance"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Maintenance" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Maintenance</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Preventive maintenance, inspections & compliance</p>
              </div>
              <div style={{flex:1}}/>
              {tab === 'pm' && (
                <>
                  <button onClick={handleGenerate} disabled={generating} style={{height:32,padding:'0 14px',background:'var(--n0)',color:'var(--n700)',border:'1px solid var(--n200)',borderRadius:4,fontSize:13,cursor:'pointer'}}>
                    {generating?'Generating…':'Generate Tasks'}
                  </button>
                  {canCreate && (
                    <button onClick={() => setShowModal(true)} style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      Schedule PM
                    </button>
                  )}
                </>
              )}
            </div>
            <div style={{display:'flex',gap:0}}>
              {[
                {k:'pm',label:'Preventive Maintenance', badge: overdue > 0 ? overdue : null},
                {k:'inspections',label:'Inspections'},
                {k:'compliance',label:'Compliance',badge:'7'},
              ].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)} style={{display:'flex',alignItems:'center',gap:6}}>
                  {t.label}
                  {t.badge && <span style={{background:'var(--srb)',color:'var(--srt)',border:'1px solid var(--srbr)',borderRadius:2,fontSize:9,fontWeight:600,padding:'0 5px',lineHeight:'16px'}}>{t.badge}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {tab === 'pm' && (
              <>
                <div style={{flex:1,overflowY:'auto'}}>
                  {loading ? (
                    <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
                  ) : err ? (
                    <div style={{padding:24}}>
                      <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>
                        {err.includes('does not exist') ? 'PM tables not yet created. Run migration 0003_phase2.sql then `supabase db reset`.' : err}
                      </div>
                      {schedules.length === 0 && tasks.length === 0 && !err && (
                        <EmptyPM onSchedule={() => setShowModal(true)} canCreate={canCreate} />
                      )}
                    </div>
                  ) : tasks.length === 0 && schedules.length === 0 ? (
                    <EmptyPM onSchedule={() => setShowModal(true)} canCreate={canCreate} />
                  ) : tasks.length === 0 ? (
                    <SchedulesView schedules={schedules} />
                  ) : (
                    <TasksTable tasks={tasks} onComplete={handleComplete} />
                  )}
                </div>

                <div style={{width:300,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
                  <div style={{padding:'14px 16px',borderBottom:'var(--bdr)'}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>
                      {new Date(weekStart).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – {new Date(weekEnd).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                    </div>
                    <div style={{fontSize:11,color:'var(--n500)'}}>This week's PM tasks</div>
                  </div>
                  <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                    {weekDays(today).map(day => {
                      const iso = day.toISOString().slice(0,10)
                      const dayTasks = weekTaskMap[iso] || []
                      const isToday = iso === today
                      return (
                        <div key={iso} style={{padding:'8px 14px',borderBottom:'var(--bdr)',background:isToday?'var(--b50)':'transparent'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:dayTasks.length?6:0}}>
                            <div style={{width:24,height:24,borderRadius:'50%',background:isToday?'var(--b500)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:isToday?600:400,color:isToday?'#fff':'var(--n700)'}}>{day.getDate()}</div>
                            <span style={{fontSize:11,color:isToday?'var(--b700)':'var(--n500)',fontWeight:isToday?600:400}}>
                              {day.toLocaleDateString('en-GB',{weekday:'short'})}
                            </span>
                            {dayTasks.length > 0 && <span style={{marginLeft:'auto',fontSize:10,color:'var(--n400)'}}>{dayTasks.length} task{dayTasks.length>1?'s':''}</span>}
                          </div>
                          {dayTasks.map((t,i) => {
                            const sc = TASK_STATUS[t.status] || TASK_STATUS.pending
                            return (
                              <div key={i} style={{marginLeft:32,marginBottom:4,padding:'4px 8px',background:'var(--n50)',borderRadius:3,borderLeft:`2px solid ${sc.c}`,fontSize:11,color:'var(--n700)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                {t.title}
                              </div>
                            )
                          })}
                          {dayTasks.length === 0 && <div style={{marginLeft:32,fontSize:11,color:'var(--n300)'}}>No tasks</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {tab === 'inspections' && (
              <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,padding:40}}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="var(--n300)" strokeWidth="1.4"/><path d="M8 9h8M8 13h5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/><path d="M16 16l1.5 1.5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/><circle cx="15" cy="15" r="2" stroke="var(--n300)" strokeWidth="1.4"/></svg>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>Inspections — Phase 3</div>
                <div style={{fontSize:13,color:'var(--n500)',textAlign:'center',maxWidth:340}}>Inspection checklists, findings, and photo evidence capture are coming in Phase 3. Field technicians will run digital checklists against regulatory and safety requirements.</div>
              </div>
            )}

            {tab === 'compliance' && (
              <div style={{flex:1,overflowY:'auto'}}>
                <div style={{padding:'14px 24px',borderBottom:'var(--bdr)',background:'var(--n0)',display:'flex',gap:20}}>
                  {[
                    {label:'Active',count:5,c:'var(--sgt)',bg:'var(--sgb)',br:'var(--sgbr)'},
                    {label:'Expiring Soon',count:1,c:'var(--sat)',bg:'var(--sab)',br:'var(--sabr)'},
                    {label:'Expired',count:1,c:'var(--srt)',bg:'var(--srb)',br:'var(--srbr)'},
                  ].map(s => (
                    <div key={s.label} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:s.bg,border:`1px solid ${s.br}`,borderRadius:4}}>
                      <span style={{fontSize:16,fontWeight:700,color:s.c,fontFamily:'var(--ff-m)'}}>{s.count}</span>
                      <span style={{fontSize:12,color:s.c}}>{s.label}</span>
                    </div>
                  ))}
                  <div style={{marginLeft:'auto',fontSize:11,color:'var(--n400)',display:'flex',alignItems:'center'}}>Phase 3: live licence register coming soon</div>
                </div>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,zIndex:10}}>
                    <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                      {['ID','Certificate / Licence','Issuer','Site','Issued','Expires','Days','Status',''].map(h => (
                        <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compliance.map(lic => (
                      <tr key={lic.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{lic.id}</td>
                        <td style={{padding:'11px 14px'}}><div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{lic.name}</div></td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{lic.issuer}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{lic.site}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{lic.issued}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:lic.status==='Expired'?'var(--srt)':lic.status==='Expiring'?'var(--sat)':'var(--n600)',whiteSpace:'nowrap'}}>{lic.expires}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:lic.days<0?'var(--srt)':lic.days<30?'var(--sat)':'var(--n600)',whiteSpace:'nowrap'}}>{lic.days<0?`${Math.abs(lic.days)}d ago`:`${lic.days}d`}</td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...licStatus[lic.status]}}>{lic.status}</span>
                        </td>
                        <td style={{padding:'11px 14px'}}><button style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Renew</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showModal && <ScheduleModal onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load() }}/>}
    </div>
  )
}

function TasksTable({ tasks, onComplete }) {
  return (
    <table style={{width:'100%',borderCollapse:'collapse'}}>
      <thead style={{position:'sticky',top:0,zIndex:10}}>
        <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
          {['Task','Schedule','Asset','Site','Due','Assignee','Status',''].map(h => (
            <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tasks.map(t => {
          const sc = TASK_STATUS[t.status] || TASK_STATUS.pending
          return (
            <tr key={t.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
              <td style={{padding:'10px 14px'}}>
                <div style={{fontSize:12,fontWeight:500,color:'var(--n900)',whiteSpace:'nowrap',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis'}}>{t.title}</div>
              </td>
              <td style={{padding:'10px 14px',fontSize:11,color:'var(--n600)',whiteSpace:'nowrap'}}>
                {t.schedule?.frequency ? FREQ_LABEL[t.schedule.frequency] : '—'}
              </td>
              <td style={{padding:'10px 14px'}}>
                {t.asset ? (
                  <>
                    <div style={{fontSize:12,fontWeight:500,color:'var(--n900)',whiteSpace:'nowrap',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{t.asset.name}</div>
                    <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{t.asset.ain}</div>
                  </>
                ) : <span style={{fontSize:12,color:'var(--n400)'}}>—</span>}
              </td>
              <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{t.site?.name||'—'}</td>
              <td style={{padding:'10px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:t.status==='overdue'?'var(--srt)':'var(--n600)',whiteSpace:'nowrap'}}>{fmtDate(t.due_date)}</td>
              <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{t.assignee?.full_name||'—'}</td>
              <td style={{padding:'10px 14px'}}>
                <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:`1px solid ${sc.br}`,fontSize:10,fontWeight:500,background:sc.bg,color:sc.c}}>{sc.label}</span>
              </td>
              <td style={{padding:'10px 14px'}}>
                {t.status !== 'completed' && t.status !== 'skipped' && (
                  <button onClick={() => onComplete(t.id)} style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>Mark done</button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SchedulesView({ schedules }) {
  return (
    <div style={{padding:20}}>
      <div style={{fontSize:12,color:'var(--n500)',marginBottom:14}}>No active tasks in the next 30 days. Showing {schedules.length} PM schedule{schedules.length!==1?'s':''}.</div>
      <table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead>
          <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
            {['Schedule','Frequency','Asset','Site','Next Due','Active'].map(h => (
              <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schedules.map(s => (
            <tr key={s.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
              <td style={{padding:'10px 14px',fontSize:12,fontWeight:500,color:'var(--n900)'}}>{s.title}</td>
              <td style={{padding:'10px 14px',fontSize:12,color:'var(--n600)'}}>{FREQ_LABEL[s.frequency]||s.frequency}</td>
              <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)'}}>{s.asset?.name||'—'}</td>
              <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)'}}>{s.site?.name||'—'}</td>
              <td style={{padding:'10px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)'}}>{fmtDate(s.next_due)}</td>
              <td style={{padding:'10px 14px'}}>
                <span style={{fontSize:11,fontWeight:500,color:s.active?'var(--sgt)':'var(--n400)'}}>{s.active?'Yes':'No'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyPM({ onSchedule, canCreate }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',gap:12,textAlign:'center'}}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/></svg>
      <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>No PM tasks or schedules yet</div>
      <div style={{fontSize:13,color:'var(--n500)',maxWidth:320}}>
        Create a PM schedule to start generating preventive maintenance tasks. Tasks are generated automatically based on frequency.
      </div>
      {canCreate && (
        <button onClick={onSchedule} className="btn btn-primary" style={{marginTop:8,height:36,padding:'0 18px',fontSize:13}}>
          Create first schedule
        </button>
      )}
    </div>
  )
}
