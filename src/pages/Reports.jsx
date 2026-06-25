import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const reports = [
  {id:'RPT-2025-014',name:'Asset Health Summary – January 2025',type:'Health',site:'All Sites',period:'1–14 Jan 2025',generated:'14 Jan 2025 09:30',by:'System',size:'2.4 MB',format:'PDF'},
  {id:'RPT-2025-013',name:'Compliance Status Report – Q4 2024',type:'Compliance',site:'All Sites',period:'Oct–Dec 2024',generated:'2 Jan 2025 08:00',by:'Adaeze Okeke',size:'1.1 MB',format:'PDF'},
  {id:'RPT-2025-012',name:'Work Order Completion Report – Dec 2024',type:'Work Orders',site:'All Sites',period:'Dec 2024',generated:'1 Jan 2025 08:00',by:'System',size:'0.8 MB',format:'XLSX'},
  {id:'RPT-2025-011',name:'Delta CS Compressor Maintenance Log',type:'Maintenance',site:'Delta CS',period:'Q4 2024',generated:'31 Dec 2024 15:44',by:'Emeka Obi',size:'0.4 MB',format:'PDF'},
  {id:'RPT-2025-010',name:'Lagos DS-04 Site Inspection Report',type:'Inspection',site:'Lagos DS-04',period:'Nov–Dec 2024',generated:'20 Dec 2024 11:20',by:'Tunde Fashola',size:'3.2 MB',format:'PDF'},
  {id:'RPT-2025-009',name:'Asset Valuation – NBV Summary 2024',type:'Financial',site:'All Sites',period:'FY 2024',generated:'10 Dec 2024 09:00',by:'Adaeze Okeke',size:'0.6 MB',format:'XLSX'},
]

const typeColors = {
  'Health':{bg:'var(--sgb)',c:'var(--sgt)',br:'var(--sgbr)'},
  'Compliance':{bg:'var(--slb)',c:'var(--slt)',br:'var(--slbr)'},
  'Work Orders':{bg:'var(--sab)',c:'var(--sat)',br:'var(--sabr)'},
  'Maintenance':{bg:'var(--n100)',c:'var(--n700)',br:'var(--n300)'},
  'Inspection':{bg:'var(--n100)',c:'var(--n700)',br:'var(--n300)'},
  'Financial':{bg:'var(--b50)',c:'var(--b700)',br:'var(--b200)'},
}

const templates = [
  {key:'health',icon:'H',label:'Asset Health Summary',desc:'Overall fleet health, KPI breakdown, critical assets'},
  {key:'wo',icon:'W',label:'Work Order Report',desc:'Open, in-progress and completed work orders'},
  {key:'pm',icon:'M',label:'Preventive Maintenance',desc:'PM completion rates, overdue tasks, upcoming schedule'},
  {key:'compliance',icon:'C',label:'Compliance Status',desc:'Licence and certificate status across all sites'},
  {key:'inspection',icon:'I',label:'Inspection Report',desc:'Inspection findings, pass/fail rates, follow-up actions'},
  {key:'financial',icon:'F',label:'Asset Valuation',desc:'NBV summary, depreciation schedule by category'},
]

export default function Reports({ dark, toggleDark }) {
  const [tab, setTab] = useState('library')
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState(false)

  const handleGenerate = () => {
    setGenerating(true)
    setTimeout(() => { setGenerating(false); setDone(true) }, 1800)
  }

  return (
    <div className="app-shell">
      <Sidebar active="reports"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Reports" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          {/* Header + tabs */}
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Reports</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Generate and manage operational reports</p>
              </div>
            </div>
            <div style={{display:'flex',gap:0}}>
              {[{k:'library',label:'Report Library'},{k:'generate',label:'Generate Report'}].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            {tab === 'library' && (
              <div style={{padding:'20px 24px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                  <thead>
                    <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                      {['ID','Report Name','Type','Site','Period','Generated','By','Size','Format',''].map(h => (
                        <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map(r => (
                      <tr key={r.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:10,color:'var(--n400)',whiteSpace:'nowrap'}}>{r.id}</td>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{r.name}</div>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:'1px solid',fontSize:10,fontWeight:500,...typeColors[r.type]}}>{r.type}</span>
                        </td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{r.site}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{r.period}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{r.generated}</td>
                        <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{r.by}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{r.size}</td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{background:'var(--n100)',color:'var(--n700)',border:'1px solid var(--n200)',borderRadius:2,fontSize:10,fontWeight:600,padding:'2px 6px',fontFamily:'var(--ff-m)'}}>{r.format}</span>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{display:'flex',gap:6}}>
                            <button style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Download</button>
                            <button style={{fontSize:11,color:'var(--n500)',background:'none',border:'none',cursor:'pointer',padding:0}}>Share</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'generate' && (
              <div style={{padding:'24px',display:'flex',gap:20,alignItems:'flex-start'}}>
                {/* Templates */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--n700)',marginBottom:12}}>Select Report Template</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:20}}>
                    {templates.map(t => (
                      <div key={t.key} className="row-hover" style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px',cursor:'pointer'}}>
                        <div style={{width:32,height:32,borderRadius:6,background:'var(--b50)',border:'1px solid var(--b200)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'var(--b700)',fontFamily:'var(--ff-m)',marginBottom:10}}>{t.icon}</div>
                        <div style={{fontSize:13,fontWeight:600,color:'var(--n900)',marginBottom:3}}>{t.label}</div>
                        <div style={{fontSize:11,color:'var(--n500)',lineHeight:1.5}}>{t.desc}</div>
                      </div>
                    ))}
                  </div>

                  {/* Options */}
                  <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'18px 20px',marginBottom:16}}>
                    <div style={{fontSize:13,fontWeight:600,color:'var(--n700)',marginBottom:14}}>Report Parameters</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      <div>
                        <label className="label">Date Range</label>
                        <div style={{position:'relative'}}>
                          <select className="input" style={{appearance:'none',paddingRight:32}}>
                            <option>Last 7 days</option>
                            <option selected>Last 30 days</option>
                            <option>Last quarter</option>
                            <option>This year</option>
                            <option>Custom range</option>
                          </select>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        </div>
                      </div>
                      <div>
                        <label className="label">Site Filter</label>
                        <div style={{position:'relative'}}>
                          <select className="input" style={{appearance:'none',paddingRight:32}}>
                            <option>All Sites</option>
                            <option>Lagos DS-04</option>
                            <option>Delta CS</option>
                            <option>North Benin</option>
                            <option>Warri Terminal A</option>
                            <option>Aba Network</option>
                          </select>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        </div>
                      </div>
                      <div>
                        <label className="label">Output Format</label>
                        <div style={{position:'relative'}}>
                          <select className="input" style={{appearance:'none',paddingRight:32}}>
                            <option>PDF</option>
                            <option>Excel (XLSX)</option>
                            <option>CSV</option>
                          </select>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        </div>
                      </div>
                      <div>
                        <label className="label">Report Name</label>
                        <input className="input" defaultValue="Asset Health Summary – Jan 2025"/>
                      </div>
                    </div>
                  </div>

                  {done ? (
                    <div style={{background:'var(--sgb)',border:'1px solid var(--sgbr)',borderRadius:6,padding:'14px 16px',display:'flex',alignItems:'center',gap:10}}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--sg)" strokeWidth="1.3"/><path d="M5 8l2 2 4-4" stroke="var(--sgt)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span style={{fontSize:13,color:'var(--sgt)',fontWeight:500}}>Report generated successfully.</span>
                      <button style={{marginLeft:'auto',fontSize:12,color:'var(--sgt)',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>Download PDF</button>
                    </div>
                  ) : (
                    <button onClick={handleGenerate} className="btn btn-primary" style={{height:40,padding:'0 24px',fontSize:14,display:'flex',alignItems:'center',gap:8}} disabled={generating}>
                      {generating ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{animation:'spin 1s linear infinite'}}>
                            <circle cx="7" cy="7" r="5" stroke="rgba(255,255,255,.4)" strokeWidth="1.6"/>
                            <path d="M7 2a5 5 0 015 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                          Generating…
                        </>
                      ) : 'Generate Report'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
