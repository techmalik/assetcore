import { useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { getDashboardStats, getRecentWorkOrders } from '../lib/db/dashboard.js'
import { getComplianceLicenceCounts } from '../lib/db/complianceLicences.js'

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

  useEffect(() => {
    Promise.all([getDashboardStats(), getRecentWorkOrders()])
      .then(([s, wos]) => { setStats(s); setRecentWOs(wos) })
      .catch(e => setStatsErr(e.message))
    getComplianceLicenceCounts().then(setComplianceCounts).catch(() => {})
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
          <div style={{display:'grid',gridTemplateColumns:'280px 1fr 300px',gap:16,marginBottom:16}}>
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

            {/* Asset Network Map — static visual */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-sm)'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Asset Network Map</div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <select style={{height:26,border:'1px solid var(--n200)',borderRadius:3,padding:'0 6px',fontSize:12,color:'var(--n600)',background:'var(--n0)'}}>
                    <option>All Types</option><option>Metering</option><option>Compressor</option>
                  </select>
                  <button style={{height:26,padding:'0 10px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:12,color:'var(--n700)'}}>Map →</button>
                </div>
              </div>
              <div style={{position:'relative',height:320,background:'oklch(95% 0.015 160)',overflow:'hidden'}}>
                <svg style={{position:'absolute',inset:0,width:'100%',height:'100%'}} viewBox="0 0 600 320" preserveAspectRatio="none">
                  <defs><pattern id="netgrid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="oklch(90% 0.012 160)" strokeWidth="1"/></pattern></defs>
                  <rect x="0" y="0" width="600" height="320" fill="url(#netgrid)"/>
                  <path d="M80 200 L180 160 L310 140 L420 100 L520 120" stroke="oklch(60% 0.04 145)" strokeWidth="2" fill="none" strokeDasharray="6 3" opacity=".5"/>
                  <path d="M180 160 L200 240 L300 260" stroke="oklch(60% 0.04 145)" strokeWidth="2" fill="none" strokeDasharray="6 3" opacity=".5"/>
                  <path d="M310 140 L330 200 L380 220 L440 200" stroke="oklch(60% 0.04 145)" strokeWidth="2" fill="none" strokeDasharray="6 3" opacity=".5"/>
                </svg>
                {[
                  {l:'13%',t:'62%',c:'var(--sr)',label:'MTR-0042'},
                  {l:'30%',t:'50%',c:'var(--sa)',label:'CMP-0017'},
                  {l:'52%',t:'43%',c:'var(--sg)',label:null},
                  {l:'70%',t:'37%',c:'var(--sg)',label:null},
                ].map((m,i) => (
                  <div key={i} style={{position:'absolute',left:m.l,top:m.t,transform:'translate(-50%,-100%)'}}>
                    <div style={{width:24,height:24,background:m.c,borderRadius:'50% 50% 50% 0',transform:'rotate(-45deg)',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,0,0,.2)'}}>
                      <div style={{transform:'rotate(45deg)',width:8,height:8,background:'#fff',borderRadius:'50%'}}/>
                    </div>
                    {m.label && <div style={{marginTop:4,background:'var(--n950)',color:'#fff',fontSize:9,fontFamily:'var(--ff-m)',padding:'2px 5px',borderRadius:2,whiteSpace:'nowrap',transform:'translateX(-30%)'}}>{m.label}</div>}
                  </div>
                ))}
                <div style={{position:'absolute',bottom:10,left:12,background:'rgba(255,255,255,.92)',border:'1px solid var(--n200)',borderRadius:4,padding:'6px 8px',display:'flex',gap:10}}>
                  {[{c:'var(--sg)',cc:'var(--sgt)',l:'Operational'},{c:'var(--sa)',cc:'var(--sat)',l:'Attention'},{c:'var(--sr)',cc:'var(--srt)',l:'Critical'}].map(i=>(
                    <span key={i.l} style={{fontSize:10,color:i.cc,display:'flex',alignItems:'center',gap:4}}>
                      <span style={{width:8,height:8,background:i.c,borderRadius:'50%'}}/>
                      {i.l}
                    </span>
                  ))}
                </div>
                {[{l:'13%',t:'78%',n:'Lagos'},{l:'30%',t:'68%',n:'Delta'},{l:'52%',t:'60%',n:'North'},{l:'70%',t:'53%',n:'Warri'},{l:'83%',t:'70%',n:'Aba'}].map(r=>(
                  <div key={r.n} style={{position:'absolute',top:r.t,left:r.l,fontSize:10,fontWeight:600,color:'rgba(0,0,0,.35)',letterSpacing:'.05em',textTransform:'uppercase',fontFamily:'var(--ff-m)'}}>{r.n}</div>
                ))}
              </div>
            </div>

            {/* Active Alerts — Phase 2 stub */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Active Alerts</div>
                <span style={{background:'var(--n100)',color:'var(--n500)',fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:999,border:'1px solid var(--n200)'}}>Phase 2</span>
              </div>
              <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,gap:8}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7L12 2Z" stroke="var(--n300)" strokeWidth="1.5" fill="none"/></svg>
                <div style={{fontSize:13,fontWeight:500,color:'var(--n400)'}}>Alerts coming in Phase 2</div>
                <div style={{fontSize:12,color:'var(--n300)',textAlign:'center'}}>Real-time notifications, SCADA alerts, and compliance warnings will appear here.</div>
              </div>
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

            {/* Upcoming Maintenance — Phase 2 stub */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Upcoming Maintenance</div>
                <button style={{border:'none',background:'none',fontSize:13,color:'var(--b600)',fontWeight:500,cursor:'pointer',padding:0}}>Schedule →</button>
              </div>
              <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,gap:8}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="var(--n300)" strokeWidth="1.5"/><path d="M3 9h18M8 2v4M16 2v4" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                <div style={{fontSize:13,fontWeight:500,color:'var(--n400)'}}>PM Schedules in Phase 2</div>
                <div style={{fontSize:12,color:'var(--n300)',textAlign:'center'}}>Preventive maintenance schedules and auto-generated work orders coming next.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
