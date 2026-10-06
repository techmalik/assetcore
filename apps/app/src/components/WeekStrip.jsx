import { fmtDateLong, toISODate, parseISODate } from '../lib/dates'

/** Monday to Sunday of the week holding `refDate` (an ISO date). */
function weekDays(refDate) {
  const ref = parseISODate(refDate)
  const mon = new Date(ref); mon.setDate(ref.getDate() - ((ref.getDay()+6)%7))
  return Array.from({length:7},(_,i) => { const d=new Date(mon); d.setDate(mon.getDate()+i); return d })
}

/**
 * This week, a day per row, with the tasks due on each. `tasks` carry
 * due_date and title; `colorOf(task)` colours each one's edge.
 */
export default function WeekStrip({ today, tasks, colorOf }) {
  const days = weekDays(today)
  const weekStart = toISODate(days[0])
  const weekEnd = toISODate(days[6])
  const byDay = {}
  for (const t of tasks) {
    if (t.due_date >= weekStart && t.due_date <= weekEnd) (byDay[t.due_date] ||= []).push(t)
  }

  return (
    <div className="aside-panel" style={{width:300,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div style={{padding:'14px 16px',borderBottom:'var(--bdr)'}}>
        <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>
          {parseISODate(weekStart).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – {fmtDateLong(weekEnd)}
        </div>
        <div style={{fontSize:11,color:'var(--n500)'}}>This week's PM tasks</div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
        {days.map(day => {
          const iso = toISODate(day)
          const dayTasks = byDay[iso] || []
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
                                return (
                  <div key={i} style={{marginLeft:32,marginBottom:4,padding:'4px 8px',background:'var(--n50)',borderRadius:3,borderLeft:`2px solid ${colorOf(t)}`,fontSize:11,color:'var(--n700)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
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
  )
}
