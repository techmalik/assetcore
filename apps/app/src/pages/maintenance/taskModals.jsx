import { useState } from 'react'
import SendForApproval from '../../components/SendForApproval.jsx'
import { updatePMTask, uploadMaintenanceReport } from '../../lib/db/pmTasks'
import { errorText } from '../../lib/errors'

// Completion modal — mark a PM task done and (optionally) attach the report in
// one step, since completed tasks drop out of the active list afterwards.
export function CompleteTaskModal({ task, onClose, onDone }) {
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
        <p style={{ fontSize: 11, color: 'var(--n500)', marginTop: 10 }}>Completing this clears the linked asset's overdue maintenance and rescores its health.</p>
        {err && <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: 'var(--srt)', marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button onClick={confirm} disabled={saving} className="btn btn-primary" style={{ height: 34, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Mark Complete'}</button>
        </div>
      </div>
    </div>
  )
}

// Sends a completed task's maintenance report to a named person for approval.
// Keyed to the PM task because that is what this page lists. A task with no
// asset never gets a maintenance_events row to key it to.
export function ReportModal({ task, onClose }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:24,width:440,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:6}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>
            {task.justCompleted ? 'Send the report for approval?' : 'Submit maintenance report'}
          </h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        <p style={{fontSize:12,color:'var(--n600)',marginBottom:14,lineHeight:1.5}}>
          {task.title}{task.asset ? ` · ${task.asset.name}` : ''}
          {task.justCompleted
            ? '. Marked done. Send its report to your line manager, or anyone who can accept it. You can also do this later from the Completed list.'
            : ''}
        </p>
        <SendForApproval entityType="pm_task" entityId={task.id} kind="maintenance_report"
          title={`Maintenance report: ${task.title}`} heading="Report approval" />
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:18}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Close</button>
        </div>
      </div>
    </div>
  )
}
