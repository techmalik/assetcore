import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useNotifications } from '../lib/NotificationsContext'
import { useSidebar } from '../lib/SidebarContext'
import { ROLE_LABELS } from '../lib/rbac'

export default function Topbar({ breadcrumb, dark, toggleDark, children }) {
  const nav = useNavigate()
  const { org, initials, fullName, roleKey, user, signOut } = useAuth()
  const { unreadCount } = useNotifications()
  const { toggle } = useSidebar()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  const iconBtn = { width: 32, height: 32, border: '1px solid var(--n200)', borderRadius: 6, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--n600)', cursor: 'pointer' }
  const menuItem = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: 'none', border: 'none', fontFamily: 'var(--ff-u)', fontSize: 13, color: 'var(--n700)', cursor: 'pointer', textAlign: 'left' }

  return (
    <header style={{background:'var(--n0)',borderBottom:'var(--bdr)',flexShrink:0,zIndex:40}}>
      <div style={{height:52,display:'flex',alignItems:'center',padding:'0 24px',gap:16}}>
        {/* Hamburger — visible only on mobile via CSS */}
        <button onClick={toggle} className="sidebar-hamburger" style={{display:'none',width:32,height:32,border:'1px solid var(--n200)',borderRadius:6,background:'var(--n0)',alignItems:'center',justifyContent:'center',color:'var(--n600)',flexShrink:0,cursor:'pointer'}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>
        <nav style={{display:'flex',alignItems:'center',gap:4,fontSize:13,flex:1}}>
          <button onClick={() => nav('/dashboard')} title="Go to dashboard" style={{background:'none',border:'none',padding:0,fontFamily:'var(--ff-u)',fontSize:13,color:'var(--n400)',cursor:'pointer'}} onMouseEnter={(e)=>e.currentTarget.style.color='var(--b600)'} onMouseLeave={(e)=>e.currentTarget.style.color='var(--n400)'}>{org?.short_name || org?.name || '—'}</button>
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
            <button onClick={() => nav('/notifications')} title="Notifications" style={iconBtn}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2a4 4 0 00-4 4v3l-1 1v.5h10V10l-1-1V6a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.3"/><path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.3"/></svg>
            </button>
            {unreadCount > 0 && (
              <span style={{position:'absolute',top:-3,right:-3,minWidth:16,height:16,background:'var(--sr)',color:'#fff',fontSize:9,fontWeight:700,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid var(--n0)',padding:'0 3px'}}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>

          {/* Profile menu — sign-out and account controls live here, not as a
              bare top-bar button. */}
          <div style={{position:'relative'}} ref={menuRef}>
            <button onClick={() => setMenuOpen((o) => !o)} title="Account" aria-haspopup="menu" aria-expanded={menuOpen}
              style={{display:'flex',alignItems:'center',gap:6,padding:2,paddingRight:6,border:'1px solid var(--n200)',borderRadius:20,background:'var(--n0)',cursor:'pointer'}}>
              <div style={{width:28,height:28,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,color:'#fff'}}>{initials}</div>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{transition:'transform .15s', transform: menuOpen ? 'rotate(180deg)' : 'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n500)" strokeWidth="1.3" strokeLinecap="round"/></svg>
            </button>

            {menuOpen && (
              <div role="menu" style={{position:'absolute',top:'calc(100% + 8px)',right:0,width:250,background:'var(--n0)',border:'var(--bdr)',borderRadius:10,boxShadow:'var(--sh-lg)',zIndex:60,overflow:'hidden'}}>
                <div style={{padding:'14px 14px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:600,color:'#fff',flexShrink:0}}>{initials}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--n900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fullName || '—'}</div>
                    <div style={{fontSize:11,color:'var(--n500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user?.email || ''}</div>
                    {roleKey && <div style={{marginTop:4,display:'inline-block',fontSize:10,fontWeight:600,color:'var(--b700)',background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:10,padding:'1px 8px'}}>{ROLE_LABELS[roleKey] || roleKey}</div>}
                  </div>
                </div>
                <div style={{padding:'6px 0'}}>
                  <button role="menuitem" style={menuItem} onClick={() => { setMenuOpen(false); nav('/settings') }}
                    onMouseEnter={(e)=>e.currentTarget.style.background='var(--n50)'} onMouseLeave={(e)=>e.currentTarget.style.background='none'}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    Account settings
                  </button>
                  <button role="menuitem" style={menuItem} onClick={() => { toggleDark() }}
                    onMouseEnter={(e)=>e.currentTarget.style.background='var(--n50)'} onMouseLeave={(e)=>e.currentTarget.style.background='none'}>
                    {dark
                      ? <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M8 2v1M8 13v1M2 8h1M13 8h1M3.8 3.8l.7.7M11.5 11.5l.7.7M3.8 12.2l.7-.7M11.5 4.5l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M11 3.5A5.5 5.5 0 103.5 11 5.5 5.5 0 0011 3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none"/></svg>}
                    {dark ? 'Light mode' : 'Dark mode'}
                  </button>
                </div>
                <div style={{borderTop:'var(--bdr)',padding:'6px 0'}}>
                  <button role="menuitem" style={{...menuItem, color:'var(--srt)'}} onClick={() => { setMenuOpen(false); signOut() }}
                    onMouseEnter={(e)=>e.currentTarget.style.background='var(--srb)'} onMouseLeave={(e)=>e.currentTarget.style.background='none'}>
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 2H3.5A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {children}
    </header>
  )
}
