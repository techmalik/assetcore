import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const workOrders = [
  {id:'WO-2025-0847',title:'Metering Station DS-04 – Emergency Calibration',site:'Lagos DS-04',asset:'NGML-MTR-0042',assignee:'TF',assigneeName:'Tunde Fashola',status:'In Progress',priority:'Critical',type:'Corrective',due:'14 Jan 25',created:'13 Jan 25',desc:'Emergency recalibration required. Station reading 12% below baseline. All gas measurements affected.'},
  {id:'WO-2025-0846',title:'Delta CS Compressor – Bearing Inspection',site:'Delta CS',asset:'NGML-CMP-0017',assignee:'EO',assigneeName:'Emeka Obi',status:'Open',priority:'High',type:'Preventive',due:'15 Jan 25',created:'12 Jan 25',desc:'Scheduled bearing inspection per maintenance plan. Unit running at 61% health score.'},
  {id:'WO-2025-0844',title:'Warri Terminal A RTU – Sensor Replacement',site:'Warri Terminal A',asset:'NGML-SCR-041',assignee:'AO',assigneeName:'Adaeze Okeke',status:'Open',priority:'Critical',type:'Corrective',due:'15 Jan 25',created:'12 Jan 25',desc:'RTU sensors showing intermittent failures. SCADA data integrity at risk. Replacement parts on order.'},
  {id:'WO-2025-0843',title:'North Benin PRG-089 – Pressure Regulator Service',site:'North Benin',asset:'NGML-REG-0089',assignee:'BU',assigneeName:'Bola Umeh',status:'Pending',priority:'Medium',type:'Preventive',due:'16 Jan 25',created:'11 Jan 25',desc:'Quarterly pressure regulator service. Unit at 74% health. No critical faults detected.'},
  {id:'WO-2025-0841',title:'Lagos ESD Valve 007 – Actuator Test',site:'Lagos DS-04',asset:'NGML-ESD-0007',assignee:'TF',assigneeName:'Tunde Fashola',status:'In Progress',priority:'High',type:'Inspection',due:'17 Jan 25',created:'10 Jan 25',desc:'Annual ESD valve actuator functional test. Safety-critical inspection.'},
  {id:'WO-2025-0839',title:'Warri T-A Isolation Valve 089 – Lubrication',site:'Warri Terminal A',asset:'NGML-VLV-0089',assignee:'AO',assigneeName:'Adaeze Okeke',status:'Complete',priority:'Low',type:'Preventive',due:'17 Jan 25',created:'8 Jan 25',desc:'Routine valve lubrication and operation check. Completed ahead of schedule.'},
  {id:'WO-2025-0831',title:'Aba DN200 Segment 312 – Cathodic Protection Check',site:'Aba Network',asset:'NGML-PIP-0312',assignee:'EO',assigneeName:'Emeka Obi',status:'Open',priority:'Medium',type:'Inspection',due:'10 Apr 25',created:'5 Jan 25',desc:'Quarterly cathodic protection survey. Pipeline operating well within parameters.'},
]

const statusStyle = {
  'In Progress':{bg:'var(--slb)',c:'var(--slt)',br:'var(--slbr)'},
  'Open':{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},
  'Pending':{bg:'var(--n100)',c:'var(--n600)',br:'var(--n200)'},
  'Complete':{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},
}
const priorityStyle = {
  'Critical':{bg:'var(--srb)',c:'var(--srt)',br:'var(--srbr)'},
  'High':{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},
  'Medium':{bg:'var(--n100)',c:'var(--n700)',br:'var(--n300)'},
  'Low':{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},
}

const avatarColors = {'TF':'var(--b600)','EO':'var(--sg)','AO':'var(--b700)','BU':'var(--sa)'}

export default function WorkOrders({ dark, toggleDark }) {
  const [selected, setSelected] = useState(workOrders[0])
  const [filter, setFilter] = useState('All')

  const filtered = filter === 'All' ? workOrders : workOrders.filter(w => w.status === filter)

  return (
    <div className="app-shell">
      <Sidebar active="work-orders"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Work Orders" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {/* Toolbar */}
          <div style={{padding:'14px 24px',borderBottom:'var(--bdr)',background:'var(--n0)',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Work Orders</h1>
              <p style={{fontSize:12,color:'var(--n500)'}}>143 open · 12 overdue · Updated 14 Jan 2025</p>
            </div>
            <div style={{flex:1}}/>
            <div style={{display:'flex',gap:6}}>
              {['All','Open','In Progress','Pending','Complete'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{height:28,padding:'0 10px',border:`1px solid ${filter===f?'var(--b300)':'var(--n200)'}`,borderRadius:4,background:filter===f?'var(--b50)':'var(--n0)',fontSize:12,color:filter===f?'var(--b700)':'var(--n600)',cursor:'pointer'}}>{f}</button>
              ))}
            </div>
            <button style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
              New Work Order
            </button>
          </div>

          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {/* List */}
            <div style={{width:480,flexShrink:0,borderRight:'var(--bdr)',overflowY:'auto',background:'var(--n0)'}}>
              {filtered.map(wo => (
                <div key={wo.id} onClick={() => setSelected(wo)} style={{padding:'14px 18px',borderBottom:'var(--bdr)',cursor:'pointer',background:selected?.id===wo.id?'var(--b50)':'transparent',borderLeft:`3px solid ${selected?.id===wo.id?'var(--b500)':'transparent'}`}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:10,marginBottom:6}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)',marginBottom:2}}>{wo.id}</div>
                      <div style={{fontSize:13,fontWeight:500,color:'var(--n900)',lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{wo.title}</div>
                    </div>
                    <div style={{width:26,height:26,borderRadius:'50%',background:avatarColors[wo.assignee]||'var(--b600)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:'#fff',flexShrink:0}}>{wo.assignee}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                    <span style={{display:'inline-flex',padding:'1px 6px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...statusStyle[wo.status]}}>{wo.status}</span>
                    <span style={{display:'inline-flex',padding:'1px 6px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...priorityStyle[wo.priority]}}>{wo.priority}</span>
                    <span style={{fontSize:10,color:'var(--n400)',marginLeft:'auto'}}>{wo.site}</span>
                    <span style={{fontFamily:'var(--ff-m)',fontSize:10,color:wo.priority==='Critical'?'var(--srt)':'var(--n500)'}}>{wo.due}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Detail */}
            {selected && (
              <div style={{flex:1,overflowY:'auto',background:'var(--n50)',padding:'20px 24px',display:'flex',flexDirection:'column',gap:16}}>
                <div>
                  <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b600)',marginBottom:4}}>{selected.id}</div>
                  <h2 style={{fontFamily:'var(--ff-d)',fontSize:20,fontWeight:700,color:'var(--n950)',letterSpacing:'-.3px',marginBottom:12}}>{selected.title}</h2>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <span style={{display:'inline-flex',padding:'2px 8px',borderRadius:2,border:'1px solid',fontSize:11,fontWeight:500,...statusStyle[selected.status]}}>{selected.status}</span>
                    <span style={{display:'inline-flex',padding:'2px 8px',borderRadius:2,border:'1px solid',fontSize:11,fontWeight:500,...priorityStyle[selected.priority]}}>{selected.priority} Priority</span>
                    <span className="badge badge-n">{selected.type}</span>
                  </div>
                </div>

                {/* Description */}
                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px'}}>
                  <div style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',marginBottom:8,fontFamily:'var(--ff-m)'}}>Description</div>
                  <p style={{fontSize:13,color:'var(--n700)',lineHeight:1.7}}>{selected.desc}</p>
                </div>

                {/* Details grid */}
                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                  <div style={{padding:'10px 14px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Details</div>
                  {[
                    ['Site', selected.site],
                    ['Asset', selected.asset],
                    ['Assigned to', selected.assigneeName],
                    ['Created', selected.created],
                    ['Due date', selected.due],
                    ['Type', selected.type],
                  ].map(([k,v]) => (
                    <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',borderBottom:'var(--bdr)',fontSize:12}}>
                      <span style={{color:'var(--n500)'}}>{k}</span>
                      <span style={{color:'var(--n800)',fontWeight:500,fontFamily:k==='Asset'||k==='Created'||k==='Due date'?'var(--ff-m)':'inherit'}}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* Activity */}
                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                  <div style={{padding:'10px 14px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Activity</div>
                  <div style={{padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>
                    {[
                      {who:'TF',name:'Tunde Fashola',msg:'Work order created and assigned.',time:'13 Jan · 09:14'},
                      {who:'AO',name:'Adaeze Okeke',msg:'Priority escalated to Critical due to measurement drift.',time:'13 Jan · 11:32'},
                      {who:'TF',name:'Tunde Fashola',msg:'Technician dispatched to site.',time:'14 Jan · 08:05'},
                    ].map((a,i) => (
                      <div key={i} style={{display:'flex',gap:10}}>
                        <div style={{width:24,height:24,borderRadius:'50%',background:avatarColors[a.who]||'var(--b600)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:600,color:'#fff',flexShrink:0}}>{a.who}</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:'var(--n800)'}}><span style={{fontWeight:500}}>{a.name}</span> — {a.msg}</div>
                          <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)',marginTop:2}}>{a.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{padding:'10px 14px',borderTop:'var(--bdr)',display:'flex',gap:8}}>
                    <input className="input" placeholder="Add a comment…" style={{flex:1,height:32}}/>
                    <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:12}}>Post</button>
                  </div>
                </div>

                {/* Actions */}
                <div style={{display:'flex',gap:8}}>
                  {selected.status !== 'Complete' && (
                    <button className="btn btn-primary" style={{flex:1,height:36,fontSize:13}}>
                      {selected.status === 'Open' ? 'Start Work Order' : selected.status === 'In Progress' ? 'Mark Complete' : 'Activate'}
                    </button>
                  )}
                  <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>Edit</button>
                  <button className="btn btn-secondary" style={{height:36,padding:'0 16px',fontSize:13}}>Print</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
