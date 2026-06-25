import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const sites = ['All Sites','Lagos','Delta','North','Warri','Aba']

export default function Dashboard({ dark, toggleDark }) {
  return (
    <div className="app-shell">
      <Sidebar active="dashboard"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Dashboard" dark={dark} toggleDark={toggleDark}>
          {/* Site filter strip */}
          <div style={{height:34,display:'flex',alignItems:'center',padding:'0 24px',gap:6,background:'var(--n50)',borderTop:'var(--bdr)'}}>
            <span style={{fontSize:12,color:'var(--n500)',fontWeight:500,marginRight:2}}>Site:</span>
            {sites.map((s,i) => (
              <button key={s} style={{height:22,padding:'0 8px',border:i===0?'1px solid var(--b300)':'1px solid transparent',borderRadius:3,background:i===0?'var(--b50)':'transparent',fontSize:12,color:i===0?'var(--b700)':'var(--n600)',cursor:'pointer'}}>{s}</button>
            ))}
            <div style={{flex:1}}/>
            <span style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n400)'}}>Last synced: 14 Jan 2025 · 11:42 WAT</span>
          </div>
        </Topbar>

        <div style={{flex:1,overflowY:'auto',padding:24}}>
          {/* Page title */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20}}>
            <div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:26,fontWeight:700,letterSpacing:'-.4px',color:'var(--n950)',lineHeight:1.15}}>Operations Dashboard</h1>
              <p style={{fontSize:13,color:'var(--n500)',marginTop:4}}>Network health overview · Nigeria Gas Marketing Limited</p>
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

          {/* KPI cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:12,marginBottom:20}}>
            {[
              {label:'Total Assets',val:'2,847',sub:'+48 this month',subC:'var(--sgt)',icon:'b'},
              {label:'Operational',val:'91.4%',sub:'2,601 of 2,847 assets',subC:'var(--n500)',icon:'g'},
              {label:'Open Work Orders',val:'143',sub:'28 overdue · 4 critical',subC:'var(--srt)',icon:'a'},
              {label:'Overdue PM',val:'19',sub:'38 due within 7 days',subC:'var(--sat)',icon:'r'},
              {label:'Compliance Alerts',val:'7',sub:'Licences expiring <30 days',subC:'var(--sat)',icon:'a'},
            ].map(k => (
              <div key={k.label} className="kpi">
                <div style={{fontSize:12,fontWeight:500,color:'var(--n500)',marginBottom:12}}>{k.label}</div>
                <div style={{fontFamily:'var(--ff-m)',fontSize:30,fontWeight:500,color:'var(--n950)',lineHeight:1,marginBottom:8}}>{k.val}</div>
                <div style={{fontSize:12,color:k.subC}}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Main grid */}
          <div style={{display:'grid',gridTemplateColumns:'280px 1fr 300px',gap:16,marginBottom:16}}>
            {/* Health donut */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:20,boxShadow:'var(--sh-sm)'}}>
              <div style={{fontSize:14,fontWeight:600,color:'var(--n800)',marginBottom:16}}>Network Health</div>
              <div style={{position:'relative',width:140,height:140,margin:'0 auto 16px'}}>
                <svg viewBox="0 0 140 140" width="140" height="140">
                  <circle cx="70" cy="70" r="54" fill="none" stroke="var(--n200)" strokeWidth="14"/>
                  <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sg)" strokeWidth="14" strokeDasharray="310.3 28.9" strokeLinecap="round" transform="rotate(-90 70 70)"/>
                  <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sa)" strokeWidth="14" strokeDasharray="19.7 319.6" strokeDashoffset="-310.3" transform="rotate(-90 70 70)"/>
                  <circle cx="70" cy="70" r="54" fill="none" stroke="var(--sr)" strokeWidth="14" strokeDasharray="9.5 329.8" strokeDashoffset="-330" transform="rotate(-90 70 70)"/>
                </svg>
                <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                  <span style={{fontFamily:'var(--ff-m)',fontSize:28,fontWeight:500,color:'var(--n950)',lineHeight:1}}>84</span>
                  <span style={{fontSize:11,color:'var(--n500)'}}>Health Score</span>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {[
                  {c:'var(--sg)',cc:'var(--sgt)',l:'Operational',v:'2,601 · 91.4%'},
                  {c:'var(--sa)',cc:'var(--sat)',l:'Attention Req.',v:'165 · 5.8%'},
                  {c:'var(--sr)',cc:'var(--srt)',l:'Critical / Urgent',v:'81 · 2.8%'},
                  {c:'var(--n300)',cc:'var(--n500)',l:'Offline / N/A',v:'0 · 0%'},
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
              <div style={{marginTop:12,paddingTop:12,borderTop:'var(--bdr)',fontSize:12,color:'var(--n500)'}}>
                vs. last month: <span style={{color:'var(--sgt)',fontWeight:500}}>↑ +1.2%</span> operational
              </div>
            </div>

            {/* Map */}
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
                <div style={{position:'absolute',inset:0,backgroundImage:'linear-gradient(oklch(90% 0.012 160) 1px,transparent 1px),linear-gradient(90deg,oklch(90% 0.012 160) 1px,transparent 1px)',backgroundSize:'32px 32px'}}/>
                <svg style={{position:'absolute',inset:0,width:'100%',height:'100%'}} viewBox="0 0 600 320" preserveAspectRatio="none">
                  <path d="M80 200 L180 160 L310 140 L420 100 L520 120" stroke="oklch(60% 0.04 145)" strokeWidth="2" fill="none" strokeDasharray="6 3" opacity=".5"/>
                  <path d="M180 160 L200 240 L300 260" stroke="oklch(60% 0.04 145)" strokeWidth="2" fill="none" strokeDasharray="6 3" opacity=".5"/>
                  <path d="M310 140 L330 200 L380 220 L440 200" stroke="oklch(60% 0.04 145)" strokeWidth="2" fill="none" strokeDasharray="6 3" opacity=".5"/>
                </svg>
                {/* Markers */}
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
                <div style={{position:'absolute',left:'85%',top:'55%',transform:'translate(-50%,-100%)'}}>
                  <div style={{width:28,height:28,background:'var(--sa)',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,0,0,.15)',fontFamily:'var(--ff-m)',fontSize:10,fontWeight:600,color:'#fff'}}>12</div>
                </div>
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

            {/* Alerts */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Active Alerts</div>
                <span style={{background:'var(--srb)',color:'var(--srt)',fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:999,border:'1px solid var(--srbr)'}}>4 critical</span>
              </div>
              <div style={{flex:1,overflowY:'auto'}}>
                {[
                  {c:'var(--sr)',type:'r',title:'Pressure drop — MTR-0042',desc:'Inlet pressure below 1.2 barg threshold. Work order raised.',meta:'2h ago',link:'WO-0341 →'},
                  {c:'var(--sr)',type:'r',title:'SCADA offline — Warri A',desc:'RTU comms lost. No telemetry for 47 min. Engineer dispatched.',meta:'47 min ago',link:null},
                  {c:'var(--sa)',type:'a',title:'PM overdue — CMP-0017',desc:'Quarterly service 3 days past due. Assigned to B. Ibrahim.',meta:'3 days ago',link:null},
                  {c:'var(--sa)',type:'a',title:'Licence expiring — LIC-0014',desc:'DPR Operating Licence · North expires in 7 days. Renewal required.',meta:'7 days left',link:'Renew →'},
                  {c:'var(--sl)',type:'b',title:'48 assets imported',desc:'Aba region asset register sync complete. No errors.',meta:'1h ago',link:null},
                ].map((a,i) => (
                  <div key={i} style={{padding:'12px 16px',borderBottom:'var(--bdr)',borderLeft:`3px solid ${a.c}`}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:'var(--n900)',marginBottom:2}}>{a.title}</div>
                        <div style={{fontSize:11,color:'var(--n500)',marginBottom:6}}>{a.desc}</div>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span className={`badge badge-${a.type}`}>{a.type==='r'?'Critical':a.type==='a'?'Attention':'Info'}</span>
                          <span style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{a.meta}</span>
                          {a.link && <span style={{marginLeft:'auto',fontSize:11,fontWeight:500,color:'var(--b600)'}}>{a.link}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 16px',borderTop:'var(--bdr)',flexShrink:0}}>
                <button style={{width:'100%',height:30,border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',fontSize:12,color:'var(--b600)',fontWeight:500,cursor:'pointer'}}>View all alerts →</button>
              </div>
            </div>
          </div>

          {/* Bottom row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 360px',gap:16}}>
            {/* Work orders table */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',overflow:'hidden'}}>
              <div style={{padding:'14px 20px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Recent Work Orders</div>
                <button style={{border:'none',background:'none',fontSize:13,color:'var(--b600)',fontWeight:500,cursor:'pointer',padding:0}}>View all →</button>
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'var(--n50)'}}>
                      {['WO Ref','Description','Assignee','Status','Priority','Due'].map(h=>(
                        <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {ref:'WO-2025-0341',title:'Corroded flange seal — MTR-0042',site:'Lagos DS-04 Metering Station',assignee:'AO',name:'A. Okeke',status:'In Progress',statusC:'ip',priority:'Critical',prioC:'r',due:'2h overdue',dueC:'var(--srt)'},
                      {ref:'WO-2025-0338',title:'Quarterly PM — Compressor C-017',site:'Delta Compression Station',assignee:'BI',name:'B. Ibrahim',status:'Inspection',statusC:'b',priority:'High',prioC:'a',due:'Today',dueC:'var(--sat)'},
                      {ref:'WO-2025-0335',title:'Valve packing replacement — VLV-0089',site:'North Benin PRG Station',assignee:'CF',name:'C. Festus',status:'Assigned',statusC:'b',priority:'Standard',prioC:'b',due:'17 Jan',dueC:'var(--n500)'},
                      {ref:'WO-2025-0330',title:'SCADA RTU firmware update — SCR-041',site:'Warri Terminal A',assignee:'OE',name:'O. Eze',status:'New',statusC:'n',priority:'Standard',prioC:'b',due:'20 Jan',dueC:'var(--n500)'},
                      {ref:'WO-2025-0327',title:'Annual safety inspection — PIP-0312',site:'Aba Distribution Network',assignee:'NN',name:'N. Nwachukwu',status:'Closed',statusC:'g',priority:'High',prioC:'a',due:'10 Jan',dueC:'var(--n500)'},
                    ].map(wo => (
                      <tr key={wo.ref} style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'10px 12px',fontFamily:'var(--ff-m)',fontSize:12,color:'var(--b700)',fontWeight:500,whiteSpace:'nowrap'}}>{wo.ref}</td>
                        <td style={{padding:'10px 12px'}}>
                          <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{wo.title}</div>
                          <div style={{fontSize:11,color:'var(--n500)'}}>{wo.site}</div>
                        </td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <div style={{width:24,height:24,borderRadius:'50%',background:'var(--b700)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,color:'#fff',flexShrink:0}}>{wo.assignee}</div>
                            <span style={{fontSize:12,color:'var(--n700)'}}>{wo.name}</span>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px'}}><span className={`badge badge-${wo.statusC}`}>{wo.status}</span></td>
                        <td style={{padding:'10px 12px'}}><span className={`badge badge-${wo.prioC}`}>{wo.priority}</span></td>
                        <td style={{padding:'10px 12px',textAlign:'right',fontFamily:'var(--ff-m)',fontSize:11,color:wo.dueC,whiteSpace:'nowrap'}}>{wo.due}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Upcoming maintenance */}
            <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-sm)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{padding:'14px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Upcoming Maintenance</div>
                <button style={{border:'none',background:'none',fontSize:13,color:'var(--b600)',fontWeight:500,cursor:'pointer',padding:0}}>Schedule →</button>
              </div>
              <div style={{padding:'12px 16px',borderBottom:'var(--bdr)',background:'var(--n50)'}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--n500)',marginBottom:8,fontFamily:'var(--ff-m)',letterSpacing:'.05em'}}>JANUARY 2025</div>
                <div style={{display:'flex',gap:4}}>
                  {[{d:'MON',n:13,s:'normal'},{d:'TUE',n:14,s:'active'},{d:'WED',n:15,s:'red'},{d:'THU',n:16,s:'normal'},{d:'FRI',n:17,s:'amber'},{d:'SAT',n:18,s:'off'},{d:'SUN',n:19,s:'off'}].map(day=>(
                    <div key={day.n} style={{flex:1,textAlign:'center'}}>
                      <div style={{fontSize:10,color:'var(--n400)',marginBottom:4}}>{day.d}</div>
                      <div style={{width:28,height:28,
                        background:day.s==='active'?'var(--b500)':day.s==='red'?'var(--srb)':day.s==='amber'?'var(--sab)':'var(--n0)',
                        border:day.s==='active'?'none':day.s==='red'?'1px solid var(--srbr)':day.s==='amber'?'1px solid var(--sabr)':'1px solid var(--n200)',
                        borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:12,
                        color:day.s==='active'?'#fff':day.s==='red'?'var(--srt)':day.s==='amber'?'var(--sat)':day.s==='off'?'var(--n400)':'var(--n600)',
                        fontWeight:day.s==='active'?600:day.s==='red'||day.s==='amber'?500:400,
                        margin:'0 auto'
                      }}>{day.n}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{flex:1,overflowY:'auto'}}>
                {[
                  {date:'15 JAN',dc:'var(--srt)',db:'var(--srb)',dbr:'var(--srbr)',title:'Vibration analysis — CMP-0017',sub:'Delta · B. Ibrahim · 4h',badge:'Overdue',bC:'r'},
                  {date:'16 JAN',dc:'var(--sat)',db:'var(--sab)',dbr:'var(--sabr)',title:'Filter replacement — REG-0089',sub:'North · C. Festus · 2h',badge:null},
                  {date:'17 JAN',dc:'var(--sat)',db:'var(--sab)',dbr:'var(--sabr)',title:'Packing replacement — VLV-0089',sub:'North · C. Festus · 3h',badge:null},
                  {date:'21 JAN',dc:'var(--n600)',db:'var(--n100)',dbr:'var(--n200)',title:'Annual calibration — MTR-0067',sub:'Warri · O. Eze · 8h',badge:null},
                  {date:'23 JAN',dc:'var(--n600)',db:'var(--n100)',dbr:'var(--n200)',title:'SCADA health check — SCR-041',sub:'Warri · N. Nwachukwu · 2h',badge:null},
                ].map((pm,i)=>(
                  <div key={i} style={{padding:'10px 16px',borderBottom:'var(--bdr)',display:'flex',alignItems:'flex-start',gap:10}}>
                    <div style={{fontFamily:'var(--ff-m)',fontSize:10,fontWeight:600,color:pm.dc,background:pm.db,border:`1px solid ${pm.dbr}`,borderRadius:3,padding:'2px 5px',whiteSpace:'nowrap',flexShrink:0,marginTop:1}}>{pm.date}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:500,color:'var(--n900)'}}>{pm.title}</div>
                      <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>{pm.sub}</div>
                      {pm.badge && <span className={`badge badge-${pm.bC}`} style={{marginTop:4}}>{pm.badge}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:'10px 16px',borderTop:'var(--bdr)',flexShrink:0}}>
                <div style={{background:'var(--sab)',border:'1px solid var(--sabr)',borderRadius:4,padding:'8px 10px',fontSize:12,color:'var(--sat)',display:'flex',alignItems:'center',gap:6}}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2L12 11H2L7 2Z" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M7 6.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                  <strong>7-day resource check:</strong>&nbsp;38 tasks · 6 engineers available
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
