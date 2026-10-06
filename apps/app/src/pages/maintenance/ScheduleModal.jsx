import { useState } from 'react'
import { createPMSchedule } from '../../lib/db/pmSchedules'
import { errorText } from '../../lib/errors'
import { todayISO } from '../../lib/dates'
import { FREQ_LABEL } from './shared.jsx'

// ── Schedule Modal ────────────────────────────────────────────────────────────
export function ScheduleModal({ onClose, onSaved, users, assets }) {
  const [form, setForm] = useState({ title:'', frequency:'monthly', next_due:todayISO(), assignee_id:'', asset_id:'' })
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
              {/* Inactive = at a shut-down site, where the API refuses new schedules. */}
              {(assets||[]).map(a => <option key={a.id} value={a.id} disabled={a.status === 'inactive'}>{a.ain} — {a.name}{a.status === 'inactive' ? ' (site shut down)' : ''}</option>)}
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
