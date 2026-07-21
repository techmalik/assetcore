import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useNotifications } from '../lib/NotificationsContext'
import { getPreferences, upsertPreference } from '../lib/db/notifications'

const KIND_META = {
  wo_transition: { label:'Work Order', dot:'var(--sl)', bg:'var(--slb)', c:'var(--slt)' },
  wo_comment:    { label:'Work Order', dot:'var(--sl)', bg:'var(--slb)', c:'var(--slt)' },
  wo_assigned:   { label:'Work Order', dot:'var(--sl)', bg:'var(--slb)', c:'var(--slt)' },
  pm_due:        { label:'Maintenance', dot:'var(--sa)', bg:'var(--sab)', c:'var(--sat)' },
  pm_overdue:    { label:'Maintenance', dot:'var(--sr)', bg:'var(--srb)', c:'var(--srt)' },
  inspection_due:{ label:'Inspection',  dot:'var(--sa)', bg:'var(--sab)', c:'var(--sat)' },
  maintenance_due:{ label:'Maintenance', dot:'var(--sr)', bg:'var(--srb)', c:'var(--srt)' },
  licence_expiry:{ label:'Compliance',  dot:'var(--sr)', bg:'var(--srb)', c:'var(--srt)' },
  system:        { label:'System',      dot:'var(--n400)', bg:'var(--n100)', c:'var(--n700)' },
}
const DEFAULT_META = { label:'Notification', dot:'var(--n400)', bg:'var(--n100)', c:'var(--n700)' }

function kindMeta(kind) { return KIND_META[kind] || DEFAULT_META }

function groupByDate(items) {
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1)
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate()-7)
  const groups = []
  const buckets = { Today:[], Yesterday:[], 'This Week':[], Earlier:[] }
  for (const n of items) {
    const d = new Date(n.created_at); d.setHours(0,0,0,0)
    if (d >= today) buckets['Today'].push(n)
    else if (d >= yesterday) buckets['Yesterday'].push(n)
    else if (d >= weekAgo) buckets['This Week'].push(n)
    else buckets['Earlier'].push(n)
  }
  for (const [label, items] of Object.entries(buckets)) {
    if (items.length) groups.push({ label, items })
  }
  return groups
}

function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`
  if (diff < 86400000) return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})
}

const PREF_KINDS = [
  { key:'wo_transition',  label:'Work order transitions', desc:'Status changes on work orders' },
  { key:'wo_comment',     label:'Work order comments',    desc:'New comments on work orders' },
  { key:'wo_assigned',    label:'Work order assignments', desc:'When a WO is assigned to you' },
  { key:'inspection_due', label:'Inspection alerts',      desc:'Asset health fell to the inspection threshold' },
  { key:'maintenance_due',label:'Maintenance alerts',     desc:'Asset health critical — maintenance required' },
  { key:'pm_due',         label:'PM due reminders',       desc:'Upcoming PM tasks (7-day warning)' },
  { key:'pm_overdue',     label:'PM overdue alerts',      desc:'Tasks that missed their due date' },
  { key:'licence_expiry', label:'Licence expiry',         desc:'Licences and permits nearing expiry' },
  { key:'system',         label:'System updates',         desc:'Platform announcements', email:false },
]

export default function Notifications({ dark, toggleDark }) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const [selected, setSelected] = useState(null)
  const [panel, setPanel] = useState('detail')
  const [prefs, setPrefs] = useState([])
  const [prefsLoading, setPrefsLoading] = useState(false)

  const groups = groupByDate(notifications)

  useEffect(() => {
    if (notifications.length && !selected) setSelected(notifications[0])
  }, [notifications])

  useEffect(() => {
    if (panel !== 'prefs') return
    setPrefsLoading(true)
    getPreferences().then(rows => {
      // Merge DB rows with defaults
      setPrefs(PREF_KINDS.map(k => {
        const row = rows.find(r => r.kind === k.key)
        return { ...k, in_app: row ? row.in_app : true, email: row ? row.email : false }
      }))
      setPrefsLoading(false)
    }).catch(() => {
      setPrefs(PREF_KINDS.map(k => ({ ...k, in_app: true, email: false })))
      setPrefsLoading(false)
    })
  }, [panel])

  const handleSelect = (n) => {
    setSelected(n)
    setPanel('detail')
    if (!n.read) markRead(n.id)
  }

  const togglePref = async (key, field) => {
    const updated = prefs.map(p => p.key === key ? { ...p, [field]: !p[field] } : p)
    setPrefs(updated)
    const p = updated.find(x => x.key === key)
    try { await upsertPreference({ kind: key, in_app: p.in_app, email: p.email }) } catch { /* ignore */ }
  }

  const meta = selected ? kindMeta(selected.kind) : DEFAULT_META

  return (
    <div className="app-shell">
      <Sidebar active="notifications"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Notifications" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex'}}>
          {/* List */}
          <div style={{width:340,flexShrink:0,borderRight:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:13,fontWeight:600,color:'var(--n900)',flex:1}}>
                Notifications
                {unreadCount > 0 && <span style={{marginLeft:6,background:'var(--sr)',color:'#fff',borderRadius:10,fontSize:10,fontWeight:600,padding:'1px 6px'}}>{unreadCount}</span>}
              </span>
              <button onClick={() => setPanel('prefs')} style={{height:26,padding:'0 8px',border:'1px solid var(--n200)',borderRadius:4,background:panel==='prefs'?'var(--b50)':'var(--n0)',fontSize:11,color:panel==='prefs'?'var(--b600)':'var(--n600)',cursor:'pointer'}}>Preferences</button>
              <button onClick={markAllRead} style={{height:26,padding:'0 8px',border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Mark all read</button>
            </div>

            <div style={{flex:1,overflowY:'auto'}}>
              {notifications.length === 0 ? (
                <div style={{padding:'32px 20px',textAlign:'center',color:'var(--n400)',fontSize:13}}>
                  <svg width="28" height="28" viewBox="0 0 16 16" fill="none" style={{margin:'0 auto 10px',display:'block'}}><path d="M8 2a4 4 0 00-4 4v3l-1 1v.5h10V10l-1-1V6a4 4 0 00-4-4z" stroke="var(--n300)" strokeWidth="1.2"/><path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="var(--n300)" strokeWidth="1.2"/></svg>
                  No notifications yet
                </div>
              ) : (
                groups.map(g => (
                  <div key={g.label}>
                    <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--n400)',fontFamily:'var(--ff-m)',background:'var(--n50)',borderBottom:'var(--bdr)'}}>{g.label}</div>
                    {g.items.map(n => {
                      const m = kindMeta(n.kind)
                      const active = selected?.id === n.id && panel === 'detail'
                      return (
                        <div key={n.id} onClick={() => handleSelect(n)} style={{padding:'12px 16px',borderBottom:'var(--bdr)',cursor:'pointer',background:active?'var(--b50)':'transparent',display:'flex',gap:10,alignItems:'flex-start',borderLeft:`3px solid ${active?'var(--b500)':'transparent'}`}}>
                          <div style={{width:6,height:6,borderRadius:'50%',background:n.read?'transparent':m.dot,marginTop:5,flexShrink:0,border:n.read?'none':'none'}}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:n.read?400:600,color:'var(--n900)',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.title}</div>
                            {n.body && <div style={{fontSize:11,color:'var(--n500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:4}}>{n.body}</div>}
                            <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{fmtTime(n.created_at)}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Detail */}
          {panel === 'detail' && (
            <div style={{flex:1,overflowY:'auto',padding:'24px 28px',background:'var(--n50)'}}>
              {selected ? (
                <div style={{maxWidth:600}}>
                  <div style={{marginBottom:12}}>
                    <span style={{display:'inline-flex',padding:'2px 8px',borderRadius:2,border:`1px solid ${meta.dot}`,fontSize:11,fontWeight:500,background:meta.bg,color:meta.c}}>{meta.label}</span>
                  </div>
                  <h2 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,color:'var(--n950)',letterSpacing:'-.3px',marginBottom:6}}>{selected.title}</h2>
                  <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n400)',marginBottom:20}}>{fmtTime(selected.created_at)}</div>
                  {selected.body && (
                    <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'16px 18px',marginBottom:16}}>
                      <p style={{fontSize:14,color:'var(--n700)',lineHeight:1.7}}>{selected.body}</p>
                    </div>
                  )}
                  <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px',marginBottom:20,display:'flex',alignItems:'center',gap:10}}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--n400)" strokeWidth="1.2"/><path d="M8 5.5V8l2 1.5" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    <span style={{fontSize:12,color:'var(--n600)'}}>{selected.entity_type ? `${selected.entity_type.replace('_',' ')} event` : 'System notification'}</span>
                    {selected.read ? <span style={{marginLeft:'auto',fontSize:11,color:'var(--sgt)'}}>Read</span> : <span style={{marginLeft:'auto',fontSize:11,color:'var(--n400)'}}>Unread</span>}
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    {!selected.read && <button className="btn btn-primary" onClick={() => markRead(selected.id)} style={{height:36,padding:'0 18px',fontSize:13}}>Mark as read</button>}
                    <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13,marginLeft:'auto'}}>Dismiss</button>
                  </div>
                </div>
              ) : (
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'var(--n400)',fontSize:13}}>Select a notification</div>
              )}
            </div>
          )}

          {/* Preferences */}
          {panel === 'prefs' && (
            <div style={{flex:1,overflowY:'auto',padding:'24px 28px',background:'var(--n50)'}}>
              <div style={{maxWidth:560}}>
                <h2 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,color:'var(--n950)',letterSpacing:'-.3px',marginBottom:4}}>Notification Preferences</h2>
                <p style={{fontSize:13,color:'var(--n500)',marginBottom:20}}>Choose which events generate notifications for your account.</p>

                {prefsLoading ? (
                  <div style={{color:'var(--n400)',fontSize:13}}>Loading…</div>
                ) : (
                  <>
                    <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden',marginBottom:16}}>
                      <div style={{padding:'10px 16px',borderBottom:'var(--bdr)',display:'grid',gridTemplateColumns:'1fr 72px 56px',gap:8}}>
                        <span style={{fontSize:10,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Event</span>
                        <span style={{fontSize:10,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)',textAlign:'center'}}>In-app</span>
                        <span style={{fontSize:10,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)',textAlign:'center'}}>Email</span>
                      </div>
                      {prefs.map((p,i) => (
                        <div key={p.key} style={{padding:'14px 16px',borderBottom:i<prefs.length-1?'var(--bdr)':'none',display:'grid',gridTemplateColumns:'1fr 72px 56px',gap:8,alignItems:'center'}}>
                          <div>
                            <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{p.label}</div>
                            <div style={{fontSize:12,color:'var(--n500)',marginTop:2}}>{p.desc}</div>
                          </div>
                          <div style={{display:'flex',justifyContent:'center'}}>
                            <Toggle on={p.in_app} onChange={() => togglePref(p.key,'in_app')} />
                          </div>
                          <div style={{display:'flex',justifyContent:'center'}}>
                            <Toggle on={p.email} onChange={() => togglePref(p.key,'email')} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p style={{fontSize:11,color:'var(--n400)'}}>Changes are saved automatically.</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ on, onChange }) {
  return (
    <div onClick={onChange} style={{width:36,height:20,borderRadius:10,background:on?'var(--b500)':'var(--n200)',position:'relative',cursor:'pointer',flexShrink:0,transition:'background .15s'}}>
      <div style={{width:14,height:14,borderRadius:'50%',background:'#fff',position:'absolute',top:3,left:on?19:3,transition:'left .15s'}}/>
    </div>
  )
}
