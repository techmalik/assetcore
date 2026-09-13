import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { useLocationFilter } from '../lib/LocationFilterContext'
import { getDashboardStats, getRecentWorkOrders, getDashboardAlerts } from '../lib/db/dashboard.js'
import { getPmCompliance } from '../lib/db/complianceLicences.js'
import { listPMTasks } from '../lib/db/pmTasks.js'
import { WO_STATUS_LABEL, WO_PRIORITY_LABEL, woStatusStyle, WO_PRIORITY_STYLE } from '../lib/db/workOrders.js'
import { errorText } from '../lib/errors'
import { useMoney } from '../lib/money'

const ALERT_SEVERITY_STYLE = {
  critical: { c: 'var(--srt)', bg: 'var(--srb)' },
  high:     { c: 'var(--srt)', bg: 'var(--srb)' },
  medium:   { c: 'var(--sat)', bg: 'var(--sab)' },
  low:      { c: 'var(--n500)', bg: 'var(--n100)' },
}

const ALERT_KIND_HREF = {
  pm_overdue: '/maintenance?filter=overdue',
  licence_expiring: '/compliance?filter=alerts',
  licence_expired: '/compliance?filter=alerts',
  wo_critical: '/work-orders?status=open',
  device_offline: '/devices',
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

function initialsOf(name) {
  if (!name) return '?'
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase()
}

// Time of day from the viewer's own clock — a greeting is about where they are.
function greetingFor(date) {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// fullName falls back to the email when a profile has no name; greet by the
// part before the @ rather than the whole address.
function firstNameOf(fullName) {
  if (!fullName) return ''
  const base = fullName.includes('@') ? fullName.split('@')[0] : fullName
  return base.trim().split(/\s+/)[0]
}

const cardIcons = {
  box: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2.5l6.5 3.6v7.8L10 17.5l-6.5-3.6V6.1L10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M3.5 6.1L10 9.7l6.5-3.6M10 9.7v7.8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  wrench: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.6 3.2a4 4 0 00-4.9 5.3l-5 5a1.6 1.6 0 002.3 2.3l5-5a4 4 0 005.3-4.9l-2.4 2.4-2.1-.4-.4-2.1 2.2-2.6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2.5l6 2.4v4.6c0 3.7-2.6 6.4-6 7.6-3.4-1.2-6-3.9-6-7.6V4.9l6-2.4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M7.3 10l1.9 1.9 3.6-3.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  trendDown: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2.5 6l5.5 5.5 3-3 6.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 15h4.5v-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  docCheck: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M11.5 2.5H6A1.5 1.5 0 004.5 4v12A1.5 1.5 0 006 17.5h8a1.5 1.5 0 001.5-1.5V6.5l-4-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M11.5 2.5v4h4M7.5 11.5l1.8 1.8 3.2-3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  pin: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 17.5s5.5-5 5.5-9a5.5 5.5 0 00-11 0c0 4 5.5 9 5.5 9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="10" cy="8.4" r="2" stroke="currentColor" strokeWidth="1.5"/></svg>,
  xCircle: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/><path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  warn: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3l7.5 13.5h-15L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M10 8.2v3.6M10 14v.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  calendarClock: <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M9 16.5H4.5A1.5 1.5 0 013 15V5.5A1.5 1.5 0 014.5 4h10A1.5 1.5 0 0116 5.5V9M3 8h13M6.5 2.5v3M12.5 2.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="14" cy="14" r="3.5" stroke="currentColor" strokeWidth="1.5"/><path d="M14 12.4V14l1 .9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
}

// Accents are per card, not per meaning: nine cards need nine hues to be told
// apart at a glance, and status colour is still carried by the figures inside.
const ACCENT = {
  blue: 'oklch(60% .15 255)', purple: 'oklch(58% .17 300)', amber: 'oklch(72% .16 72)',
  green: 'oklch(62% .16 150)', cyan: 'oklch(64% .11 210)', pink: 'oklch(62% .19 350)',
  red: 'oklch(58% .2 27)', orange: 'oklch(68% .17 50)', violet: 'oklch(60% .14 285)',
}

function StatCard({ label, value, sub, pill, accent, icon, href, nav }) {
  const clickable = Boolean(href)
  const go = () => clickable && nav(href)
  return (
    <div className={`stat-card${clickable ? ' kpi-link' : ''}`} style={{ '--accent': accent }}
      role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
      onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') go() }}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-main">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-icon" aria-hidden="true">{icon}</div>
      </div>
      <div className="stat-card-sub">
        <span>{sub}</span>
        {pill && <span className="stat-card-pill">{pill}</span>}
      </div>
    </div>
  )
}

export default function Dashboard({ dark, toggleDark }) {
  const { org, fullName } = useAuth()
  const { money } = useMoney()
  const now = new Date()
  const nav = useNavigate()
  const { locationId: globalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)
  const [stats, setStats] = useState(null)
  const [recentWOs, setRecentWOs] = useState([])
  const [statsErr, setStatsErr] = useState(null)
  const [alerts, setAlerts] = useState(null)
  const [upcomingPM, setUpcomingPM] = useState(null)
  const [pmCompliance, setPmCompliance] = useState(null)

  useEffect(() => {
    Promise.all([getDashboardStats({ locationId: globalLocationId }), getRecentWorkOrders({ locationId: globalLocationId })])
      .then(([s, wos]) => { setStats(s); setRecentWOs(wos) })
      .catch(e => setStatsErr(errorText(e, 'Could not load the dashboard figures.')))
    getPmCompliance().then(setPmCompliance).catch(() => {})
    getDashboardAlerts({ locationId: globalLocationId }).then(setAlerts).catch(() => setAlerts([]))
    const today = new Date().toISOString().slice(0, 10)
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    listPMTasks({ statuses: ['pending', 'in_progress'], dueAfter: today, dueBefore: in14, limit: 10 })
      .then(setUpcomingPM).catch(() => setUpcomingPM([]))
  }, [globalLocationId])

  const a = stats?.assets
  const w = stats?.wos
  const hb = a?.healthBands

  // Donut arc math (circumference of r=54 circle ≈ 339.3). Segments are the
  // health bands (>50/31-50/<=30), not the status enum - health_score is
  // what the requirements' color spec is defined against, and a decaying
  // asset should visibly change color on this chart even if nobody has
  // touched its status field. Offline assets are excluded from the arcs
  // entirely (own bucket, shown as the uncovered gray gap) same as before.
  const C = 339.3
  const goodArc = hb && a.total ? (hb.good / a.total) * C : 0
  const attArc  = hb && a.total ? (hb.attention / a.total) * C : 0
  const critArc = hb && a.total ? (hb.critical / a.total) * C : 0

  return (
    <div className="app-shell">
      <Sidebar active="dashboard"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Dashboard" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflowY:'auto',padding:24}}>
          {/* Page header */}
          <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
            <div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:26,fontWeight:700,letterSpacing:'-.4px',color:'var(--n950)',lineHeight:1.15}}>
                {greetingFor(now)}{firstNameOf(fullName) ? `, ${firstNameOf(fullName)}` : ''}
              </h1>
              <p style={{fontSize:13,color:'var(--n600)',marginTop:4,fontWeight:500}}>
                {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <p style={{fontSize:12.5,color:'var(--n500)',marginTop:2}}>
                {org?.name || 'Loading…'}{globalLocation ? ` · ${globalLocation.name}` : ''}
                {stats && stats.myWork > 0 && (
                  <> · <button onClick={() => nav('/work-orders?assignee=me')} style={{border:'none',background:'none',padding:0,font:'inherit',color:'var(--b600)',cursor:'pointer'}}>
                    {stats.myWork} open item{stats.myWork === 1 ? '' : 's'} assigned to you
                  </button></>
                )}
              </p>
            </div>
            {/* The old "Generate Report" button did nothing and its date range
                select filtered nothing; Export is the working version of both. */}
            <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => nav('/export')}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3M2.5 11.5h9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Export
            </button>
          </div>

          {statsErr && (
            <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,padding:'10px 14px',marginBottom:16,fontSize:13,color:'var(--srt)'}}>
              Failed to load dashboard data: {statsErr}
            </div>
          )}

          {/* Stat cards. A card whose module the viewer cannot read comes
              back null from the API and is left out, rather than showing a
              figure that links to a page they would be turned away from. */}
          {(() => {
            const d = stats?.defects
            const r = stats?.risks
            const lic = stats?.licences
            const p = stats?.portfolio
            const dash = '—'
            const row1 = [
              { key: 'assets', label: 'Total Assets', accent: ACCENT.blue, icon: cardIcons.box, href: '/assets',
                value: stats ? a.total.toLocaleString() : dash,
                sub: stats ? `${a.active.toLocaleString()} active${a.inactive ? ` · ${a.inactive} inactive` : ''}` : '' },
              { key: 'wos', label: 'Work Orders', accent: ACCENT.purple, icon: cardIcons.wrench, href: '/work-orders?status=open',
                value: stats ? w.open : dash,
                sub: stats ? `${w.critical} critical` : '',
                pill: stats && w.overdue > 0 ? `${w.overdue} overdue` : null },
              d !== null && { key: 'defects', label: 'Open Defects', accent: ACCENT.amber, icon: cardIcons.shield, href: '/defects',
                value: d ? d.open : dash, sub: d ? `${d.critical} critical` : '' },
              { key: 'value', label: 'Portfolio Value', accent: ACCENT.green, icon: cardIcons.trendDown,
                href: p?.nbvCents != null ? '/depreciation' : null,
                value: p ? money(p.valueCents) : dash,
                sub: p ? (p.nbvCents != null ? `${money(p.nbvCents)} book value` : 'Purchase value') : '' },
            ].filter(Boolean)
            const row2 = [
              lic !== null && { key: 'licences', label: 'Active Licences', accent: ACCENT.cyan, icon: cardIcons.docCheck,
                href: lic?.alerts > 0 ? '/compliance?filter=alerts' : '/compliance',
                value: lic ? lic.active : dash,
                sub: lic ? (lic.alerts > 0 ? `${lic.alerts} expiring or expired` : 'No alerts') : '' },
              { key: 'geo', label: 'Geotagged', accent: ACCENT.pink, icon: cardIcons.pin, href: '/asset-map',
                value: stats ? a.geotagged : dash, sub: stats ? 'Assets on map' : '' },
              { key: 'overdue', label: 'Overdue WOs', accent: ACCENT.red, icon: cardIcons.xCircle, href: '/work-orders?status=open',
                value: stats ? w.overdue : dash,
                sub: stats ? (w.overdue > 0 ? 'Need immediate action' : 'Nothing past its SLA') : '' },
              r !== null && { key: 'risk', label: 'High Risk Assets', accent: ACCENT.orange, icon: cardIcons.warn, href: '/integrity',
                value: r ? r.highAssets : dash,
                sub: r ? `${r.highRisks} high or extreme risk${r.highRisks === 1 ? '' : 's'} open` : '' },
              { key: 'eol', label: 'Nearing End of Life', accent: ACCENT.violet, icon: cardIcons.calendarClock, href: '/depreciation',
                value: stats ? a.nearingEol : dash,
                sub: stats ? `Within 2 years of end of life${a.pastEol ? ` · ${a.pastEol} past it` : ''}` : '' },
            ].filter(Boolean)
            return (
              <>
                <div className={`stat-row stat-row-${Math.max(row1.length, 2)}`}>
                  {row1.map(({ key, ...c }) => <StatCard key={key} {...c} nav={nav} />)}
                </div>
                <div className={`stat-row stat-row-${Math.min(Math.max(row2.length, 2), 5)}`} style={{ marginBottom: 20 }}>
                  {row2.map(({ key, ...c }) => <StatCard key={key} {...c} nav={nav} />)}
                </div>
              </>
            )
          })()}

          {/* Main grid */}
          <div className="dash-main-grid" style={{display:'grid',gap:16,marginBottom:16}}>
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
                        strokeDasharray={`${goodArc} ${C - goodArc}`}
                        strokeLinecap="round" transform="rotate(-90 70 70)"/>
                      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sa)"
                        strokeWidth="14"
                        strokeDasharray={`${attArc} ${C - attArc}`}
                        strokeDashoffset={-goodArc}
                        transform="rotate(-90 70 70)"/>
                      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sr)"
                        strokeWidth="14"
                        strokeDasharray={`${critArc} ${C - critArc}`}
                        strokeDashoffset={-(goodArc + attArc)}
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
              <div style={{display:'flex',flexDirection:'column',gap:2}}>
                {[
                  {c:'var(--sg)',cc:'var(--sgt)',l:'Healthy',        n: hb?.good,       href:'/assets?health=good'},
                  {c:'var(--sa)',cc:'var(--sat)',l:'Attention Req.', n: hb?.attention,  href:'/assets?health=attention'},
                  {c:'var(--sr)',cc:'var(--srt)',l:'Critical',       n: hb?.critical,   href:'/assets?health=critical'},
                  {c:'var(--n300)',cc:'var(--n500)',l:'Offline / inactive', n: hb?.offline,    href:'/assets?status=offline'},
                ].map(row => (
                  <div key={row.l} role="button" tabIndex={0} onClick={() => nav(row.href)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav(row.href) }}
                    style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12,padding:'4px 6px',margin:'0 -6px',borderRadius:4,cursor:'pointer'}}
                    className="dash-legend-row">
                    <span style={{display:'flex',alignItems:'center',gap:6,color:row.cc}}>
                      <span style={{width:10,height:10,background:row.c,borderRadius:'50%',display:'inline-block',flexShrink:0}}/>
                      {row.l}
                    </span>
                    <span style={{fontFamily:'var(--ff-m)',fontWeight:500}}>{a ? `${row.n ?? 0} · ${pct(row.n ?? 0, a.total)}` : '—'}</span>
                  </div>
                ))}
              </div>
              {pmCompliance && pmCompliance.rate != null && (
                <div role="button" tabIndex={0} onClick={() => nav('/compliance?view=audits')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav('/compliance?view=audits') }}
                  className="dash-legend-row"
                  style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12,padding:'8px 6px 4px',margin:'6px -6px 0',borderTop:'var(--bdr)',cursor:'pointer'}}>
                  <span style={{color:'var(--n600)'}}>PM Compliance (12mo)</span>
                  <span style={{fontFamily:'var(--ff-m)',fontWeight:600,color:pmCompliance.rate>=80?'var(--sgt)':pmCompliance.rate>=50?'var(--sat)':'var(--srt)'}}>
                    {pmCompliance.rate}% on-time
                  </span>
                </div>
              )}
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
                  <div style={{fontSize:12,color:'var(--n400)',textAlign:'center'}}>Overdue PM, expiring licences, critical work orders, and offline devices will appear here.</div>
                </div>
              ) : (
                <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                  {alerts.map(al => {
                    const sev = ALERT_SEVERITY_STYLE[al.severity] || ALERT_SEVERITY_STYLE.low
                    const href = ALERT_KIND_HREF[al.kind] || '/dashboard'
                    return (
                      <div key={al.id} role="button" tabIndex={0} onClick={() => nav(href)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') nav(href) }} className="dash-alert-row"
                        style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 16px',cursor:'pointer'}}>
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
          <div className="dash-bottom-grid" style={{display:'grid',gap:16}}>
            {/* Recent Work Orders — live */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',overflow:'hidden'}}>
              <div style={{padding:'14px 20px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Recent Work Orders</div>
                <button style={{border:'none',background:'none',fontSize:13,color:'var(--b600)',fontWeight:500,cursor:'pointer',padding:0}}
                  onClick={() => nav('/work-orders')}>View all →</button>
              </div>
              <div className="table-scroll">
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
                                  <div style={{width:24,height:24,borderRadius:'50%',background:'var(--b-solid)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,color:'#fff',flexShrink:0}}>{initialsOf(wo.assignee.full_name)}</div>
                                  <span style={{fontSize:12,color:'var(--n700)'}}>{wo.assignee.full_name}</span>
                                </div>
                              ) : <span style={{fontSize:12,color:'var(--n400)'}}>Unassigned</span>}
                            </td>
                            <td style={{padding:'10px 12px'}}><StatusBadge tone={woStatusStyle(wo.status)} label={WO_STATUS_LABEL[wo.status]} size="md" /></td>
                            <td style={{padding:'10px 12px'}}><StatusBadge tone={WO_PRIORITY_STYLE[wo.priority] || WO_PRIORITY_STYLE.low} label={WO_PRIORITY_LABEL[wo.priority]} size="md" /></td>
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
                  onClick={() => nav('/maintenance')}>Schedule →</button>
              </div>
              {upcomingPM === null ? (
                <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontSize:13,color:'var(--n400)'}}>Loading…</div>
              ) : upcomingPM.length === 0 ? (
                <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,gap:8}}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="var(--n300)" strokeWidth="1.5"/><path d="M3 9h18M8 2v4M16 2v4" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <div style={{fontSize:13,fontWeight:500,color:'var(--n400)'}}>No PM due in the next 14 days</div>
                  <div style={{fontSize:12,color:'var(--n400)',textAlign:'center'}}>Preventive maintenance tasks due soon will appear here.</div>
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
