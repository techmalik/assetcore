import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const pmItems = [
  {id:'PM-2025-0312',asset:'NGML-CMP-0017',name:'Delta CS Compressor C-017',type:'Annual Overhaul',site:'Delta CS',due:'15 Jan 25',tech:'EO',techName:'Emeka Obi',est:'8h',status:'Scheduled',priority:'High'},
  {id:'PM-2025-0311',asset:'NGML-MTR-0042',name:'Lagos DS-04 Metering Station',type:'Quarterly Calibration',site:'Lagos DS-04',due:'14 Jan 25',tech:'TF',techName:'Tunde Fashola',est:'3h',status:'Overdue',priority:'Critical'},
  {id:'PM-2025-0309',asset:'NGML-ESD-0007',name:'Lagos ESD Valve 007',type:'Annual Actuator Test',site:'Lagos DS-04',due:'17 Jan 25',tech:'TF',techName:'Tunde Fashola',est:'2h',status:'Scheduled',priority:'High'},
  {id:'PM-2025-0308',asset:'NGML-REG-0089',name:'North Benin PRG-089',type:'Quarterly Service',site:'North Benin',due:'16 Jan 25',tech:'BU',techName:'Bola Umeh',est:'4h',status:'Scheduled',priority:'Medium'},
  {id:'PM-2025-0307',asset:'NGML-SCR-041',name:'Warri Terminal A RTU',type:'Monthly Check',site:'Warri Terminal A',due:'23 Jan 25',tech:'AO',techName:'Adaeze Okeke',est:'1h',status:'Scheduled',priority:'Critical'},
  {id:'PM-2025-0303',asset:'NGML-VLV-0089',name:'Warri T-A Isolation Valve 089',type:'Quarterly Lubrication',site:'Warri Terminal A',due:'17 Jan 25',tech:'AO',techName:'Adaeze Okeke',est:'1h',status:'Complete',priority:'Low'},
  {id:'PM-2025-0299',asset:'NGML-PIP-0312',name:'Aba DN200 Segment 312',type:'Cathodic Protection Survey',site:'Aba Network',due:'10 Apr 25',tech:'EO',techName:'Emeka Obi',est:'6h',status:'Scheduled',priority:'Medium'},
]

const inspections = [
  {id:'INS-2025-0088',asset:'NGML-MTR-0042',name:'Lagos DS-04 Metering Station',inspector:'Tunde Fashola',site:'Lagos DS-04',date:'14 Jan 25',type:'Safety',status:'Due',finding:'Calibration drift detected — 12% below baseline'},
  {id:'INS-2025-0087',asset:'NGML-CMP-0017',name:'Delta CS Compressor C-017',inspector:'Emeka Obi',site:'Delta CS',date:'15 Jan 25',type:'Condition',status:'Scheduled',finding:'Pending inspection'},
  {id:'INS-2025-0086',asset:'NGML-PIP-0312',name:'Aba DN200 Pipeline 312',inspector:'Emeka Obi',site:'Aba Network',date:'10 Jan 25',type:'Integrity',status:'Complete',finding:'No corrosion. Cathodic protection nominal.'},
  {id:'INS-2025-0085',asset:'NGML-ESD-0007',name:'Lagos ESD Valve 007',inspector:'Tunde Fashola',site:'Lagos DS-04',date:'17 Jan 25',type:'Safety',status:'Scheduled',finding:'Annual safety-critical test'},
  {id:'INS-2025-0082',asset:'NGML-VLV-0089',name:'Warri T-A Isolation Valve 089',inspector:'Adaeze Okeke',site:'Warri Terminal A',date:'8 Jan 25',type:'Condition',status:'Complete',finding:'Good condition. Lubrication complete.'},
]

const compliance = [
  {id:'LIC-001',name:'Operating Licence — Lagos DS-04',issuer:'DPR',issued:'15 Jan 24',expires:'14 Jan 26',status:'Active',site:'Lagos DS-04',days:385},
  {id:'LIC-002',name:'Environmental Permit — Delta CS',issuer:'NESREA',issued:'1 Mar 23',expires:'28 Feb 26',status:'Active',site:'Delta CS',days:430},
  {id:'LIC-003',name:'Pressure Vessel Certificate — CMP-0017',issuer:'NSC',issued:'10 Oct 24',expires:'9 Jan 25',status:'Expired',site:'Delta CS',days:-5},
  {id:'LIC-004',name:'Fire Safety Certificate — Warri Terminal A',issuer:'NSCDC',issued:'5 Aug 24',expires:'20 Jan 25',status:'Expiring',site:'Warri Terminal A',days:6},
  {id:'LIC-005',name:'Metering Certification — MTR-0042',issuer:'NMI',issued:'14 Jan 24',expires:'13 Jul 25',status:'Active',site:'Lagos DS-04',days:180},
  {id:'LIC-006',name:'Pipeline Operating Certificate — PIP-0312',issuer:'DPR',issued:'2 Feb 23',expires:'1 Feb 26',status:'Active',site:'Aba Network',days:383},
  {id:'LIC-007',name:'ESD System Certificate — Lagos',issuer:'NSC',issued:'20 Jun 24',expires:'19 Jun 26',status:'Active',site:'Lagos DS-04',days:521},
]

const pmStatus = {
  'Scheduled':{bg:'var(--slb)',c:'var(--slt)',br:'var(--slbr)'},
  'Overdue':{bg:'var(--srb)',c:'var(--srt)',br:'var(--srbr)'},
  'Complete':{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},
  'Due':{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},
}
const avatarColors = {'TF':'var(--b600)','EO':'var(--sg)','AO':'var(--b700)','BU':'var(--sa)'}

const calDays = [
  {d:13,label:'Mon',items:[{id:'PM-2025-0311',color:'var(--sr)',short:'MTR-0042 Calibration'}]},
  {d:14,label:'Tue',items:[{id:'PM-2025-0311',color:'var(--sr)',short:'MTR-0042 Overdue'},{id:'INS-2025-0088',color:'var(--sa)',short:'Lagos Inspection'}],today:true},
  {d:15,label:'Wed',items:[{id:'PM-2025-0312',color:'var(--sl)',short:'CMP-0017 Overhaul'}]},
  {d:16,label:'Thu',items:[{id:'PM-2025-0308',color:'var(--sl)',short:'PRG-089 Service'}]},
  {d:17,label:'Fri',items:[{id:'PM-2025-0309',color:'var(--sl)',short:'ESD Actuator Test'},{id:'PM-2025-0303',color:'var(--sg)',short:'VLV-089 Lubrication'}]},
  {d:18,label:'Sat',items:[]},
  {d:19,label:'Sun',items:[]},
]

export default function Maintenance({ dark, toggleDark }) {
  const [tab, setTab] = useState('pm')

  return (
    <div className="app-shell">
      <Sidebar active="maintenance"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Maintenance" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {/* Header + tabs */}
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Maintenance</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Preventive maintenance, inspections & compliance</p>
              </div>
              <div style={{flex:1}}/>
              <button style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Schedule PM
              </button>
            </div>
            <div style={{display:'flex',gap:0}}>
              {[
                {k:'pm',label:'Preventive Maintenance',count:null},
                {k:'inspections',label:'Inspections',count:null},
                {k:'compliance',label:'Compliance',count:'7'},
              ].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)} style={{display:'flex',alignItems:'center',gap:6}}>
                  {t.label}
                  {t.count && <span style={{background:'var(--srb)',color:'var(--srt)',border:'1px solid var(--srbr)',borderRadius:2,fontSize:9,fontWeight:600,padding:'0 5px',lineHeight:'16px'}}>{t.count}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {tab === 'pm' && (
              <>
                {/* PM Table */}
                <div style={{flex:1,overflowY:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead style={{position:'sticky',top:0,zIndex:10}}>
                      <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                        {['PM ID','Asset','Type','Site','Due','Technician','Est.','Status','Priority'].map(h => (
                          <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pmItems.map(pm => (
                        <tr key={pm.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                          <td style={{padding:'10px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b700)',whiteSpace:'nowrap'}}>{pm.id}</td>
                          <td style={{padding:'10px 14px'}}>
                            <div style={{fontSize:12,fontWeight:500,color:'var(--n900)',whiteSpace:'nowrap'}}>{pm.name}</div>
                            <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{pm.asset}</div>
                          </td>
                          <td style={{padding:'10px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{pm.type}</td>
                          <td style={{padding:'10px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{pm.site}</td>
                          <td style={{padding:'10px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:pm.status==='Overdue'?'var(--srt)':'var(--n600)',whiteSpace:'nowrap'}}>{pm.due}</td>
                          <td style={{padding:'10px 14px'}}>
                            <div style={{display:'flex',alignItems:'center',gap:6}}>
                              <div style={{width:20,height:20,borderRadius:'50%',background:avatarColors[pm.tech]||'var(--b600)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:600,color:'#fff'}}>{pm.tech}</div>
                              <span style={{fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{pm.techName}</span>
                            </div>
                          </td>
                          <td style={{padding:'10px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)',whiteSpace:'nowrap'}}>{pm.est}</td>
                          <td style={{padding:'10px 14px'}}>
                            <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...pmStatus[pm.status]}}>{pm.status}</span>
                          </td>
                          <td style={{padding:'10px 14px'}}>
                            <span style={{fontSize:11,fontWeight:500,color:pm.priority==='Critical'?'var(--srt)':pm.priority==='High'?'var(--sat)':pm.priority==='Medium'?'var(--n600)':'var(--sgt)'}}>{pm.priority}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Calendar */}
                <div style={{width:300,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
                  <div style={{padding:'14px 16px',borderBottom:'var(--bdr)'}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>Jan 13–19, 2025</div>
                    <div style={{fontSize:11,color:'var(--n500)'}}>This week's schedule</div>
                  </div>
                  <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
                    {calDays.map(day => (
                      <div key={day.d} style={{padding:'8px 14px',borderBottom:'var(--bdr)',background:day.today?'var(--b50)':'transparent'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:day.items.length?6:0}}>
                          <div style={{width:24,height:24,borderRadius:'50%',background:day.today?'var(--b500)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:day.today?600:400,color:day.today?'#fff':'var(--n700)'}}>{day.d}</div>
                          <span style={{fontSize:11,color:day.today?'var(--b700)':'var(--n500)',fontWeight:day.today?600:400}}>{day.label}</span>
                          {day.items.length > 0 && <span style={{marginLeft:'auto',fontSize:10,color:'var(--n400)'}}>{day.items.length} task{day.items.length>1?'s':''}</span>}
                        </div>
                        {day.items.map((item,i) => (
                          <div key={i} style={{marginLeft:32,marginBottom:4,padding:'4px 8px',background:'var(--n50)',borderRadius:3,borderLeft:`2px solid ${item.color}`,fontSize:11,color:'var(--n700)'}}>
                            {item.short}
                          </div>
                        ))}
                        {day.items.length === 0 && <div style={{marginLeft:32,fontSize:11,color:'var(--n300)'}}>No tasks</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === 'inspections' && (
              <div style={{flex:1,overflowY:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,zIndex:10}}>
                    <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                      {['Inspection ID','Asset','Type','Site','Date','Inspector','Status','Finding'].map(h => (
                        <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map(ins => (
                      <tr key={ins.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b700)',whiteSpace:'nowrap'}}>{ins.id}</td>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{fontSize:12,fontWeight:500,color:'var(--n900)',whiteSpace:'nowrap'}}>{ins.name}</div>
                          <div style={{fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)'}}>{ins.asset}</div>
                        </td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{ins.type}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{ins.site}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)',whiteSpace:'nowrap'}}>{ins.date}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{ins.inspector}</td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...pmStatus[ins.status]}}>{ins.status}</span>
                        </td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',maxWidth:260,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ins.finding}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'compliance' && (
              <div style={{flex:1,overflowY:'auto'}}>
                {/* Summary strip */}
                <div style={{padding:'14px 24px',borderBottom:'var(--bdr)',background:'var(--n0)',display:'flex',gap:20}}>
                  {[
                    {label:'Active',count:5,c:'var(--sgt)',bg:'var(--sgb)',br:'var(--sgbr)'},
                    {label:'Expiring Soon',count:1,c:'var(--sat)',bg:'var(--sab)',br:'var(--sabr)'},
                    {label:'Expired',count:1,c:'var(--srt)',bg:'var(--srb)',br:'var(--srbr)'},
                  ].map(s => (
                    <div key={s.label} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:s.bg,border:`1px solid ${s.br}`,borderRadius:4}}>
                      <span style={{fontSize:16,fontWeight:700,color:s.c,fontFamily:'var(--ff-m)'}}>{s.count}</span>
                      <span style={{fontSize:12,color:s.c}}>{s.label}</span>
                    </div>
                  ))}
                </div>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead style={{position:'sticky',top:0,zIndex:10}}>
                    <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                      {['ID','Certificate / Licence','Issuer','Site','Issued','Expires','Days','Status','Actions'].map(h => (
                        <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compliance.map(lic => (
                      <tr key={lic.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{lic.id}</td>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{lic.name}</div>
                        </td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{lic.issuer}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{lic.site}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{lic.issued}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:lic.status==='Expired'?'var(--srt)':lic.status==='Expiring'?'var(--sat)':'var(--n600)',whiteSpace:'nowrap'}}>{lic.expires}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:lic.days<0?'var(--srt)':lic.days<30?'var(--sat)':'var(--n600)',whiteSpace:'nowrap'}}>
                          {lic.days < 0 ? `${Math.abs(lic.days)}d ago` : `${lic.days}d`}
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...{Active:{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},Expiring:{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},Expired:{bg:'var(--srb)',c:'var(--srt)',br:'var(--srbr)'}}[lic.status]}}>
                            {lic.status}
                          </span>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <button style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Renew</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
