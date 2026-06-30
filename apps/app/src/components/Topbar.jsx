import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useNotifications } from '../lib/NotificationsContext'
import { useSidebar } from '../lib/SidebarContext'

export default function Topbar({ breadcrumb, dark, toggleDark, children }) {
  const nav = useNavigate()
  const { org, initials, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const { toggle } = useSidebar()

  return (
    <header style={{background:'var(--n0)',borderBottom:'var(--bdr)',flexShrink:0,zIndex:40}}>
      <div style={{height:52,display:'flex',alignItems:'center',padding:'0 24px',gap:16}}>
        {/* Hamburger — visible only on mobile via CSS */}
        <button onClick={toggle} className="sidebar-hamburger" style={{display:'none',width:32,height:32,border:'1px solid var(--n200)',borderRadius:6,background:'var(--n0)',alignItems:'center',justifyContent:'center',color:'var(--n600)',flexShrink:0,cursor:'pointer'}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>
        <nav style={{display:'flex',alignItems:'center',gap:4,fontSize:13,flex:1}}>
          <span style={{color:'var(--n400)'}}>{org?.short_name || org?.name || '—'}</span>
          <span style={{color:'var(--n300)',margin:'0 2px'}}>/</span>
          <span style={{color:'var(--n900)',fontWeight:500}}>{breadcrumb}</span>
        </nav>

        <div style={{position:'relative',width:260}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}>
            <circle cx="7" cy="7" r="4.5" stroke="var(--n400)" strokeWidth="1.3"/>
            <path d="M10 10l2.5 2.5" stroke="var(--n400)" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input placeholder="Search assets, work orders… ⌘K" style={{width:'100%',height:32,border:'1px solid var(--n200)',borderRadius:4,padding:'0 12px 0 30px',fontFamily:'var(--ff-u)',fontSize:13,color:'var(--n900)',background:'var(--n50)',outline:'none'}}/>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <div style={{position:'relative'}}>
            <button onClick={() => nav('/notifications')} style={{width:32,height:32,border:'1px solid var(--n200)',borderRadius:6,background:'var(--n0)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--n600)'}}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a4 4 0 00-4 4v3l-1 1v.5h10V10l-1-1V6a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.3"/><path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3"/></svg>
            </button>
            {unreadCount > 0 && (
              <span style={{position:'absolute',top:-3,right:-3,minWidth:16,height:16,background:'var(--sr)',color:'#fff',fontSize:9,fontWeight:700,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid var(--n0)',padding:'0 3px'}}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          <button onClick={toggleDark} title="Toggle dark mode" style={{width:32,height:32,border:'1px solid var(--n200)',borderRadius:6,background:'var(--n0)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--n600)'}}>
            {dark
              ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M8 2v1M8 13v1M2 8h1M13 8h1M3.8 3.8l.7.7M11.5 11.5l.7.7M3.8 12.2l.7-.7M11.5 4.5l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 3.5A5.5 5.5 0 103.5 11 5.5 5.5 0 0011 3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>
            }
          </button>

          <button onClick={signOut} title="Sign out" style={{width:32,height:32,border:'1px solid var(--n200)',borderRadius:6,background:'var(--n0)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--n600)',cursor:'pointer'}}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 2H3.5A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div style={{width:32,height:32,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:'#fff',cursor:'pointer'}}>{initials}</div>
        </div>
      </div>
      {children}
    </header>
  )
}
