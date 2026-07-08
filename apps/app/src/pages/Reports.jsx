import { useState, useEffect, useCallback, useRef } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listReports, requestReport, simulateReportReady } from '../lib/db/reports'

const KIND_META = {
  health:      { label:'Health',      icon:'H', bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)' },
  work_orders: { label:'Work Orders', icon:'W', bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  maintenance: { label:'Maintenance', icon:'M', bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)' },
  compliance:  { label:'Compliance',  icon:'C', bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)' },
  inspection:  { label:'Inspection',  icon:'I', bg:'var(--n100)', c:'var(--n700)', br:'var(--n300)' },
  financial:   { label:'Financial',   icon:'F', bg:'var(--b50)', c:'var(--b700)', br:'var(--b200)' },
}

const STATUS_META = {
  pending:    { label:'Pending',    bg:'var(--n100)', c:'var(--n600)', br:'var(--n300)' },
  generating: { label:'Generating', bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  ready:      { label:'Ready',      bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)' },
  failed:     { label:'Failed',     bg:'var(--srb)', c:'var(--srt)', br:'var(--srbr)' },
}

const TEMPLATES = [
  { key:'health',      label:'Asset Health Summary',       desc:'Fleet health KPIs, critical assets, health score trends' },
  { key:'work_orders', label:'Work Order Report',          desc:'Open, in-progress and completed work orders by site/type' },
  { key:'maintenance', label:'Preventive Maintenance',     desc:'PM completion rates, overdue tasks, upcoming schedule' },
  { key:'compliance',  label:'Compliance Status',          desc:'Licence and certificate status across all sites' },
  { key:'inspection',  label:'Inspection Report',          desc:'Inspection findings, pass rates, follow-up actions' },
  { key:'financial',   label:'Asset Valuation',            desc:'NBV summary, depreciation schedule by category' },
]

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' })
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1000000) return `${(bytes/1000).toFixed(0)} KB`
  return `${(bytes/1000000).toFixed(1)} MB`
}

export default function Reports({ dark, toggleDark }) {
  const [tab, setTab]             = useState('library')
  const [reports, setReports]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [err, setErr]             = useState(null)
  const [selectedKind, setKind]   = useState(null)
  const [format, setFormat]       = useState('xlsx')
  const [dateRange, setDateRange] = useState('last_30')
  const [requesting, setRequesting] = useState(false)
  const [pendingId, setPendingId] = useState(null)
  const pollRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try { setReports(await listReports()) }
    catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll until the pending report is ready
  useEffect(() => {
    if (!pendingId) { clearInterval(pollRef.current); return }
    pollRef.current = setInterval(async () => {
      const updated = await simulateReportReady(pendingId)
      if (updated.status === 'ready') {
        clearInterval(pollRef.current)
        setPendingId(null)
        setReports(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r))
        setTab('library')
      }
    }, 2500)
    return () => clearInterval(pollRef.current)
  }, [pendingId])

  const handleGenerate = async () => {
    if (!selectedKind) return
    const template = TEMPLATES.find(t => t.key === selectedKind)
    const title = `${template.label} — ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`
    setRequesting(true)
    try {
      const row = await requestReport({ title, kind: selectedKind, format, params: { dateRange } })
      setReports(prev => [row, ...prev])
      setPendingId(row.id)
    } catch { /* ignore */ }
    finally { setRequesting(false) }
  }

  return (
    <div className="app-shell">
      <Sidebar active="reports"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Reports" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Reports</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Generate and download operational reports</p>
              </div>
              <div style={{flex:1}}/>
              <button onClick={() => setTab('generate')} style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Generate Report
              </button>
            </div>
            <div style={{display:'flex',gap:0}}>
              {[{k:'library',label:'Report Library'},{k:'generate',label:'Generate Report'}].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            {tab === 'library' && (
              <>
                {loading ? (
                  <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
                ) : err ? (
                  <div style={{padding:24}}>
                    <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{err.includes('does not exist') ? 'Run migration 0004_phase3.sql to enable reports.' : err}</div>
                  </div>
                ) : reports.length === 0 ? (
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',gap:12,textAlign:'center'}}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M2 13V5l6-3 6 3v8" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><rect x="6" y="9" width="4" height="4" rx=".5" stroke="var(--n300)" strokeWidth="1.2"/><path d="M17 8v13M14 18l3 3 3-3" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>No reports yet</div>
                    <div style={{fontSize:13,color:'var(--n500)',maxWidth:300}}>Generate your first report from the templates to see it here.</div>
                    <button onClick={() => setTab('generate')} className="btn btn-primary" style={{marginTop:8,height:34,padding:'0 16px',fontSize:13}}>Generate report</button>
                  </div>
                ) : (
                  <div style={{padding:'20px 24px'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                      <thead>
                        <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                          {['Report Name','Type','Format','Requested','By','Size','Status',''].map(h => (
                            <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map(r => {
                          const km = KIND_META[r.kind]   || KIND_META.health
                          const sm = STATUS_META[r.status] || STATUS_META.pending
                          return (
                            <tr key={r.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                              <td style={{padding:'11px 14px'}}>
                                <div style={{fontSize:13,fontWeight:500,color:'var(--n900)'}}>{r.title}</div>
                              </td>
                              <td style={{padding:'11px 14px'}}>
                                <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:`1px solid ${km.br}`,fontSize:10,fontWeight:500,background:km.bg,color:km.c}}>{km.label}</span>
                              </td>
                              <td style={{padding:'11px 14px'}}>
                                <span style={{background:'var(--n100)',color:'var(--n700)',border:'1px solid var(--n200)',borderRadius:2,fontSize:10,fontWeight:600,padding:'2px 6px',fontFamily:'var(--ff-m)',textTransform:'uppercase'}}>{r.format}</span>
                              </td>
                              <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{fmtDate(r.created_at)}</td>
                              <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{r.created_by_profile?.full_name || '—'}</td>
                              <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{fmtSize(r.file_size_bytes)}</td>
                              <td style={{padding:'11px 14px'}}>
                                <span style={{display:'inline-flex',alignItems:'center',gap:5,padding:'2px 7px',borderRadius:2,border:`1px solid ${sm.br}`,fontSize:10,fontWeight:500,background:sm.bg,color:sm.c}}>
                                  {r.status === 'generating' && <svg width="8" height="8" viewBox="0 0 14 14" fill="none" style={{animation:'spin 1s linear infinite'}}><circle cx="7" cy="7" r="5" stroke={sm.c} strokeWidth="1.8" strokeDasharray="14 8"/></svg>}
                                  {sm.label}
                                </span>
                              </td>
                              <td style={{padding:'11px 14px'}}>
                                {r.status === 'ready' ? (
                                  <button style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0}}>Download</button>
                                ) : r.status === 'pending' || r.status === 'generating' ? (
                                  <span style={{fontSize:11,color:'var(--n400)'}}>Generating…</span>
                                ) : null}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {tab === 'generate' && (
              <div style={{padding:'24px',maxWidth:800}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--n700)',marginBottom:12}}>Select Report Template</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:24}}>
                  {TEMPLATES.map(t => {
                    const m = KIND_META[t.key]
                    const active = selectedKind === t.key
                    return (
                      <div key={t.key} onClick={() => setKind(t.key)} style={{background:'var(--n0)',border:`1px solid ${active?'var(--b400)':'var(--n200)'}`,borderRadius:6,padding:'14px 16px',cursor:'pointer',background:active?'var(--b50)':'var(--n0)'}}>
                        <div style={{width:32,height:32,borderRadius:6,background:active?'var(--b100)':'var(--n100)',border:`1px solid ${active?'var(--b200)':'var(--n200)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:active?'var(--b700)':'var(--n600)',fontFamily:'var(--ff-m)',marginBottom:10}}>{m.icon}</div>
                        <div style={{fontSize:13,fontWeight:600,color:active?'var(--b800)':'var(--n900)',marginBottom:3}}>{t.label}</div>
                        <div style={{fontSize:11,color:'var(--n500)',lineHeight:1.5}}>{t.desc}</div>
                      </div>
                    )
                  })}
                </div>

                <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'18px 20px',marginBottom:20}}>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--n700)',marginBottom:14}}>Parameters</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                    <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:4}}>Date range
                      <select value={dateRange} onChange={e=>setDateRange(e.target.value)} style={{height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',background:'var(--n0)',appearance:'none'}}>
                        <option value="last_7">Last 7 days</option>
                        <option value="last_30">Last 30 days</option>
                        <option value="last_90">Last quarter</option>
                        <option value="ytd">Year to date</option>
                      </select>
                    </label>
                    <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:4}}>Output format
                      <select value={format} onChange={e=>setFormat(e.target.value)} style={{height:34,border:'1px solid var(--n200)',borderRadius:4,padding:'0 10px',fontSize:13,fontFamily:'var(--ff-u)',outline:'none',background:'var(--n0)',appearance:'none'}}>
                        <option value="pdf">PDF</option>
                        <option value="xlsx">Excel (XLSX)</option>
                        <option value="csv">CSV</option>
                      </select>
                    </label>
                  </div>
                </div>

                {!selectedKind && (
                  <div style={{fontSize:12,color:'var(--n400)',marginBottom:12}}>Select a template above to generate a report.</div>
                )}
                <button onClick={handleGenerate} disabled={!selectedKind||requesting} className="btn btn-primary" style={{height:40,padding:'0 24px',fontSize:14,display:'flex',alignItems:'center',gap:8}}>
                  {requesting ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{animation:'spin 1s linear infinite'}}><circle cx="7" cy="7" r="5" stroke="rgba(255,255,255,.4)" strokeWidth="1.6"/><path d="M7 2a5 5 0 015 5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>
                      Requesting…
                    </>
                  ) : 'Generate Report'}
                </button>

                {pendingId && (
                  <div style={{marginTop:16,background:'var(--sab)',border:'1px solid var(--sabr)',borderRadius:6,padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{animation:'spin 1s linear infinite',flexShrink:0}}><circle cx="7" cy="7" r="5" stroke="var(--sat)" strokeWidth="1.8" strokeDasharray="14 8"/></svg>
                    <span style={{fontSize:13,color:'var(--sat)'}}>Report queued — generating… Check the library in a few seconds.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
