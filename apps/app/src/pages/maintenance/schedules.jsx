import { fmtDate } from '../../lib/dates'
import EmptyState from '../../components/EmptyState.jsx'
import { FREQ_LABEL } from './shared.jsx'

export function SchedulesView({ schedules, canManage, onArchive }) {
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

export function EmptyPM({ onSchedule, canCreate, locationName, onShowAll }) {
  return (
    <EmptyState
      icon={<svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/></svg>}
      title={locationName ? `No PM tasks in ${locationName}` : 'No PM tasks or schedules yet'}
      body={!locationName && 'Create a PM schedule to start generating preventive maintenance tasks. Tasks are generated automatically based on frequency.'}
      action={locationName ? (
        <button onClick={onShowAll} className="btn btn-secondary" style={{height:36,padding:'0 18px',fontSize:13}}>Show all locations</button>
      ) : canCreate && (
        <button onClick={onSchedule} className="btn btn-primary" style={{height:36,padding:'0 18px',fontSize:13}}>Create first schedule</button>
      )}
    />
  )
}
