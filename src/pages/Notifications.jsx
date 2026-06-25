import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const groups = [
  {
    label: 'Critical Alerts',
    items: [
      {id:1,title:'Lagos DS-04 Metering Station – Critical Health',body:'Asset health score dropped to 32/100. Calibration drift of 12% detected. Immediate action required.',time:'14 Jan · 09:14',read:false,type:'alert',icon:'sr'},
      {id:2,title:'Warri Terminal A RTU – Sensor Failure',body:'RTU NGML-SCR-041 reporting intermittent sensor failures. SCADA data integrity may be compromised.',time:'14 Jan · 07:55',read:false,type:'alert',icon:'sr'},
    ]
  },
  {
    label: 'Work Orders',
    items: [
      {id:3,title:'WO-2025-0847 assigned to you',body:'Work order for Lagos DS-04 Emergency Calibration has been assigned to Tunde Fashola.',time:'13 Jan · 11:32',read:false,type:'wo',icon:'sl'},
      {id:4,title:'WO-2025-0844 updated',body:'Adaeze Okeke updated the priority of WO-2025-0844 (Warri RTU Sensor Replacement) to Critical.',time:'13 Jan · 10:08',read:true,type:'wo',icon:'sl'},
    ]
  },
  {
    label: 'Maintenance',
    items: [
      {id:5,title:'PM overdue: NGML-MTR-0042',body:'Quarterly calibration for Lagos DS-04 Metering Station is 1 day overdue. Scheduled for 14 Jan.',time:'14 Jan · 08:00',read:true,type:'pm',icon:'sa'},
      {id:6,title:'PM due tomorrow: Delta CS Compressor C-017',body:'Annual overhaul for NGML-CMP-0017 is scheduled for 15 Jan. Technician: Emeka Obi.',time:'13 Jan · 08:00',read:true,type:'pm',icon:'sa'},
    ]
  },
  {
    label: 'Compliance',
    items: [
      {id:7,title:'Pressure Vessel Certificate expired',body:'LIC-003: Pressure Vessel Certificate for Delta CS Compressor C-017 expired 9 Jan 2025. Renewal required.',time:'9 Jan · 00:01',read:true,type:'compliance',icon:'sr'},
    ]
  },
]

const allItems = groups.flatMap(g => g.items)

const typeColors = {
  alert:{bg:'var(--srb)',c:'var(--srt)',dot:'var(--sr)'},
  wo:{bg:'var(--slb)',c:'var(--slt)',dot:'var(--sl)'},
  pm:{bg:'var(--sab)',c:'var(--sat)',dot:'var(--sa)'},
  compliance:{bg:'var(--srb)',c:'var(--srt)',dot:'var(--sr)'},
}

const prefCategories = [
  {key:'critical',label:'Critical alerts',desc:'Safety and health failures requiring immediate action',enabled:true},
  {key:'wo',label:'Work order updates',desc:'Assignments, status changes and completions',enabled:true},
  {key:'pm',label:'Preventive maintenance',desc:'Upcoming and overdue PM reminders',enabled:true},
  {key:'compliance',label:'Compliance expiry',desc:'Licence and certificate expiry warnings',enabled:true},
  {key:'reports',label:'Report generation',desc:'Completed report notifications',enabled:false},
  {key:'system',label:'System updates',desc:'Platform updates and announcements',enabled:false},
]

export default function Notifications({ dark, toggleDark }) {
  const [selected, setSelected] = useState(allItems[0])
  const [panel, setPanel] = useState('detail')
  const [prefs, setPrefs] = useState(prefCategories)

  const unread = allItems.filter(n => !n.read).length

  return (
    <div className="app-shell">
      <Sidebar active="notifications"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Notifications" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex'}}>
          {/* Notification list */}
          <div style={{width:340,flexShrink:0,borderRight:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{padding:'12px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:13,fontWeight:600,color:'var(--n900)',flex:1}}>
                Notifications
                {unread > 0 && <span style={{marginLeft:6,background:'var(--sr)',color:'#fff',borderRadius:10,fontSize:10,fontWeight:600,padding:'1px 6px'}}>{unread}</span>}
              </span>
              <button onClick={() => setPanel('prefs')} style={{height:26,padding:'0 8px',border:'1px solid var(--n200)',borderRadius:4,background:panel==='prefs'?'var(--b50)':'var(--n0)',fontSize:11,color:panel==='prefs'?'var(--b600)':'var(--n600)',cursor:'pointer'}}>Preferences</button>
              <button style={{height:26,padding:'0 8px',border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Mark all read</button>
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              {groups.map(g => (
                <div key={g.label}>
                  <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--n400)',fontFamily:'var(--ff-m)',background:'var(--n50)',borderBottom:'var(--bdr)'}}>{g.label}</div>
                  {g.items.map(n => (
                    <div key={n.id} onClick={() => { setSelected(n); setPanel('detail') }} style={{padding:'12px 16px',borderBottom:'var(--bdr)',cursor:'pointer',background:selected?.id===n.id&&panel==='detail'?'var(--b50)':'transparent',display:'flex',gap:10,alignItems:'flex-start',borderLeft:`3px solid ${selected?.id===n.id&&panel==='detail'?'var(--b500)':'transparent'}`}}>
                      {!n.read && <div style={{width:6,height:6,borderRadius:'50%',background:typeColors[n.type].dot,marginTop:5,flexShrink:0}}/>}
                      {n.read && <div style={{width:6,height:6,flexShrink:0}}/>}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:n.read?400:600,color:'var(--n900)',marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.title}</div>
                        <div style={{fontSize:11,color:'var(--n500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:4}}>{n.body}</div>
                        <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{n.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Detail / Preferences panel */}
          {panel === 'detail' && selected && (
            <div style={{flex:1,overflowY:'auto',padding:'24px 28px',background:'var(--n50)'}}>
              <div style={{maxWidth:600}}>
                {/* Type badge */}
                <div style={{marginBottom:12}}>
                  <span style={{display:'inline-flex',padding:'2px 8px',borderRadius:2,border:'1px solid',fontSize:11,fontWeight:500,background:typeColors[selected.type].bg,color:typeColors[selected.type].c,borderColor:typeColors[selected.type].dot}}>
                    {selected.type === 'alert' ? 'Critical Alert' : selected.type === 'wo' ? 'Work Order' : selected.type === 'pm' ? 'Maintenance' : 'Compliance'}
                  </span>
                </div>

                <h2 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,color:'var(--n950)',letterSpacing:'-.3px',marginBottom:6}}>{selected.title}</h2>
                <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n400)',marginBottom:20}}>{selected.time}</div>

                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'16px 18px',marginBottom:16}}>
                  <p style={{fontSize:14,color:'var(--n700)',lineHeight:1.7}}>{selected.body}</p>
                </div>

                {/* Timeline */}
                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden',marginBottom:16}}>
                  <div style={{padding:'10px 16px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Event Timeline</div>
                  <div style={{padding:'14px 16px',display:'flex',flexDirection:'column',gap:12}}>
                    {[
                      {label:'Event detected',time:selected.time.split(' · ')[1],detail:'Automated sensor readings triggered threshold alert.',color:'var(--sr)'},
                      {label:'Notification sent',time:'auto',detail:'Alert dispatched to assigned Ops Manager and technician team.',color:'var(--sl)'},
                      {label:'Acknowledged',time:'—',detail:'Awaiting acknowledgement.',color:'var(--n300)'},
                    ].map((ev,i) => (
                      <div key={i} style={{display:'flex',gap:12}}>
                        <div style={{width:8,height:8,borderRadius:'50%',background:ev.color,marginTop:4,flexShrink:0}}/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{ev.label}</div>
                          <div style={{fontSize:12,color:'var(--n500)',marginTop:2}}>{ev.detail}</div>
                          <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)',marginTop:2}}>{ev.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-primary" style={{height:36,padding:'0 18px',fontSize:13}}>Acknowledge</button>
                  {selected.type === 'alert' && <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>Create Work Order</button>}
                  {selected.type === 'wo' && <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>View Work Order</button>}
                  {selected.type === 'pm' && <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>View PM Schedule</button>}
                  {selected.type === 'compliance' && <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>Renew Certificate</button>}
                  <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13,marginLeft:'auto'}}>Dismiss</button>
                </div>
              </div>
            </div>
          )}

          {panel === 'prefs' && (
            <div style={{flex:1,overflowY:'auto',padding:'24px 28px',background:'var(--n50)'}}>
              <div style={{maxWidth:560}}>
                <h2 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,color:'var(--n950)',letterSpacing:'-.3px',marginBottom:4}}>Notification Preferences</h2>
                <p style={{fontSize:13,color:'var(--n500)',marginBottom:20}}>Choose which events generate notifications for your account.</p>

                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden',marginBottom:16}}>
                  <div style={{padding:'10px 16px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Notification Types</div>
                  {prefs.map((p,i) => (
                    <div key={p.key} style={{padding:'14px 16px',borderBottom:i<prefs.length-1?'var(--bdr)':'none',display:'flex',alignItems:'center',gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{p.label}</div>
                        <div style={{fontSize:12,color:'var(--n500)',marginTop:2}}>{p.desc}</div>
                      </div>
                      <div
                        onClick={() => setPrefs(prefs.map(x => x.key===p.key ? {...x,enabled:!x.enabled} : x))}
                        style={{width:36,height:20,borderRadius:10,background:p.enabled?'var(--b500)':'var(--n200)',position:'relative',cursor:'pointer',flexShrink:0,transition:'background .15s'}}
                      >
                        <div style={{width:14,height:14,borderRadius:'50%',background:'#fff',position:'absolute',top:3,left:p.enabled?19:3,transition:'left .15s'}}/>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Delivery channels */}
                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden',marginBottom:20}}>
                  <div style={{padding:'10px 16px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Delivery Channels</div>
                  {[
                    {label:'In-app notifications',desc:'Always on',forced:true,on:true},
                    {label:'Email digest',desc:'Daily summary at 07:00',forced:false,on:true},
                    {label:'SMS alerts',desc:'Critical alerts only',forced:false,on:true},
                  ].map((ch,i,arr) => (
                    <div key={ch.label} style={{padding:'14px 16px',borderBottom:i<arr.length-1?'var(--bdr)':'none',display:'flex',alignItems:'center',gap:14}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{ch.label}</div>
                        <div style={{fontSize:12,color:'var(--n500)',marginTop:2}}>{ch.desc}</div>
                      </div>
                      <div style={{width:36,height:20,borderRadius:10,background:ch.on?'var(--b500)':'var(--n200)',position:'relative',cursor:ch.forced?'default':'pointer',opacity:ch.forced?.6:1,flexShrink:0}}>
                        <div style={{width:14,height:14,borderRadius:'50%',background:'#fff',position:'absolute',top:3,left:ch.on?19:3}}/>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-primary" style={{height:36,padding:'0 18px',fontSize:13}}>Save preferences</button>
                  <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>Reset to defaults</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
