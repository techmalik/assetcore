import { useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { getDashboardStats, getRecentWorkOrders, getDashboardAlerts } from '../lib/db/dashboard.js'
import { getComplianceLicenceCounts } from '../lib/db/complianceLicences.js'
import { listPMTasks } from '../lib/db/pmTasks.js'

const ALERT_SEVERITY_STYLE = {
  critical: { c: 'var(--srt)', bg: 'var(--srb)' },
  high:     { c: 'var(--srt)', bg: 'var(--srb)' },
  medium:   { c: 'var(--sat)', bg: 'var(--sab)' },
  low:      { c: 'var(--n500)', bg: 'var(--n100)' },
}

function alertAtLabel(at) {
  if (!at) return ''
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function pmDueLabel(due_date) {
  const diff = Math.ceil((new Date(due_date) - Date.now()) / 86400000)
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, color: 'var(--srt)' }
  if (diff === 0) return { text: 'Today', color: 'var(--sat)' }
  return { text: `in ${diff}d`, color: 'var(--n500)' }
}

const WO_STATUS_LABEL = {
  new: 'New', assigned: 'Assigned', in_progress: 'In Progress',
  awaiting_parts: 'Awaiting Parts', inspection: 'Inspection', closed: 'Closed',
}
const WO_PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

function pct(n, total) {
  return total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`
}

function slaDueLabel(sla_due) {
  if (!sla_due) return { text: '—', color: 'var(--n400)' }
  const diff = new Date(sla_due) - Date.now()
  const days = Math.ceil(diff / 86400000)
  if (diff < 0) return { text: `${Math.abs(days)}d overdue`, color: 'var(--srt)' }
  if (days === 0) return { text: 'Today', color: 'var(--sat)' }
  if (days <= 2) return { text: `${days}d left`, color: 'var(--sat)' }
  return { text: new Date(sla_due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), color: 'var(--n500)' }
}

function woStatusBadge(status) {
  const map = { new: 'n', assigned: 'b', in_progress: 'ip', awaiting_parts: 'b', inspection: 'b', closed: 'g' }
  return map[status] || 'n'
}

function woPrioBadge(priority) {
  return { low: 'b', medium: 'b', high: 'a', critical: 'r' }[priority] || 'b'
}

function initialsOf(name) {
  if (!name) return '?'
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase()
}

const SITES = ['All Sites', 'Lagos', 'Delta', 'North', 'Warri', 'Aba']

export default function Dashboard({ dark, toggleDark }) {
  const { org } = useAuth()
  const [activeSite, setActiveSite] = useState(0)
  const [stats, setStats] = useState(null)
  const [recentWOs, setRecentWOs] = useState([])
  const [statsErr, setStatsErr] = useState(null)
  const [complianceCounts, setComplianceCounts] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [upcomingPM, setUpcomingPM] = useState(null)

  useEffect(() => {
    Promise.all([getDashboardStats(), getRecentWorkOrders()])
      .then(([s, wos]) => { setStats(s); setRecentWOs(wos) })
      .catch(e => setStatsErr(e.message))
    getComplianceLicenceCounts().then(setComplianceCounts).catch(() => {})
    getDashboardAlerts().then(setAlerts).catch(() => setAlerts([]))
    const today = new Date().toISOString().slice(0, 10)
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    listPMTasks({ statuses: ['pending', 'in_progress'], dueAfter: today, dueBefore: in14, limit: 10 })
      .then(setUpcomingPM).catch(() => setUpcomingPM([]))
  }, [])

  const a = stats?.assets
  const w = stats?.wos

  // Donut arc math (circumference of r=54 circle ≈ 339.3)
  const C = 339.3
  const opArc   = a && a.total ? (a.operational / a.total) * C : 0
  const attArc  = a && a.total ? (a.attention   / a.total) * C : 0
  const critArc = a && a.total ? (a.critical    / a.total) * C : 0

  return (
    <div className="app-shell">
      <Sidebar active="dashboard"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Dashboard" dark={dark} toggleDark={toggleDark}>
          <div style={{height:34,display:'flex',alignItems:'center',padding:'0 24px',gap:6,background:'var(--n50)',borderTop:'var(--bdr)'}}>
            <span style={{fontSize:12,color:'var(--n500)',fontWeight:500,marginRight:2}}>Site:</span>
            {SITES.map((s, i) => (
              <button key={s} onClick={() => setActiveSite(i)} style={{height:22,padding:'0 8px',border:i===activeSite?'1px solid var(--b300)':'1px solid transparent',borderRadius:3,background:i===activeSite?'var(--b50)':'transparent',fontSize:12,color:i===activeSite?'var(--b700)':'var(--n600)',cursor:'pointer'}}>{s}</button>
            ))}
            <div style={{flex:1}}/>
            <span style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n400)'}}>
              {new Date().toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} WAT
            </span>
          </div>
        </Topbar>

        <div style={{flex:1,overflowY:'auto',padding:24}}>
          {/* Page header */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
            <div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:26,fontWeight:700,letterSpacing:'-.4px',color:'var(--n950)',lineHeight:1.15}}>Operations Dashboard</h1>
              <p style={{fontSize:13,color:'var(--n500)',marginTop:4}}>
                Network health overview · {org?.name || 'Loading…'}
              </p>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <select style={{height:32,border:'1px solid var(--n200)',borderRadius:4,padding:'0 28px 0 10px',fontFamily:'var(--ff-u)',fontSize:13,color:'var(--n700)',background:'var(--n0)',appearance:'none'}}>
                <option>Last 30 days</option><option>Last 7 days</option><option>This quarter</option>
              </select>
              <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 9v3h3M12 9v3H9M2 5V2h3M12 5V2H9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Generate Report
              </button>
            </div>
          </div>

          {statsErr && (
            <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--srt)'}}>
              Failed to load dashboard data: {statsErr}
            </div>
          )}

          {/* KPI cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:20}}>
            <div className="kpi">
              <div style={{fontSize:12,fontWeight:500,color:'var(--n500)',marginBottom:12}}>Total Assets</div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:30,fontWeight:500,color:'var(--n950)',lineHeight:1,marginBottom:8}}>
                {stats ? a.total.toLocaleString() : '—'}
              </div>
              <div style={{fontSize:12,color:'var(--sgt)'}}>
                {stats && a.total > 0 ? `${pct(a.operational, a.total)} operational` : stats ? 'No assets yet' : ''}
              </div>
            </div>
            <div className="kpi">
              <div style={{fontSize:12,fontWeight:500,color:'var(--n500)',marginBottom:12}}>Operational</div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:30,fontWeight:500,color:'var(--n950)',lineHeight:1,marginBottom:8}}>
                {stats ? pct(a.operational, a.total) : '—'}
              </div>
              <div style={{fontSize:12,color:'var(--n500)'}}>
                {stats ? `${a.operational.toLocaleString()} of ${a.total.toLocaleString()} assets` : ''}
              </div>
            </div>
            <div className="kpi">
              <div style={{fontSize:12,fontWeight:500,color:'var(--n500)',marginBottom:12}}>Open Work Orders</div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:30,fontWeight:500,color:'var(--n950)',lineHeight:1,marginBottom:8}}>
                {stats ? w.open : '—'}
              </div>
              <div style={{fontSize:12,color:'var(--srt)'}}>
                {stats ? `${w.overdue} overdue · ${w.critical} critical` : ''}
              </div>
            </div>
            <div className="kpi">
              <div style={{fontSize:12,fontWeight:500,color:'var(--n500)',marginBottom:12}}>Overdue PM</div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:30,fontWeight:500,color:stats?.overduePM>0?'var(--sat)':'var(--n950)',lineHeight:1,marginBottom:8}}>
                {stats ? stats.overduePM : '—'}
              </div>
              <div style={{fontSize:12,color:stats?.overduePM>0?'var(--sat)':'var(--n500)'}}>
                {stats ? (stats.overduePM === 0 ? 'All tasks on schedule' : `task${stats.overduePM!==1?'s':''} past due date`) : ''}
              </div>
            </div>
            <div className="kpi">
              <div style={{fontSize:12,fontWeight:500,color:'var(--n500)',marginBottom:12}}>Compliance Alerts</div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:30,fontWeight:500,color:complianceCounts&&(complianceCounts.expiring+complianceCounts.expired)>0?'var(--srt)':'var(--n950)',lineHeight:1,marginBottom:8}}>
                {complianceCounts ? complianceCounts.expiring + complianceCounts.expired : '—'}
              </div>
              <div style={{fontSize:12,color:complianceCounts&&complianceCounts.expired>0?'var(--srt)':'var(--n500)'}}>
                {complianceCounts ? `${complianceCounts.expired} expired · ${complianceCounts.expiring} expiring` : ''}
              </div>
            </div>
          </div>

          {/* Main grid */}
          <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:16,marginBottom:16}}>
            {/* Health donut */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:20,boxShadow:'var(--sh-sm)'}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:16}}>Network Health</div>
              <div style={{position:'relative',width:140,height:140,margin:'0 auto 16px'}}>
                <svg viewBox="0 0 140 140" width="140" height="140">
                  <circle cx="70" cy="70" r="54" fill="none" stroke="var(--n200)" strokeWidth="14"/>
                  {a && a.total > 0 && (
                    <>
                      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sg)"
                        strokeWidth="14"
                        strokeDasharray={`${opArc} ${C - opArc}`}
                        strokeLinecap="round" transform="rotate(-90 70 70)"/>
                      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sa)"
                        strokeWidth="14"
                        strokeDasharray={`${attArc} ${C - attArc}`}
                        strokeDashoffset={-opArc}
                        transform="rotate(-90 70 70)"/>
                      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sr)"
                        strokeWidth="14"
                        strokeDasharray={`${critArc} ${C - critArc}`}
                        strokeDashoffset={-(opArc + attArc)}
                        transform="rotate(-90 70 70)"/>
                    </>
                  )}
                </svg>
                <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                  <span style={{fontFamily:'var(--ff-m)',fontSize:28,fontWeight:500,color:'var(--n950)',lineHeight:1}}>
                    {stats ? a.avgHealth : '—'}
                  </span>
                  <span style={{fontSize:11,color:'var(--n500)'}}>Health Score</span>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {[
                  {c:'var(--sg)',cc:'var(--sgt)',l:'Operational',    v: a ? `${a.operational} · ${pct(a.operational, a.total)}` : '—'},
                  {c:'var(--sa)',cc:'var(--sat)',l:'Attention Req.',  v: a ? `${a.attention} · ${pct(a.attention, a.total)}`    : '—'},
                  {c:'var(--sr)',cc:'var(--srt)',l:'Critical',        v: a ? `${a.critical} · ${pct(a.critical, a.total)}`      : '—'},
                  {c:'var(--n300)',cc:'var(--n500)',l:'Offline',      v: a ? `${a.offline} · ${pct(a.offline, a.total)}`        : '—'},
                ].map(row => (
                  <div key={row.l} style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12}}>
                    <span style={{display:'flex',alignItems:'center',gap:6,color:row.cc}}>
                      <span style={{width:10,height:10,background:row.c,borderRadius:'50%',display:'inline-block',flexShrink:0}}/>
                      {row.l}
                    </span>
                    <span style={{fontFamily:'var(--ff-m)',fontWeight:500}}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Active Alerts — live merge of overdue PM, expiring licences, critical WOs, offline devices */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Active Alerts</div>
                {alerts && alerts.length > 0 && (
                  <span style={{background:'var(--srb)',color:'var(--srt)',fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:999,border:'1px solid var(--srbr)'}}>{alerts.length}</span>
                )}
              </div>
              {alerts === null ? (
                <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontSize:13,color:'var(--n400)'}}>Loading…</div>
              ) : alerts.length === 0 ? (
                <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,gap:8}}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7L12 2Z" stroke="var(--n300)" strokeWidth="1.5" fill="none"/></svg>
                  <div style={{fontSize:13,fontWeight:500,color:'var(--n400)'}}>No active alerts</div>
                  <div style={{fontSize:12,color:'var(--n300)',textAlign:'center'}}>Overdue PM, expiring licences, critical work orders, and offline devices will appear here.</div>
                </div>
              ) : (
                <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                  {alerts.map(al => {
                    const sev = ALERT_SEVERITY_STYLE[al.severity] || ALERT_SEVERITY_STYLE.low
                    return (
                      <div key={al.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 16px'}}>
                        <span style={{width:8,height:8,borderRadius:'50%',background:sev.c,marginTop:5,flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,color:'var(--n800)',fontWeight:500}}>{al.title}</div>
                          {al.subtitle && <div style={{fontSize:11,color:'var(--n500)'}}>{al.subtitle}</div>}
                        </div>
                        <span style={{fontSize:10,color:sev.c,fontFamily:'var(--ff-m)',whiteSpace:'nowrap'}}>{alertAtLabel(al.at)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Bottom row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 360px',gap:16}}>
            {/* Recent Work Orders — live */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',overflow:'hidden'}}>
              <div style={{padding:'14px 20px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Recent Work Orders</div>
                <button style={{border:'none',background:'none',fontSize:13,color:'var(--b600)',fontWeight:500,cursor:'pointer',padding:0}}
                  onClick={() => window.location.assign('/work-orders')}>View all →</button>
              </div>
              <div style={{overflowX:'auto'}}>
                {recentWOs.length === 0 ? (
                  <div style={{padding:'32px 20px',textAlign:'center',color:'var(--n400)',fontSize:13}}>
                    {stats ? 'No work orders yet.' : 'Loading…'}
                  </div>
                ) : (
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:'var(--n50)'}}>
                        {['WO Ref','Description','Assignee','Status','Priority','Due'].map(h=>(
                          <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentWOs.map(wo => {
                        const due = slaDueLabel(wo.sla_due)
                        return (
                          <tr key={wo.ref} style={{borderBottom:'var(--bdr)'}}>
                            <td style={{padding:'10px 12px',fontFamily:'var(--ff-m)',fontSize:12,color:'var(--b700)',fontWeight:500,whiteSpace:'nowrap'}}>{wo.ref}</td>
                            <td style={{padding:'10px 12px'}}>
                              <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{wo.title}</div>
                              <div style={{fontSize:11,color:'var(--n500)'}}>{wo.site?.name || '—'}</div>
                            </td>
                            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                              {wo.assignee ? (
                                <div style={{display:'flex',alignItems:'center',gap:6}}>
                                  <div style={{width:24,height:24,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,color:'#fff',flexShrink:0}}>{initialsOf(wo.assignee.full_name)}</div>
                                  <span style={{fontSize:12,color:'var(--n700)'}}>{wo.assignee.full_name}</span>
                                </div>
                              ) : <span style={{fontSize:12,color:'var(--n400)'}}>Unassigned</span>}
                            </td>
                            <td style={{padding:'10px 12px'}}><span className={`badge badge-${woStatusBadge(wo.status)}`}>{WO_STATUS_LABEL[wo.status]}</span></td>
                            <td style={{padding:'10px 12px'}}><span className={`badge badge-${woPrioBadge(wo.priority)}`}>{WO_PRIORITY_LABEL[wo.priority]}</span></td>
                            <td style={{padding:'10px 12px',textAlign:'right',fontFamily:'var(--ff-m)',fontSize:11,color:due.color,whiteSpace:'nowrap'}}>{due.text}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Upcoming Maintenance — live PM tasks due in the next 14 days */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Upcoming Maintenance</div>
                <button style={{border:'none',background:'none',fontSize:13,color:'var(--b600)',fontWeight:500,cursor:'pointer',padding:0}}
                  onClick={() => window.location.assign('/maintenance')}>Schedule →</button>
              </div>
              {upcomingPM === null ? (
                <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontSize:13,color:'var(--n400)'}}>Loading…</div>
              ) : upcomingPM.length === 0 ? (
                <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,gap:8}}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="var(--n300)" strokeWidth="1.5"/><path d="M3 9h18M8 2v4M16 2v4" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <div style={{fontSize:13,fontWeight:500,color:'var(--n400)'}}>No PM due in the next 14 days</div>
                  <div style={{fontSize:12,color:'var(--n300)',textAlign:'center'}}>Preventive maintenance tasks due soon will appear here.</div>
                </div>
              ) : (
                <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                  {upcomingPM.map(t => {
                    const due = pmDueLabel(t.due_date)
                    return (
                      <div key={t.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'8px 16px'}}>
                        <div style={{minWidth:0}}>
                          <div style={{fontSize:12,color:'var(--n800)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div>
                          <div style={{fontSize:11,color:'var(--n500)'}}>{t.asset?.name || t.site?.name || '—'}</div>
                        </div>
                        <span style={{fontSize:11,color:due.color,fontFamily:'var(--ff-m)',whiteSpace:'nowrap'}}>{due.text}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
