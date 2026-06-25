import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const assets = [
  {ain:'NGML-MTR-0042',name:'Lagos DS-04 Metering Station',cat:'Metering Station',site:'Lagos DS-04',status:'Critical',health:32,lastPM:'8 Jan 25',nextPM:'14 Jan 25',value:'₦195.4M'},
  {ain:'NGML-CMP-0017',name:'Delta Compression Station C-017',cat:'Compressor',site:'Delta CS',status:'Attention',health:61,lastPM:'2 Dec 24',nextPM:'15 Jan 25',value:'₦840.2M'},
  {ain:'NGML-REG-0089',name:'North Benin PRG-089',cat:'Pressure Regulator',site:'North Benin',status:'Attention',health:74,lastPM:'2 Jan 25',nextPM:'16 Jan 25',value:'₦24.1M'},
  {ain:'NGML-VLV-0089',name:'Warri T-A Isolation Valve 089',cat:'Valve',site:'Warri Terminal A',status:'Operational',health:88,lastPM:'15 Dec 24',nextPM:'17 Jan 25',value:'₦8.7M'},
  {ain:'NGML-PIP-0312',name:'Aba DN200 Pipeline Segment 312',cat:'Pipeline',site:'Aba Network',status:'Operational',health:92,lastPM:'10 Jan 25',nextPM:'10 Apr 25',value:'₦1.2B'},
  {ain:'NGML-SCR-041',name:'Warri Terminal A RTU',cat:'SCADA/RTU',site:'Warri Terminal A',status:'Critical',health:18,lastPM:'5 Jan 25',nextPM:'23 Jan 25',value:'₦12.3M'},
  {ain:'NGML-MTR-0067',name:'Warri Terminal Metering 067',cat:'Metering Station',site:'Warri Terminal A',status:'Operational',health:96,lastPM:'10 Dec 24',nextPM:'21 Jan 25',value:'₦187.6M'},
  {ain:'NGML-ESD-0007',name:'Lagos ESD Valve 007',cat:'ESD Valve',site:'Lagos DS-04',status:'Operational',health:85,lastPM:'20 Nov 24',nextPM:'15 Jan 25',value:'₦18.4M'},
]

const statusStyle = {
  'Critical':{bg:'var(--srb)',c:'var(--srt)',br:'var(--srbr)'},
  'Attention':{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},
  'Operational':{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},
}

export default function Assets({ dark, toggleDark }) {
  const [selected, setSelected] = useState(null)
  const [filter, setFilter] = useState('All')

  const filtered = filter === 'All' ? assets : assets.filter(a => a.status === filter)

  return (
    <div className="app-shell">
      <Sidebar active="assets"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Assets" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {/* Toolbar */}
          <div style={{padding:'16px 24px',borderBottom:'var(--bdr)',background:'var(--n0)',display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
            <div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Asset Registry</h1>
              <p style={{fontSize:12,color:'var(--n500)'}}>2,847 assets · 5 sites · Last updated 14 Jan 2025</p>
            </div>
            <div style={{flex:1}}/>
            <div style={{display:'flex',gap:6}}>
              {['All','Operational','Attention','Critical'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{height:30,padding:'0 12px',border:`1px solid ${filter===f?'var(--b300)':'var(--n200)'}`,borderRadius:4,background:filter===f?'var(--b50)':'var(--n0)',fontSize:12,color:filter===f?'var(--b700)':'var(--n600)',fontWeight:filter===f?500:400,cursor:'pointer'}}>{f}</button>
              ))}
            </div>
            <button style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
              Add Asset
            </button>
            <button style={{height:32,padding:'0 12px',border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',fontSize:13,color:'var(--n700)',cursor:'pointer'}}>Import CSV</button>
          </div>

          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {/* Table */}
            <div style={{flex:1,overflowY:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead style={{position:'sticky',top:0,zIndex:10}}>
                  <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                    {['AIN','Asset Name','Category','Site','Status','Health','Last PM','Next PM','NBV',''].map(h => (
                      <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => (
                    <tr key={a.ain} className="row-hover" style={{borderBottom:'var(--bdr)',cursor:'pointer',background:selected?.ain===a.ain?'var(--b50)':'transparent'}} onClick={() => setSelected(a)}>
                      <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,fontWeight:500,color:'var(--b700)',whiteSpace:'nowrap'}}>{a.ain}</td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{a.name}</div>
                      </td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{a.cat}</td>
                      <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{a.site}</td>
                      <td style={{padding:'11px 14px'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:4,borderRadius:2,padding:'2px 7px',fontSize:11,fontWeight:500,border:'1px solid',background:statusStyle[a.status].bg,color:statusStyle[a.status].c,borderColor:statusStyle[a.status].br,whiteSpace:'nowrap'}}>
                          {a.status}
                        </span>
                      </td>
                      <td style={{padding:'11px 14px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{width:60,height:5,background:'var(--n200)',borderRadius:99,overflow:'hidden'}}>
                            <div style={{width:`${a.health}%`,height:'100%',background:a.health<40?'var(--sr)':a.health<70?'var(--sa)':'var(--sg)',borderRadius:99}}/>
                          </div>
                          <span style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n700)',width:28}}>{a.health}</span>
                        </div>
                      </td>
                      <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{a.lastPM}</td>
                      <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:a.nextPM==='14 Jan 25'||a.nextPM==='15 Jan 25'?'var(--srt)':'var(--n600)',whiteSpace:'nowrap'}}>{a.nextPM}</td>
                      <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n700)',whiteSpace:'nowrap'}}>{a.value}</td>
                      <td style={{padding:'11px 14px'}}>
                        <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--n400)'}}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Detail panel */}
            {selected && (
              <div style={{width:340,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
                <div style={{padding:'16px 20px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b600)',marginBottom:2}}>{selected.ain}</div>
                    <div style={{fontFamily:'var(--ff-d)',fontSize:16,fontWeight:700,color:'var(--n950)',letterSpacing:'-.2px'}}>{selected.name}</div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{width:26,height:26,border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--n500)'}}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  </button>
                </div>
                <div style={{flex:1,overflowY:'auto',padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
                  {/* Status */}
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <span style={{display:'inline-flex',alignItems:'center',gap:4,borderRadius:2,padding:'2px 7px',fontSize:11,fontWeight:500,border:'1px solid',background:statusStyle[selected.status].bg,color:statusStyle[selected.status].c,borderColor:statusStyle[selected.status].br}}>{selected.status}</span>
                    <span className="badge badge-n">{selected.cat}</span>
                    <span className="badge badge-n">{selected.site}</span>
                  </div>

                  {/* Health score */}
                  <div style={{background:'var(--n50)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px'}}>
                    <div style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',marginBottom:10,fontFamily:'var(--ff-m)'}}>Health Score</div>
                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                      <div style={{position:'relative',width:64,height:64,flexShrink:0}}>
                        <svg viewBox="0 0 64 64" width="64" height="64">
                          <circle cx="32" cy="32" r="24" fill="none" stroke="var(--n200)" strokeWidth="7"/>
                          <circle cx="32" cy="32" r="24" fill="none" stroke={selected.health<40?'var(--sr)':selected.health<70?'var(--sa)':'var(--sg)'} strokeWidth="7" strokeDasharray={`${150.8*selected.health/100} ${150.8}`} strokeLinecap="round" transform="rotate(-90 32 32)"/>
                        </svg>
                        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                          <span style={{fontFamily:'var(--ff-m)',fontSize:16,fontWeight:500,color:selected.health<40?'var(--srt)':selected.health<70?'var(--sat)':'var(--sgt)'}}>{selected.health}</span>
                        </div>
                      </div>
                      <div style={{fontSize:12,color:'var(--n600)',lineHeight:1.6}}>
                        <div style={{fontWeight:600,color:'var(--n800)',marginBottom:4}}>{selected.status === 'Critical' ? 'Critical condition' : selected.status === 'Attention' ? 'Needs attention' : 'Healthy'}</div>
                        Last inspected: {selected.lastPM}
                      </div>
                    </div>
                  </div>

                  {/* Specs */}
                  <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                    <div style={{padding:'10px 14px',borderBottom:'var(--bdr)',fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)'}}>Details</div>
                    {[
                      ['AIN',selected.ain],['Category',selected.cat],['Site',selected.site],
                      ['Last PM',selected.lastPM],['Next PM',selected.nextPM],['NBV',selected.value],
                    ].map(([k,v]) => (
                      <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',borderBottom:'var(--bdr)',fontSize:12}}>
                        <span style={{color:'var(--n500)'}}>{k}</span>
                        <span style={{color:'var(--n800)',fontWeight:500,fontFamily:k==='AIN'||k==='Last PM'||k==='Next PM'||k==='NBV'?'var(--ff-m)':'inherit'}}>{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <button className="btn btn-primary" style={{width:'100%',height:36,fontSize:13}}>Raise Work Order</button>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      <button className="btn btn-secondary" style={{height:34,fontSize:13}}>Edit Asset</button>
                      <button className="btn btn-secondary" style={{height:34,fontSize:13}}>Schedule PM</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
