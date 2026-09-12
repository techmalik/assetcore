import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import AssignModal, { assignmentSummary } from '../components/AssignModal.jsx'
import InspectionsPanel from '../components/InspectionsPanel.jsx'
import CompliancePanel from '../components/CompliancePanel.jsx'
import { listPMSchedules, createPMSchedule, softDeletePMSchedule } from '../lib/db/pmSchedules'
import { listPMTasks, updatePMTask, generatePMTasks, uploadMaintenanceReport } from '../lib/db/pmTasks'
import { listOrgUsers } from '../lib/db/orgMembers'
import { listAssets } from '../lib/db/assets'
import { api } from '../lib/apiClient'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import { useToast } from '../lib/ToastContext'
import { useLocationFilter } from '../lib/LocationFilterContext'
import { errorText } from '../lib/errors'

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
function ScheduleModal({ onClose, onSaved, users, assets }) {
  const [form, setForm] = useState({ title:'', frequency:'monthly', next_due:isoToday(), assignee_id:'', asset_id:'' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  const save = async () => {
    if (!form.title.trim()) return setErr('Title is required.')
    setSaving(true); setErr(null)
    try {
      await createPMSchedule({
        title:form.title.trim(), frequency:form.frequency, next_due:form.next_due,
        description:form.description||null, assignee_id: form.assignee_id || null,
        // The API has always accepted this; the form never sent it, so every
        // schedule built here belonged to no asset and its tasks could never
        // reach that asset's record or its "overdue maintenance" health signal.
        asset_id: form.asset_id || null,
      })
      onSaved()
    } catch(e) { setErr(errorText(e)) } finally { setSaving(false) }
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
          <div className="form-grid" style={{ gap:10 }}>
            <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>Frequency *
              <select value={form.frequency} onChange={e=>set('frequency',e.target.value)} style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 8px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',background:'var(--n0)'}}>
                {Object.entries(FREQ_LABEL).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>First due *
              <input type="date" value={form.next_due} onChange={e=>set('next_due',e.target.value)} style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',boxSizing:'border-box'}}/>
            </label>
          </div>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>Asset
            <select value={form.asset_id} onChange={e=>set('asset_id',e.target.value)} style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 8px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',background:'var(--n0)'}}>
              <option value="">— Not asset-specific —</option>
              {(assets||[]).map(a => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
            </select>
          </label>
          <p style={{fontSize:11.5,color:'var(--n500)',lineHeight:1.5,marginTop:-4}}>
            A schedule left without an asset still generates tasks, but they belong to no
            asset — they never show on an asset&apos;s record and never count towards its health score.
          </p>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)'}}>Default assignee
            <select value={form.assignee_id} onChange={e=>set('assignee_id',e.target.value)} style={{marginTop:4,width:'100%',height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 8px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',background:'var(--n0)'}}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </label>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Save Schedule'}</button>
        </div>
      </div>
    </div>
  )
}

export default function Maintenance({ dark, toggleDark }) {
  const toast = useToast()
  const { roleKey, extraCaps, user } = useAuth()
  // Both "Schedule PM" and "Generate Tasks" hit endpoints gated on pm:create
  // (pmSchedules.ts, pmTasks.ts) — this used to check wo:create, so the button
  // appeared for roles whose request would 403 and hid from roles that could.
  // extraCaps is passed so a per-user grant from Admin -> Access settings
  // actually surfaces the control the API would already accept.
  const canCreate = can(roleKey, 'pm:create', extraCaps)
  const canAssign = can(roleKey, 'pm:update', extraCaps)
  const { locationId: globalLocationId, setLocationId: setGlobalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)

  const [searchParams] = useSearchParams()
  const overdueOnly = searchParams.get('filter') === 'overdue'
  // ?tab= lets a notification deep-link land on the right tab; ?id= is passed
  // straight through to whichever panel owns that entity.
  const urlTab = searchParams.get('tab')
  const deepLinkId = searchParams.get('id')
  const [tab, setTab] = useState(['pm','inspections','compliance'].includes(urlTab) ? urlTab : 'pm')
  // Counts reported by the embedded panels — replaces a hardcoded '7' badge.
  const [inspectionCounts, setInspectionCounts] = useState(null)
  const [complianceCounts, setComplianceCounts] = useState(null)
  const onInspectionCounts = useCallback((c) => setInspectionCounts(c), [])
  const onComplianceCounts = useCallback((c) => setComplianceCounts(c), [])
  const [tasks, setTasks] = useState([])
  const [schedules, setSchedules] = useState([])
  const [users, setUsers] = useState([])
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [assigning, setAssigning] = useState(null) // task being (re)assigned
  const [mineOnly, setMineOnly] = useState(false)
  const today = isoToday()
  const weekStart = weekDays(today)[0].toISOString().slice(0,10)
  const weekEnd   = weekDays(today)[6].toISOString().slice(0,10)

  const load = useCallback(async () => {
    if (tab !== 'pm') return
    setLoading(true); setErr(null)
    try {
      const [t, s, u, a] = await Promise.all([
        listPMTasks({ statuses:['pending','in_progress','overdue'], dueBefore: addDays(today,30), locationId: globalLocationId }),
        listPMSchedules(),
        listOrgUsers().catch(() => []),
        listAssets().catch(() => []),
      ])
      setTasks(t)
      setSchedules(s)
      setUsers(u)
      setAssets(a)
    } catch(e) {
      setErr(errorText(e))
    } finally { setLoading(false) }
  }, [tab, today, globalLocationId])

  useEffect(() => { load() }, [load])

  async function saveAssignment(taskId, assigneeId) {
    await updatePMTask(taskId, { assignee_id: assigneeId })
    setAssigning(null)
    toast.success(assigneeId ? 'Task assigned.' : 'Task unassigned.')
    load()
  }

  const handleArchiveSchedule = async (schedule) => {
    if (!window.confirm(`Archive "${schedule.title}"? No further tasks will be generated from it. Existing tasks are unaffected.`)) return
    try {
      await softDeletePMSchedule(schedule.id)
      toast.success('Schedule archived.')
      load()
    } catch (e) { toast.error(errorText(e, 'Failed to archive schedule.')) }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const count = await generatePMTasks()
      await load()
      // Generation legitimately produces nothing most of the time — a schedule
      // is skipped when it already has an open task or is not due within seven
      // days. Saying so is the difference between "there was nothing to do"
      // and what this looked like before: a button that reloads the page and
      // never explains itself.
      if (count > 0) toast.success(`${count} task${count === 1 ? '' : 's'} generated.`)
      else toast.info('Nothing to generate — every active schedule already has a task open, or is not due within the next 7 days.')
    } catch (e) {
      toast.error(errorText(e, 'Failed to generate tasks.'))
    } finally { setGenerating(false) }
  }

  const [completing, setCompleting] = useState(null)

  const onTaskCompleted = (taskId) => {
    setCompleting(null)
    setTasks(prev => prev.filter(t => t.id !== taskId))
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
  const mineFiltered = mineOnly ? tasks.filter(t => t.assignee_id === user?.id) : tasks
  const visibleTasks = overdueOnly ? mineFiltered.filter(t => t.status === 'overdue') : mineFiltered

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
                  <button onClick={() => setMineOnly(m => !m)} className="filter-pill"
                    style={{height:32,padding:'0 12px',border:`1px solid ${mineOnly?'var(--b300)':'var(--n200)'}`,borderRadius:99,background:mineOnly?'var(--b50)':'var(--n0)',fontSize:12,fontWeight:mineOnly?600:400,color:mineOnly?'var(--b700)':'var(--n600)',cursor:'pointer'}}>
                    Assigned to me
                  </button>
                  {canCreate && (
                    <button onClick={handleGenerate} disabled={generating} className="row-action" style={{height:32,padding:'0 14px',background:'var(--n0)',color:'var(--n700)',border:'1px solid var(--n200)',borderRadius:4,fontSize:13}}>
                      {generating?'Generating…':'Generate Tasks'}
                    </button>
                  )}
                  {canCreate && (
                    <button onClick={() => setShowModal(true)} className="row-action" style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',borderRadius:4,fontSize:13,fontWeight:500,gap:6}}>
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
                {k:'inspections',label:'Inspections', badge: inspectionCounts?.overdue || null},
                {k:'compliance',label:'Compliance', badge: complianceCounts?.alerts || null},
              ].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)} style={{display:'flex',alignItems:'center',gap:6}}>
                  {t.label}
                  {t.badge && <span style={{background:'var(--srb)',color:'var(--srt)',border:'1px solid var(--srbr)',borderRadius:2,fontSize:9,fontWeight:600,padding:'0 5px',lineHeight:'16px'}}>{t.badge}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="split-with-aside" style={{flex:1,overflow:'hidden',display:'flex'}}>
            {tab === 'pm' && (
              <>
                <div className="split-primary" style={{flex:1,overflowY:'auto'}}>
                  {overdueOnly && (
                    <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 16px',background:'var(--srb)',borderBottom:'1px solid var(--srbr)',fontSize:12,color:'var(--srt)'}}>
                      Showing overdue tasks only ({visibleTasks.length})
                      <a href="/maintenance" style={{color:'var(--srt)',textDecoration:'underline',marginLeft:'auto'}}>Clear filter</a>
                    </div>
                  )}
                  {loading ? (
                    <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
                  ) : err ? (
                    <div style={{padding:24}}>
                      <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>
                        {err.includes('does not exist') ? 'PM tables not yet created. Run `node scripts/migrate.mjs` against the database.' : err}
                      </div>
                      {schedules.length === 0 && tasks.length === 0 && !err && (
                        <EmptyPM onSchedule={() => setShowModal(true)} canCreate={canCreate} locationName={globalLocation?.name} onShowAll={() => setGlobalLocationId(null)} />
                      )}
                    </div>
                  ) : visibleTasks.length === 0 && schedules.length === 0 ? (
                    <EmptyPM onSchedule={() => setShowModal(true)} canCreate={canCreate} locationName={globalLocation?.name} onShowAll={() => setGlobalLocationId(null)} />
                  ) : visibleTasks.length === 0 ? (
                    overdueOnly ? (
                      <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>No overdue tasks.</div>
                    ) : (
                      <SchedulesView schedules={schedules} canManage={canCreate} onArchive={handleArchiveSchedule} />
                    )
                  ) : (
                    <TasksTable tasks={visibleTasks} onComplete={setCompleting} onAssign={canAssign ? setAssigning : null} />
                  )}
                </div>

                <div className="aside-panel" style={{width:300,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
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
                          {dayTasks.length === 0 && <div style={{marginLeft:32,fontSize:11,color:'var(--n400)'}}>No tasks</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {/* Both tabs mount the real feature, not a copy of it — the same
                components /inspections and /compliance render. Previously this
                tab strip promised three things and delivered one: a "Phase 3
                coming soon" panel and seven hardcoded demo licences. */}
            {/* Mounted always rather than conditionally, so the tab badges are
                populated on arrival instead of only after you click the tab
                they describe — a badge you have to open the tab to see isn't
                doing its job. Costs two list requests on page load. */}
            <div style={{display: tab === 'inspections' ? 'flex' : 'none', flex:1, minWidth:0, overflow:'hidden'}}>
              <InspectionsPanel embedded selectedId={deepLinkId} onCounts={onInspectionCounts} />
            </div>

            <div style={{display: tab === 'compliance' ? 'flex' : 'none', flex:1, minWidth:0, overflow:'hidden'}}>
              <CompliancePanel embedded selectedId={deepLinkId} onCounts={onComplianceCounts} />
            </div>

          </div>
        </div>
      </div>

      {showModal && <ScheduleModal users={users} assets={assets} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); load() }}/>}
      {completing && <CompleteTaskModal task={completing} onClose={() => setCompleting(null)} onDone={onTaskCompleted}/>}
      {assigning && (
        <AssignModal title="Assign task" subtitle={assigning.title} users={users} currentId={assigning.assignee_id}
          current={assignmentSummary({ assignee: assigning.assignee, assigner: assigning.assigner, assignedAt: assigning.assigned_at })}
          onClose={() => setAssigning(null)} onSave={(userId) => saveAssignment(assigning.id, userId)}/>
      )}
    </div>
  )
}

// Completion modal — mark a PM task done and (optionally) attach the report in
// one step, since completed tasks drop out of the active list afterwards.
function CompleteTaskModal({ task, onClose, onDone }) {
  const [notes, setNotes] = useState(task.notes || '')
  const [reportFile, setReportFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  async function confirm() {
    setSaving(true); setErr(null)
    try {
      await updatePMTask(task.id, { status: 'completed', notes: notes || null })
      if (reportFile) await uploadMaintenanceReport(task.id, reportFile)
      onDone(task.id)
    } catch (e) { setErr(errorText(e, 'Failed to complete.')); setSaving(false) }
  }

  const inp = { width: '100%', border: '1px solid var(--n200)', borderRadius: 4, padding: '8px 10px', fontSize: 13, fontFamily: 'var(--ff-u)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', background: 'var(--n0)', color: 'var(--n900)' }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)' }}>
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: 24, width: 440, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', flex: 1 }}>Complete Maintenance</h2>
          <button onClick={onClose} style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--n500)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--n600)', marginBottom: 14 }}>{task.title}{task.asset ? ` · ${task.asset.name}` : ''}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--n800)', display: 'flex', flexDirection: 'column', gap: 4 }}>Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What was done…" style={inp} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--n800)', display: 'flex', flexDirection: 'column', gap: 4 }}>Maintenance report (optional)
            <input type="file" onChange={(e) => setReportFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </label>
        </div>
        <p style={{ fontSize: 11, color: 'var(--n500)', marginTop: 10 }}>Completing this resets the linked asset's health to 100%.</p>
        {err && <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: 'var(--srt)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button onClick={confirm} disabled={saving} className="btn btn-primary" style={{ height: 34, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Mark Complete'}</button>
        </div>
      </div>
    </div>
  )
}

function TasksTable({ tasks, onComplete, onAssign }) {
  return (
    <>
      <table className="table-view-desktop" style={{width:'100%',borderCollapse:'collapse'}}>
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
                {/* Second line rather than a new column — the assigner had to
                    be visible somewhere, and PM tasks have no detail view to
                    put it in. */}
                <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>
                  <div>{t.assignee?.full_name||'—'}</div>
                  {t.assigner?.full_name && (
                    <div style={{fontSize:10,color:'var(--n400)'}}>
                      by {t.assigner.full_name}{t.assigned_at ? `, ${fmtDate(t.assigned_at)}` : ''}
                    </div>
                  )}
                </td>
                <td style={{padding:'10px 14px'}}>
                  <StatusBadge tone={sc} />
                </td>
                <td style={{padding:'10px 14px'}}>
                  <div style={{display:'flex',gap:10,whiteSpace:'nowrap'}}>
                    {t.status !== 'completed' && t.status !== 'skipped' && (
                      <button onClick={() => onComplete(t)} className="row-action" style={{fontSize:11,color:'var(--b600)'}}>Mark done</button>
                    )}
                    {onAssign && t.status !== 'completed' && t.status !== 'skipped' && (
                      <button onClick={() => onAssign(t)} className="row-action" style={{fontSize:11,color:'var(--n500)'}}>
                        {t.assignee ? 'Reassign' : 'Assign'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Mobile card list — same data, with real tappable Mark-done/Assign buttons */}
      <div className="card-list">
        {tasks.map(t => {
          const sc = TASK_STATUS[t.status] || TASK_STATUS.pending
          return (
            <div key={t.id} className="list-card" style={{cursor:'default'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:6}}>
                <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{t.title}</div>
                <StatusBadge tone={sc} />
              </div>
              {t.asset && (
                <div style={{fontSize:12,color:'var(--n600)',marginBottom:4}}>
                  {t.asset.name} <span style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{t.asset.ain}</span>
                </div>
              )}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:8,flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--ff-m)',fontSize:11,color:t.status==='overdue'?'var(--srt)':'var(--n600)'}}>{fmtDate(t.due_date)}</span>
                <div style={{display:'flex',gap:8}}>
                  {onAssign && t.status !== 'completed' && t.status !== 'skipped' && (
                    <button onClick={() => onAssign(t)} className="btn btn-secondary" style={{height:36,padding:'0 14px',fontSize:12}}>{t.assignee ? 'Reassign' : 'Assign'}</button>
                  )}
                  {t.status !== 'completed' && t.status !== 'skipped' && (
                    <button onClick={() => onComplete(t)} className="btn btn-secondary" style={{height:36,padding:'0 14px',fontSize:12}}>Mark done</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function SchedulesView({ schedules, canManage, onArchive }) {
  return (
    <div style={{padding:20}}>
      <div style={{fontSize:12,color:'var(--n500)',marginBottom:14}}>No active tasks in the next 30 days. Showing {schedules.length} PM schedule{schedules.length!==1?'s':''}.</div>
      <div className="table-scroll"><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead>
          <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
            {['Schedule','Frequency','Asset','Site','Assignee','Next Due','Active',''].map(h => (
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
              <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)'}}>{s.assignee?.full_name||'—'}</td>
              <td style={{padding:'10px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)'}}>{fmtDate(s.next_due)}</td>
              <td style={{padding:'10px 14px'}}>
                <span style={{fontSize:11,fontWeight:500,color:s.active?'var(--sgt)':'var(--n400)'}}>{s.active?'Yes':'No'}</span>
              </td>
              <td style={{padding:'10px 14px'}}>
                {canManage && (
                  <button onClick={() => onArchive(s)} className="row-action" style={{fontSize:11,color:'var(--n500)'}}>Archive</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  )
}

function EmptyPM({ onSchedule, canCreate, locationName, onShowAll }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',gap:12,textAlign:'center'}}>
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/></svg>
      <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>{locationName ? `No PM tasks in ${locationName}` : 'No PM tasks or schedules yet'}</div>
      {!locationName && (
        <div style={{fontSize:13,color:'var(--n500)',maxWidth:320}}>
          Create a PM schedule to start generating preventive maintenance tasks. Tasks are generated automatically based on frequency.
        </div>
      )}
      {locationName ? (
        <button onClick={onShowAll} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Show all locations</button>
      ) : canCreate && (
        <button onClick={onSchedule} className="btn btn-primary" style={{marginTop:8,height:36,padding:'0 18px',fontSize:13}}>
          Create first schedule
        </button>
      )}
    </div>
  )
}
