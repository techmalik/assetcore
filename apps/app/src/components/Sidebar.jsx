import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { can, ROLE_LABELS, ADMIN_ENTRY_CAPS } from '../lib/rbac'
import { useSidebar } from '../lib/SidebarContext'
import { useNotifications } from '../lib/NotificationsContext'
import { getDashboardStats } from '../lib/db/dashboard'

// 99+ once a count exceeds two digits, so the pill never has to grow to fit.
const capCount = (n) => (n > 99 ? '99+' : String(n))

const icons = {
  dashboard: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" fill="var(--b100)"/></svg>,
  assets: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 7h10M3 10h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  workorders: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6h4M6 9h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  maintenance: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="4" width="10" height="9" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M5 4V3a1 1 0 012 0v1M9 4V3a1 1 0 012 0v1" stroke="currentColor" strokeWidth="1.3"/></svg>,
  inspections: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2l1 3h3.2l-2.6 1.9 1 3L8 8.2 5.4 9.9l1-3L3.8 5H7L8 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  compliance: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  reports: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 13V5l6-3 6 3v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><rect x="6" y="9" width="4" height="4" rx=".5" stroke="currentColor" strokeWidth="1.2"/></svg>,
  devices: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5 8h.01M5 11h.01M8 8h3M8 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  integrations: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M6 8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M4 4V3M4 13v-1M12 4V3M12 13v-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
  notifications: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2a4 4 0 00-4 4v3l-1 1v.5h10V10l-1-1V6a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.3"/><path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3"/></svg>,
  users: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  settings: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/><path d="M6.8 2.1l-.5 1.5A4.6 4.6 0 005 4.4L3.5 4l-1.2 2 1.1 1.1a4.5 4.5 0 000 1.8L2.3 10l1.2 2 1.5-.4A4.6 4.6 0 006.3 12.4l.5 1.5h2.4l.5-1.5A4.6 4.6 0 0011 11.6l1.5.4 1.2-2-1.1-1.1a4.5 4.5 0 000-1.8l1.1-1.1-1.2-2-1.5.4A4.6 4.6 0 009.7 3.6L9.2 2.1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
}

const OPERATIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: icons.dashboard },
  { key: 'assets', label: 'Assets', path: '/assets', icon: icons.assets },
  { key: 'work-orders', label: 'Work Orders', path: '/work-orders', icon: icons.workorders },
  { key: 'inspections', label: 'Inspections', path: '/inspections', icon: icons.inspections },
  { key: 'maintenance', label: 'Maintenance', path: '/maintenance', icon: icons.maintenance },
  { key: 'compliance', label: 'Compliance', path: '/compliance', icon: icons.compliance },
  { key: 'reports', label: 'Reports', path: '/reports', icon: icons.reports },
  { key: 'devices', label: 'Devices', path: '/devices', icon: icons.devices },
]

export default function Sidebar({ active }) {
  const nav = useNavigate()
  const { org, fullName, initials, roleKey } = useAuth()
  const { isOpen, close, collapsed, toggleCollapsed } = useSidebar()
  const { unreadCount } = useNotifications()
  const canAdmin = ADMIN_ENTRY_CAPS.some((c) => can(roleKey, c))
  const [orgMenu, setOrgMenu] = useState(false)
  const orgRef = useRef(null)
  const [openWOCount, setOpenWOCount] = useState(0)

  // Sidebar remounts on every page navigation (each page renders its own
  // <Sidebar/>), so a mount-time fetch is already reasonably fresh without
  // needing its own poll loop — unlike NotificationsContext, which is a
  // single top-level provider that persists across navigation.
  useEffect(() => {
    let cancelled = false
    getDashboardStats().then((s) => { if (!cancelled) setOpenWOCount(s?.wos?.open ?? 0) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!orgMenu) return
    const onDown = (e) => { if (orgRef.current && !orgRef.current.contains(e.target)) setOrgMenu(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOrgMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [orgMenu])

  const go = (path) => { nav(path); close() }
  const goMenu = (path) => { setOrgMenu(false); go(path) }

  const NavItem = ({ item, count, countColor }) => (
    <div className={`nav-item${active === item.key ? ' active' : ''}`} onClick={() => go(item.path)} title={item.label}>
      {item.icon}<span className="nav-label">{item.label}</span>
      {count > 0 && (
        <span className="nav-badge" style={{
          marginLeft: 'auto', minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
          background: countColor === 'red' ? 'var(--srb)' : 'var(--sab)',
          color: countColor === 'red' ? 'var(--srt)' : 'var(--sat)',
          border: `1px solid ${countColor === 'red' ? 'var(--srbr)' : 'var(--sabr)'}`,
          fontSize: 10, fontWeight: 600, lineHeight: '14px', textAlign: 'center', flexShrink: 0,
        }}>
          {capCount(count)}
        </span>
      )}
    </div>
  )
  const orgMenuItem = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: 'none', border: 'none', fontFamily: 'var(--ff-u)', fontSize: 13, color: 'var(--n700)', cursor: 'pointer', textAlign: 'left' }

  return (
    <>
      {isOpen && <div onClick={close} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:99,display:'none'}} className="sidebar-overlay"/>}
    <aside className={`sidebar${isOpen ? ' sidebar--mobile-open' : ''}${collapsed ? ' collapsed' : ''}`}>
      <div ref={orgRef} style={{position:'relative',flexShrink:0}}>
        <button className="sidebar-header" onClick={() => setOrgMenu((o) => !o)} title={org?.name || ''} aria-haspopup="menu" aria-expanded={orgMenu}
          style={{width:'100%',padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8,background:orgMenu?'var(--n50)':'var(--n0)',border:'none',cursor:'pointer',fontFamily:'var(--ff-u)'}}>
          <div style={{width:28,height:28,background:'var(--b800)',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <span style={{fontFamily:'var(--ff-m)',fontSize:10,fontWeight:700,color:'var(--b200)'}}>{(org?.short_name || org?.name || '?').slice(0,2).toUpperCase()}</span>
          </div>
          <div className="sidebar-orginfo" style={{flex:1,minWidth:0,textAlign:'left'}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--n900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{org?.short_name || '—'}</div>
            <div style={{fontSize:10,color:'var(--n500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{org?.name || ''}</div>
          </div>
          <svg className="sidebar-orgchevron" width="12" height="12" viewBox="0 0 12 12" fill="none" style={{flexShrink:0,transition:'transform .15s',transform:orgMenu?'rotate(180deg)':'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>

        {orgMenu && (
          <div role="menu" style={{position:'absolute',top:'calc(100% - 2px)',left:8,right:8,minWidth:200,background:'var(--n0)',border:'var(--bdr)',borderRadius:10,boxShadow:'var(--sh-lg)',zIndex:70,overflow:'hidden'}}>
            <div style={{padding:'12px 14px',borderBottom:'var(--bdr)'}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>{org?.name || '—'}</div>
              <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>Organisation workspace</div>
            </div>
            <div style={{padding:'6px 0'}}>
              {canAdmin && (
                <button role="menuitem" style={orgMenuItem} onClick={() => goMenu('/admin')}
                  onMouseEnter={(e)=>e.currentTarget.style.background='var(--n50)'} onMouseLeave={(e)=>e.currentTarget.style.background='none'}>
                  {icons.users} Organisation admin
                </button>
              )}
              <button role="menuitem" style={orgMenuItem} onClick={() => goMenu('/settings')}
                onMouseEnter={(e)=>e.currentTarget.style.background='var(--n50)'} onMouseLeave={(e)=>e.currentTarget.style.background='none'}>
                {icons.settings} Settings
              </button>
            </div>
          </div>
        )}
      </div>

      <nav style={{flex:1,padding:'8px 0',overflowY:'auto'}}>
        <div className="sidebar-section" style={{padding:'12px 16px 4px',fontSize:10,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--n400)',fontFamily:'var(--ff-m)'}}>Operations</div>

        {OPERATIONS.map((item) => (
          <NavItem key={item.key} item={item} count={item.key === 'work-orders' ? openWOCount : undefined} countColor="amber" />
        ))}

        <div style={{height:1,background:'var(--n200)',margin:'8px 16px'}}/>

        <NavItem item={{ key: 'notifications', label: 'Notifications', path: '/notifications', icon: icons.notifications }} count={unreadCount} countColor="red" />
        {canAdmin && <NavItem item={{ key: 'admin', label: 'Admin', path: '/admin', icon: icons.users }} />}
        <NavItem item={{ key: 'integrations', label: 'Integrations', path: '/integrations', icon: icons.integrations }} />
        <NavItem item={{ key: 'settings', label: 'Settings', path: '/settings', icon: icons.settings }} />
      </nav>

      <button className="sidebar-collapse-btn" onClick={toggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <svg className="sidebar-collapse-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span className="sidebar-collapse-label">Collapse</span>
      </button>

      <div className="sidebar-footer" style={{borderTop:'var(--bdr)',padding:'12px 16px',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <div style={{width:28,height:28,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:'#fff',flexShrink:0}}>{initials}</div>
        <div className="sidebar-userinfo" style={{minWidth:0}}>
          <div style={{fontSize:12,fontWeight:500,color:'var(--n900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fullName || '—'}</div>
          <div style={{fontSize:10,color:'var(--n500)'}}>{ROLE_LABELS[roleKey] || ''}</div>
        </div>
      </div>
    </aside>
    </>
  )
}
