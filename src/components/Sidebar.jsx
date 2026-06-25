import { useNavigate, useLocation } from 'react-router-dom'

const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text>
  </svg>
)

const icons = {
  dashboard: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/></svg>,
  assets: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 7h10M3 10h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  workorders: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6h4M6 9h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  maintenance: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="4" width="10" height="9" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M5 4V3a1 1 0 012 0v1M9 4V3a1 1 0 012 0v1" stroke="currentColor" strokeWidth="1.3"/></svg>,
  inspections: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2l1 3h3.2l-2.6 1.9 1 3L8 8.2 5.4 9.9l1-3L3.8 5H7L8 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  compliance: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  reports: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 13V5l6-3 6 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><rect x="6" y="9" width="4" height="4" rx=".5" stroke="currentColor" strokeWidth="1.2"/></svg>,
  notifications: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2a4 4 0 00-4 4v3l-1 1v.5h10V10l-1-1V6a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.3"/><path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3"/></svg>,
  users: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  settings: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M6.8 2.1l-.5 1.5A4.6 4.6 0 005 4.4L3.5 4l-1.2 2 1.1 1.1a4.5 4.5 0 000 1.8L2.3 10l1.2 2 1.5-.4A4.6 4.6 0 006.3 12.4l.5 1.5h2.4l.5-1.5A4.6 4.6 0 0011 11.6l1.5.4 1.2-2-1.1-1.1a4.5 4.5 0 000-1.8l1.1-1.1-1.2-2-1.5.4A4.6 4.6 0 009.7 3.6L9.2 2.1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
}

export default function Sidebar({ active }) {
  const nav = useNavigate()

  const go = (path) => nav(path)

  return (
    <aside className="sidebar">
      <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:'8px',flexShrink:0}}>
        <div style={{width:28,height:28,background:'var(--b800)',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          <span style={{fontFamily:'var(--ff-m)',fontSize:10,fontWeight:700,color:'var(--b200)'}}>NG</span>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:'var(--n900)'}}>NGML</div>
          <div style={{fontSize:10,color:'var(--n500)'}}>Nigeria Gas Marketing Ltd</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </div>

      <nav style={{flex:1,padding:'8px 0',overflowY:'auto'}}>
        <div style={{padding:'12px 16px 4px',fontSize:10,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--n400)',fontFamily:'var(--ff-m)'}}>Operations</div>

        <div className={`nav-item${active==='dashboard'?' active':''}`} onClick={() => go('/dashboard')}>
          {icons.dashboard} Dashboard
        </div>
        <div className={`nav-item${active==='assets'?' active':''}`} onClick={() => go('/assets')}>
          {icons.assets} Assets
          <span className="nav-badge" style={{background:'var(--n200)',color:'var(--n600)'}}>2,847</span>
        </div>
        <div className={`nav-item${active==='work-orders'?' active':''}`} onClick={() => go('/work-orders')}>
          {icons.workorders} Work Orders
          <span className="nav-badge" style={{background:'var(--sab)',color:'var(--sat)'}}>143</span>
        </div>
        <div className={`nav-item${active==='maintenance'?' active':''}`} onClick={() => go('/maintenance')}>
          {icons.maintenance} Maintenance
        </div>
        <div className={`nav-item${active==='inspections'?' active':''}`} onClick={() => go('/maintenance')}>
          {icons.inspections} Inspections
        </div>
        <div className={`nav-item${active==='compliance'?' active':''}`} onClick={() => go('/maintenance')}>
          {icons.compliance} Compliance
          <span className="nav-badge" style={{background:'var(--srb)',color:'var(--srt)'}}>7</span>
        </div>
        <div className={`nav-item${active==='reports'?' active':''}`} onClick={() => go('/reports')}>
          {icons.reports} Reports
        </div>

        <div style={{height:1,background:'var(--n200)',margin:'8px 16px'}}/>

        <div className={`nav-item${active==='notifications'?' active':''}`} onClick={() => go('/notifications')}>
          {icons.notifications} Notifications
          <span className="nav-badge" style={{background:'var(--sr)',color:'#fff'}}>5</span>
        </div>
        <div className={`nav-item${active==='admin'?' active':''}`} onClick={() => go('/admin')}>
          {icons.users} Users & Roles
        </div>
        <div className="nav-item">
          {icons.settings} Settings
        </div>
      </nav>

      <div style={{borderTop:'var(--bdr)',padding:'12px 16px',display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:28,height:28,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:'#fff'}}>AO</div>
        <div>
          <div style={{fontSize:12,fontWeight:500,color:'var(--n900)'}}>Adaeze Okeke</div>
          <div style={{fontSize:10,color:'var(--n500)'}}>Ops Manager</div>
        </div>
      </div>
    </aside>
  )
}
