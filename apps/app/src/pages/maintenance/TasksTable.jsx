import StatusBadge from '../../components/StatusBadge.jsx'
import { fmtDate } from '../../lib/dates'
import { TASK_STATUS, FREQ_LABEL } from './shared.jsx'

export function TasksTable({ tasks, onComplete, onAssign, onReport }) {
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
                    {onReport && t.status === 'completed' && (
                      <button onClick={() => onReport(t)} className="row-action" style={{fontSize:11,color:'var(--b600)'}}>Submit report</button>
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
                  {onReport && t.status === 'completed' && (
                    <button onClick={() => onReport(t)} className="btn btn-secondary" style={{height:36,padding:'0 14px',fontSize:12}}>Submit report</button>
                  )}
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
