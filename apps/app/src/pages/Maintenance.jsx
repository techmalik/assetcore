import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import AssignModal, { assignmentSummary } from '../components/AssignModal.jsx'
import InspectionsPanel from '../components/InspectionsPanel.jsx'
import CompliancePanel from '../components/CompliancePanel.jsx'
import { listPMSchedules, softDeletePMSchedule } from '../lib/db/pmSchedules'
import { listPMTasks, updatePMTask, generatePMTasks } from '../lib/db/pmTasks'
import { listOrgUsers } from '../lib/db/orgMembers'
import { listAssets } from '../lib/db/assets'
import { useAuth, useCan } from '../lib/AuthContext'
import { useToast } from '../lib/ToastContext'
import { useLocationFilter } from '../lib/LocationFilterContext'
import { errorText } from '../lib/errors'
import { todayISO, addDaysISO } from '../lib/dates'
import { useConfirm } from '../lib/ConfirmContext'
import { TASK_STATUS } from './maintenance/shared.jsx'
import WeekStrip from '../components/WeekStrip.jsx'
import TableState from '../components/TableState.jsx'
import { useResource } from '../lib/useResource'
import { ScheduleModal } from './maintenance/ScheduleModal.jsx'
import { CompleteTaskModal, ReportModal } from './maintenance/taskModals.jsx'
import { TasksTable } from './maintenance/TasksTable.jsx'
import { SchedulesView, EmptyPM } from './maintenance/schedules.jsx'

export default function Maintenance({ dark, toggleDark }) {
  const ask = useConfirm()
  const can = useCan()
  const toast = useToast()
  const { user } = useAuth()
  // Both "Schedule PM" and "Generate Tasks" hit endpoints gated on pm:create
  // (pmSchedules.ts, pmTasks.ts) — this used to check wo:create, so the button
  // appeared for roles whose request would 403 and hid from roles that could.
  // extraCaps is passed so a per-user grant from Admin -> Access settings
  // actually surfaces the control the API would already accept.
  const canCreate = can('pm:create')
  const canAssign = can('pm:update')
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
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [assigning, setAssigning] = useState(null) // task being (re)assigned
  const [mineOnly, setMineOnly] = useState(false)
  // A completed task drops out of the active list, which left nowhere to send
  // its maintenance report for approval. This view brings the last 60 days
  // back, each with a "Submit report" action.
  const [showCompleted, setShowCompleted] = useState(false)
  const [reporting, setReporting] = useState(null) // task whose report is being sent
  const today = todayISO()

  // The task list follows the filters; the schedules, people and assets do
  // not, so they load once (and after an action that changes them) rather
  // than again on every filter. Neither loads until the PM tab is open.
  const onPM = tab === 'pm'
  const list = useResource(
    () => (!onPM ? Promise.resolve([]) : listPMTasks(showCompleted
      ? { statuses:['completed'], dueAfter: addDaysISO(today,-60), locationId: globalLocationId }
      : { statuses:['pending','in_progress','overdue'], dueBefore: addDaysISO(today,30), locationId: globalLocationId })),
    [onPM, today, globalLocationId, showCompleted],
    { initial: [], keepPrevious: true, errorFallback: 'Could not load the PM tasks.' },
  )
  const lookups = useResource(
    () => (!onPM ? Promise.resolve(null) : Promise.all([listPMSchedules(), listOrgUsers().catch(() => []), listAssets().catch(() => [])])
      .then(([schedules, users, assets]) => ({ schedules, users, assets }))),
    [onPM],
    { initial: null, keepPrevious: true, errorFallback: 'Could not load the PM schedules.' },
  )
  const tasks = list.data
  const setTasks = list.setData
  const { schedules = [], users = [], assets = [] } = lookups.data || {}
  const loading = (list.loading && tasks.length === 0) || (lookups.loading && !lookups.data)
  const err = list.error || lookups.error
  const load = () => Promise.all([list.reload(), lookups.reload()])

  async function saveAssignment(taskId, assigneeId) {
    await updatePMTask(taskId, { assignee_id: assigneeId })
    setAssigning(null)
    toast.success(assigneeId ? 'Task assigned.' : 'Task unassigned.')
    load()
  }

  const handleArchiveSchedule = async (schedule) => {
    if (!(await ask(`Archive "${schedule.title}"? No further tasks will be generated from it. Existing tasks are unaffected.`, { danger: true, confirmLabel: 'Archive' }))) return
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

  // The report is to hand straight after a task is marked done, so sending it
  // for approval is offered then, rather than left for someone to find later.
  const canSendReport = can('approval:create')
  const onTaskCompleted = (taskId) => {
    const done = completing
    setCompleting(null)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    if (done && canSendReport) setReporting({ ...done, status: 'completed', justCompleted: true })
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
            <div className="page-header" style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
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
                  <button onClick={() => setShowCompleted(v => !v)} className="filter-pill" title="Maintenance completed in the last 60 days, to send its report for approval"
                    style={{height:32,padding:'0 12px',border:`1px solid ${showCompleted?'var(--b300)':'var(--n200)'}`,borderRadius:99,background:showCompleted?'var(--b50)':'var(--n0)',fontSize:12,fontWeight:showCompleted?600:400,color:showCompleted?'var(--b700)':'var(--n600)',cursor:'pointer'}}>
                    Completed
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
            <div className="tab-strip" style={{display:'flex',gap:0}}>
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
                    <TableState error={err} onRetry={load} />
                  ) : showCompleted && visibleTasks.length === 0 ? (
                    <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>
                      No maintenance completed in the last 60 days{mineOnly ? ' on tasks assigned to you' : ''}.
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
                    <TasksTable tasks={visibleTasks} onComplete={setCompleting} onAssign={canAssign ? setAssigning : null}
                      onReport={canSendReport ? setReporting : null} />
                  )}
                </div>

                <WeekStrip today={today} tasks={tasks} colorOf={(t) => (TASK_STATUS[t.status] || TASK_STATUS.pending).c} />
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
      {reporting && <ReportModal task={reporting} onClose={() => setReporting(null)} />}
      {assigning && (
        <AssignModal title="Assign task" subtitle={assigning.title} users={users} currentId={assigning.assignee_id}
          current={assignmentSummary({ assignee: assigning.assignee, assigner: assigning.assigner, assignedAt: assigning.assigned_at })}
          onClose={() => setAssigning(null)} onSave={(userId) => saveAssignment(assigning.id, userId)}/>
      )}
    </div>
  )
}
