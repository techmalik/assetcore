import { useNavigate } from 'react-router-dom'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b500)" strokeWidth="1.8" fill="none"/>
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" fill="var(--b500)" fillOpacity=".08"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b600)">A</text>
  </svg>
)

const Check = ({ color = 'var(--sg)' }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
    <path d="M3 7l2.5 2.5L11 4.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const Cross = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}>
    <path d="M4 4l6 6M10 4l-6 6" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)

export default function Marketing() {
  const nav = useNavigate()

  return (
    <div style={{fontFamily:"'IBM Plex Sans',system-ui,sans-serif",color:'#0d1420',lineHeight:1.6,fontSize:15,background:'#fff'}}>

      {/* NAV */}
      <nav style={{position:'sticky',top:0,zIndex:100,background:'rgba(255,255,255,.96)',backdropFilter:'blur(8px)',borderBottom:'1px solid var(--n200)'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 40px',height:60,display:'flex',alignItems:'center',gap:32}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            <Logo/>
            <span style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,letterSpacing:'-.3px',color:'#0d1420'}}>AssetCore</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:4,flex:1}}>
            {['Features','Pricing','Docs','Blog'].map(l => (
              <a key={l} href={l==='Features'?'#features':l==='Pricing'?'#pricing':'#'} style={{padding:'6px 12px',fontSize:14,color:'var(--n600)',borderRadius:4,textDecoration:'none'}}>{l}</a>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={() => nav('/auth')} style={{fontSize:14,color:'var(--n600)',padding:'8px 12px',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>Sign in</button>
            <button onClick={() => nav('/auth')} style={{height:36,padding:'0 18px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit'}}>Start free trial</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{background:'#0d1420',overflow:'hidden',position:'relative'}}>
        <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:'var(--b500)'}}/>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'96px 40px 80px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:64,alignItems:'center'}}>
            {/* Left copy */}
            <div>
              <div style={{display:'inline-flex',alignItems:'center',gap:6,background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.12)',borderRadius:3,padding:'4px 10px',marginBottom:24}}>
                <span style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b300)',letterSpacing:'.06em',textTransform:'uppercase'}}>Built for oil &amp; gas operators</span>
              </div>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:52,fontWeight:800,letterSpacing:'-1.5px',lineHeight:1.08,color:'#fff',marginBottom:20}}>
                Know, manage,<br/>and protect<br/><span style={{color:'var(--b300)'}}>every asset.</span>
              </h1>
              <p style={{fontSize:17,color:'rgba(255,255,255,.65)',lineHeight:1.7,maxWidth:460,marginBottom:36}}>
                AssetCore is the operations platform for Nigerian gas distribution. From metering stations to SCADA RTUs — a single system of record, with work orders, preventive maintenance, compliance, and a full audit trail built in.
              </p>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:32}}>
                <button onClick={() => nav('/auth')} style={{height:48,padding:'0 28px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:15,fontWeight:500,cursor:'pointer',fontFamily:'inherit'}}>Start free 30-day trial</button>
                <button style={{display:'flex',alignItems:'center',gap:8,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.12)',color:'rgba(255,255,255,.8)',borderRadius:4,padding:'0 20px',height:48,fontSize:14,cursor:'pointer',fontFamily:'inherit'}}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="rgba(255,255,255,.6)" strokeWidth="1.3"/><path d="M6.5 6l4 2-4 2V6Z" fill="rgba(255,255,255,.6)"/></svg>
                  Watch 3-min demo
                </button>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:20}}>
                {[
                  {icon:<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 2l1.2 3.6H12L8.9 7.8l1.2 3.6L7 9.2 3.9 11.4l1.2-3.6L2 5.6h3.8L7 2Z" stroke="rgba(255,255,255,.4)" strokeWidth="1.1"/></svg>,label:'WCAG AA compliant'},
                  {icon:<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="10" height="8" rx="1" stroke="rgba(255,255,255,.4)" strokeWidth="1.1"/><path d="M5 4V3a2 2 0 014 0v1" stroke="rgba(255,255,255,.4)" strokeWidth="1.1"/></svg>,label:'ISO 27001-aligned hosting'},
                  {icon:<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,.4)" strokeWidth="1.1"/><path d="M4.5 7l2 2L9.5 5" stroke="rgba(255,255,255,.4)" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>,label:'No credit card required'},
                ].map(t => (
                  <span key={t.label} style={{fontSize:12,color:'rgba(255,255,255,.4)',display:'flex',alignItems:'center',gap:6}}>{t.icon}{t.label}</span>
                ))}
              </div>
            </div>

            {/* Right: product screenshot mockup */}
            <div style={{position:'relative'}}>
              <div style={{background:'#1a2235',border:'1px solid rgba(255,255,255,.1)',borderRadius:8,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.5)'}}>
                {/* Chrome bar */}
                <div style={{height:36,background:'#111827',display:'flex',alignItems:'center',gap:6,padding:'0 14px',borderBottom:'1px solid rgba(255,255,255,.06)'}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:'#ef4444',opacity:.7}}/>
                  <div style={{width:10,height:10,borderRadius:'50%',background:'#f59e0b',opacity:.7}}/>
                  <div style={{width:10,height:10,borderRadius:'50%',background:'#22c55e',opacity:.7}}/>
                  <div style={{flex:1,background:'rgba(255,255,255,.06)',borderRadius:3,height:22,margin:'0 16px',display:'flex',alignItems:'center',padding:'0 10px'}}>
                    <span style={{fontFamily:'var(--ff-m)',fontSize:10,color:'rgba(255,255,255,.3)'}}>app.assetcore.ng/dashboard</span>
                  </div>
                </div>
                {/* Dashboard preview */}
                <div style={{background:'#f0f2f5',padding:16,fontSize:10}}>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:10}}>
                    {[
                      {label:'Total Assets',val:'2,847'},
                      {label:'Operational',val:'91.4%'},
                      {label:'Open WOs',val:'143',warn:true},
                      {label:'Compliance Alerts',val:'7',crit:true},
                    ].map(k => (
                      <div key={k.label} style={{background:'#fff',borderRadius:4,padding:10,border:'1px solid #e5e8ed'}}>
                        <div style={{fontSize:8,color:k.crit?'oklch(35% .148 25)':k.warn?'oklch(42% .125 72)':'#888',marginBottom:4}}>{k.label}</div>
                        <div style={{fontFamily:'var(--ff-m)',fontSize:18,fontWeight:500,color:'#111',lineHeight:1}}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 200px',gap:8}}>
                    <div style={{background:'#fff',borderRadius:4,border:'1px solid #e5e8ed',overflow:'hidden'}}>
                      <div style={{background:'oklch(95% .015 160)',height:120,position:'relative'}}>
                        <svg style={{position:'absolute',inset:0,width:'100%',height:'100%'}} viewBox="0 0 400 120" preserveAspectRatio="none">
                          <defs><pattern id="mini-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(0,0,0,.05)" strokeWidth="1"/></pattern></defs>
                          <rect x="0" y="0" width="400" height="120" fill="url(#mini-grid)"/>
                          <path d="M60 80 L140 55 L220 50 L300 35 L380 42" stroke="oklch(60% .04 145)" strokeWidth="1.5" fill="none" strokeDasharray="5 3" opacity=".6"/>
                          <path d="M140 55 L160 90 L220 95" stroke="oklch(60% .04 145)" strokeWidth="1.5" fill="none" strokeDasharray="5 3" opacity=".6"/>
                        </svg>
                        {[
                          {l:'15%',t:'55%',c:'oklch(52% .215 25)'},
                          {l:'35%',t:'40%',c:'oklch(68% .182 72)'},
                          {l:'56%',t:'35%',c:'oklch(54% .172 145)'},
                          {l:'76%',t:'28%',c:'oklch(54% .172 145)'},
                        ].map((m,i) => (
                          <div key={i} style={{position:'absolute',left:m.l,top:m.t,width:14,height:14,background:m.c,borderRadius:'50% 50% 50% 0',transform:'translate(-50%,-50%) rotate(-45deg)',boxShadow:'0 1px 4px rgba(0,0,0,.3)'}}/>
                        ))}
                      </div>
                      <div style={{padding:'8px 10px',fontSize:8,fontWeight:600,color:'#555'}}>Asset Network Map — NGML · 5 Sites</div>
                    </div>
                    <div style={{background:'#fff',borderRadius:4,border:'1px solid #e5e8ed',overflow:'hidden'}}>
                      <div style={{padding:'8px 10px',fontSize:8,fontWeight:600,color:'#555',borderBottom:'1px solid #f0f0f0'}}>Active Alerts</div>
                      {[
                        {title:'Pressure drop — MTR-0042',sub:'Critical · Lagos · 2h ago',c:'oklch(52% .215 25)'},
                        {title:'SCADA offline — Warri A',sub:'Critical · 47 min ago',c:'oklch(52% .215 25)'},
                        {title:'Licence expiring — LIC-0014',sub:'7 days · NMDPRA · North',c:'oklch(68% .182 72)'},
                      ].map((a,i) => (
                        <div key={i} style={{padding:'6px 10px',borderBottom:'1px solid #f9f9f9',borderLeft:`2px solid ${a.c}`}}>
                          <div style={{fontSize:8,fontWeight:500,color:'#111'}}>{a.title}</div>
                          <div style={{fontSize:7,color:'#888',marginTop:1}}>{a.sub}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              {/* Floating badge */}
              <div style={{position:'absolute',bottom:-16,right:-16,background:'#fff',border:'1px solid var(--n200)',borderRadius:6,padding:'10px 14px',boxShadow:'0 8px 24px rgba(8,18,42,.12)',display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:8,height:8,background:'var(--sg)',borderRadius:'50%',flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:500,color:'var(--n700)'}}>2,601 assets operational · NGML</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <div style={{borderBottom:'1px solid var(--n200)',background:'var(--n50)'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'24px 40px',display:'flex',alignItems:'center',gap:32,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--n400)',letterSpacing:'.06em',textTransform:'uppercase',whiteSpace:'nowrap',flexShrink:0}}>Design partner &amp; pilot</span>
          <div style={{height:1,background:'var(--n200)',flex:1}}/>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{minWidth:36,height:20,background:'var(--b800)',borderRadius:3,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'}}>
              <span style={{fontFamily:'var(--ff-m)',fontSize:8,fontWeight:700,color:'var(--b200)',whiteSpace:'nowrap'}}>NGML</span>
            </div>
            <span style={{fontSize:13,fontWeight:600,color:'var(--n600)'}}>Nigerian Gas Marketing &amp; Liquefaction Co. (NNPC Subsidiary)</span>
          </div>
          <div style={{height:1,background:'var(--n200)',flex:1}}/>
          <span style={{fontSize:12,color:'var(--n400)'}}>Built alongside NGML field engineers. More operators coming in 2025.</span>
        </div>
      </div>

      {/* PROBLEM → SOLUTION */}
      <section id="features" style={{padding:'96px 0 80px'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 40px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:64,alignItems:'center',marginBottom:96}}>
            <div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b500)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:14}}>The problem</div>
              <h2 style={{fontFamily:'var(--ff-d)',fontSize:36,fontWeight:700,letterSpacing:'-.5px',lineHeight:1.2,color:'#0d1420',marginBottom:16}}>Your asset data is in six spreadsheets. Your team is on WhatsApp. Your regulator is asking questions.</h2>
              <p style={{fontSize:16,color:'var(--n600)',lineHeight:1.75,marginBottom:24}}>Nigerian gas distribution operators track critical infrastructure in disconnected Excel files, WhatsApp groups, and paper logbooks. Maintenance gets missed. Licences lapse. Audits take weeks. Incidents happen.</p>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {[
                  'No single source of truth for 2,000+ assets across multiple sites',
                  'Preventive maintenance missed because reminders live in someone\'s calendar',
                  'NMDPRA audit requests trigger emergency scrambles to reconstruct records',
                ].map(t => (
                  <div key={t} style={{display:'flex',alignItems:'flex-start',gap:10}}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,marginTop:2}}><circle cx="8" cy="8" r="6.5" stroke="oklch(52% .215 25)" strokeWidth="1.3"/><path d="M8 5v4M8 10.5v.5" stroke="oklch(52% .215 25)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    <span style={{fontSize:14,color:'var(--n600)'}}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:'var(--n50)',border:'1px solid var(--n200)',borderRadius:8,padding:28}}>
              <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b500)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:14}}>The solution</div>
              <div style={{display:'flex',flexDirection:'column',gap:16}}>
                {[
                  {bg:'var(--b50)',br:'var(--b200)',icon:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 7h10M3 10h6" stroke="var(--b500)" strokeWidth="1.4" strokeLinecap="round"/></svg>,title:'Geo-tagged asset register',desc:'Every asset with GPS, specs, history, photos, and audit trail. Filterable map view.'},
                  {bg:'var(--sgb)',br:'var(--sgbr)',icon:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="4" width="10" height="9" rx="1" stroke="var(--sg)" strokeWidth="1.3"/><path d="M5 4V3a1 1 0 012 0v1M9 4V3a1 1 0 012 0v1" stroke="var(--sg)" strokeWidth="1.3"/></svg>,title:'Automated maintenance scheduling',desc:'PMs triggered by calendar and usage. Overdue alerts before failure.'},
                  {bg:'var(--sab)',br:'var(--sabr)',icon:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="var(--sa)" strokeWidth="1.3"/><path d="M8 5v3.5l2 1.5" stroke="var(--sa)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,title:'Compliance & licence tracking',desc:'90/30/7-day renewal alerts per regulatory authority. Instant audit exports.'},
                  {bg:'var(--b50)',br:'var(--b200)',icon:<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="var(--b500)" strokeWidth="1.3"/><path d="M6 6h4M6 9h2" stroke="var(--b500)" strokeWidth="1.3" strokeLinecap="round"/></svg>,title:'Work orders & role-based access',desc:'Kanban board, SLA timers, field technician mobile access. Full audit log.'},
                ].map(s => (
                  <div key={s.title} style={{display:'flex',alignItems:'flex-start',gap:12}}>
                    <div style={{width:36,height:36,background:s.bg,border:`1px solid ${s.br}`,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{s.icon}</div>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:'#0d1420',marginBottom:3}}>{s.title}</div>
                      <div style={{fontSize:13,color:'var(--n600)'}}>{s.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feature grid */}
          <div style={{textAlign:'center',marginBottom:48}}>
            <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b500)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:12}}>Platform capabilities</div>
            <h2 style={{fontFamily:'var(--ff-d)',fontSize:40,fontWeight:800,letterSpacing:'-.7px',lineHeight:1.15,color:'#0d1420'}}>Everything your operations team needs</h2>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:1,background:'var(--n200)',border:'1px solid var(--n200)',borderRadius:8,overflow:'hidden',marginBottom:80}}>
            {[
              {bg:'var(--b50)',br:'var(--b200)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 4.5h12M3 9h12M3 13.5h7" stroke="var(--b500)" strokeWidth="1.5" strokeLinecap="round"/></svg>,title:'Asset Register',desc:'Centralised, geo-tagged record of every asset — metering stations, compressors, regulators, valves, pipelines, SCADA. Import via CSV or add manually. Depreciation and net book value computed automatically.'},
              {bg:'var(--sgb)',br:'var(--sgbr)',badge:'Integration',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="5" width="6" height="8" rx="1" stroke="var(--sg)" strokeWidth="1.5"/><rect x="10" y="5" width="6" height="8" rx="1" stroke="var(--sg)" strokeWidth="1.5"/><path d="M8 9h2M5 7.5h2M11 7.5h2M5 10.5h2M11 10.5h2" stroke="var(--sg)" strokeWidth="1.3" strokeLinecap="round"/></svg>,title:'SAP Integration',desc:'Sync asset masters, work orders, and procurement requests with SAP PM/EAM. Push WO completions back to SAP. Configurable field mapping — no custom ABAP required. Documented REST interface for your SAP team.'},
              {bg:'var(--sab)',br:'var(--sabr)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6" stroke="var(--sa)" strokeWidth="1.5"/><path d="M6 9l2 2L12 7" stroke="var(--sa)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,title:'Traffic-light Health',desc:'Every asset gets a health score (0–100) and a colour-coded condition: Operational / Attention / Critical / Offline. Status is always paired with an icon and label — never colour alone. WCAG AA throughout.'},
              {bg:'var(--sab)',br:'var(--sabr)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="5" width="12" height="10" rx="1.5" stroke="var(--sa)" strokeWidth="1.5"/><path d="M6 5V4a1 1 0 012 0v1M10 5V4a1 1 0 012 0v1" stroke="var(--sa)" strokeWidth="1.5"/></svg>,title:'Preventive Maintenance',desc:'Calendar and list view of all scheduled PMs. 7-day resource check flags conflicts before they happen. Overdue tasks surface immediately. Auto-reschedule when conflicts detected.'},
              {bg:'var(--b50)',br:'var(--b200)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3.5" y="2" width="11" height="14" rx="1.5" stroke="var(--b500)" strokeWidth="1.5"/><path d="M6.5 7h5M6.5 10h3" stroke="var(--b500)" strokeWidth="1.4" strokeLinecap="round"/></svg>,title:'Work Orders',desc:'Kanban board (New → Assigned → In Progress → Awaiting Parts → Inspection → Closed). Priority badges, SLA timers, photo uploads, parts tracking. Emergency vs standard branching.'},
              {bg:'var(--srb)',br:'oklch(87% .088 25)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="6" stroke="var(--sr)" strokeWidth="1.5"/><path d="M9 6v4M9 11.5v.5" stroke="var(--sr)" strokeWidth="1.5" strokeLinecap="round"/></svg>,title:'Compliance & Licences',desc:'Track every NMDPRA, NUPRC, and NESREA licence with 90/30/7-day alert cadence. Renewal workflow with inspection gate. Document filing. Tenant-defined regulatory authorities.'},
              {bg:'var(--n50)',br:'var(--n200)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="6" r="2.5" stroke="var(--n500)" strokeWidth="1.5"/><circle cx="4" cy="13" r="2" stroke="var(--n500)" strokeWidth="1.5"/><circle cx="14" cy="13" r="2" stroke="var(--n500)" strokeWidth="1.5"/><path d="M9 8.5v2M9 10.5l-4 1M9 10.5l4 1" stroke="var(--n500)" strokeWidth="1.3" strokeLinecap="round"/></svg>,title:'GPS / IoT Telemetry',desc:'Connect field devices and SCADA RTUs to stream readings into the asset timeline. Pressure, flow, and temperature alerts trigger work orders automatically. Offline-tolerant edge buffering.'},
              {bg:'var(--n50)',br:'var(--n200)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4h10M4 8h10M4 12h6" stroke="var(--n500)" strokeWidth="1.5" strokeLinecap="round"/></svg>,title:'Role-based Access',desc:'Org Owner, Ops Manager, Maintenance Engineer, Field Technician, HSE Officer, Viewer. Field techs see a reduced mobile-optimised interface. Billing visible to Owner only. Complete audit trail.'},
              {bg:'var(--b50)',br:'var(--b200)',icon:<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 13l3-4 3 2 3-5 3 3" stroke="var(--b500)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="3" width="12" height="10" rx="1" stroke="var(--b500)" strokeWidth="1.3"/></svg>,title:'Reports & Analytics',desc:'Generate PDF condition reports, maintenance summaries, and compliance packs on demand. Scheduled exports direct to your inbox. XLSX output for finance and audit hand-offs.'},
            ].map(f => (
              <div key={f.title} style={{background:'#fff',padding:28}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
                  <div style={{width:40,height:40,background:f.bg,border:`1px solid ${f.br}`,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{f.icon}</div>
                  {f.badge && <span style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--sg)',background:'var(--sgb)',border:'1px solid var(--sgbr)',borderRadius:3,padding:'2px 6px'}}>{f.badge}</span>}
                </div>
                <h3 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'#0d1420',marginBottom:8}}>{f.title}</h3>
                <p style={{fontSize:13,color:'var(--n600)',lineHeight:1.7}}>{f.desc}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div style={{textAlign:'center',marginBottom:48}}>
            <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b500)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:12}}>Get started in hours</div>
            <h2 style={{fontFamily:'var(--ff-d)',fontSize:36,fontWeight:800,letterSpacing:'-.5px',color:'#0d1420'}}>Four steps to full operation</h2>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:0,position:'relative',marginBottom:80}}>
            <div style={{position:'absolute',top:28,left:'12.5%',right:'12.5%',height:1,background:'var(--b200)',zIndex:0}}/>
            {[
              {n:1,bg:'var(--b500)',tc:'#fff',title:'Sign up & configure',desc:'Register your org, add sites, set your asset categories, regulatory authorities, and units of measure.'},
              {n:2,bg:'var(--b500)',tc:'#fff',border:'3px solid var(--b300)',title:'Import your assets',desc:'Upload your existing asset register via CSV. Map your columns to AssetCore fields. Validate and go live.'},
              {n:3,bg:'var(--b300)',tc:'var(--b800)',title:'Invite your team',desc:'Add engineers, technicians, and HSE officers by email. Assign roles and site access. They log in immediately.'},
              {n:4,bg:'var(--b200)',tc:'var(--b800)',title:'Operate',desc:'Run work orders, schedule maintenance, track compliance, and generate audit-ready reports — from day one.'},
            ].map(s => (
              <div key={s.n} style={{textAlign:'center',padding:'0 16px',position:'relative',zIndex:1}}>
                <div style={{width:56,height:56,background:s.bg,border:s.border||'none',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
                  <span style={{fontFamily:'var(--ff-m)',fontSize:18,fontWeight:600,color:s.tc}}>{s.n}</span>
                </div>
                <h4 style={{fontSize:15,fontWeight:600,color:'#0d1420',marginBottom:8}}>{s.title}</h4>
                <p style={{fontSize:13,color:'var(--n600)',lineHeight:1.65}}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY */}
      <div style={{background:'#0d1420',padding:'48px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 40px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:32,alignItems:'start'}}>
            <div style={{gridColumn:'1/3'}}>
              <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b300)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:12}}>Security &amp; compliance</div>
              <h2 style={{fontFamily:'var(--ff-d)',fontSize:28,fontWeight:700,letterSpacing:'-.4px',color:'#fff',marginBottom:12}}>Enterprise-grade security,<br/>built for Nigerian infrastructure</h2>
              <p style={{fontSize:14,color:'rgba(255,255,255,.55)',lineHeight:1.7}}>AssetCore is designed for operators running safety-critical infrastructure. Your data is encrypted in transit and at rest, access is logged to the keystroke, and every change to every record is immutable.</p>
            </div>
            {[
              ['AES-256 encryption at rest','TLS 1.3 in transit','Immutable audit log','SSO + TOTP MFA'],
              ['ISO 27001-aligned hosting','NDPR data residency options','Role-based access control','99.9% uptime SLA'],
            ].map((col,ci) => (
              <div key={ci} style={{display:'flex',flexDirection:'column',gap:12}}>
                {col.map(item => (
                  <div key={item} style={{display:'flex',alignItems:'center',gap:10}}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--b300)" strokeWidth="1.3"/><path d="M5.5 8l2 2L10.5 6" stroke="var(--b300)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span style={{fontSize:13,color:'rgba(255,255,255,.7)'}}>{item}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <section id="pricing" style={{padding:'96px 0 80px',background:'var(--n50)'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 40px'}}>
          <div style={{textAlign:'center',marginBottom:48}}>
            <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b500)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:12}}>Pricing</div>
            <h2 style={{fontFamily:'var(--ff-d)',fontSize:40,fontWeight:800,letterSpacing:'-.7px',color:'#0d1420',marginBottom:16}}>Simple, transparent pricing</h2>
            <p style={{fontSize:16,color:'var(--n600)',maxWidth:520,margin:'0 auto 24px'}}>Start with a 30-day free trial. No credit card required. Cancel any time.</p>
          </div>

          {/* Pricing cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:48}}>
            {/* Starter */}
            <div style={{background:'#fff',border:'1px solid var(--n200)',borderRadius:8,padding:28,boxShadow:'0 1px 3px rgba(8,18,42,.07)'}}>
              <div style={{fontFamily:'var(--ff-m)',fontSize:11,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--n500)',marginBottom:10}}>Starter</div>
              <div style={{fontFamily:'var(--ff-d)',fontSize:36,fontWeight:800,color:'#0d1420',lineHeight:1,marginBottom:4}}>$199<span style={{fontSize:16,fontWeight:400,color:'var(--n500)'}}>/mo</span></div>
              <div style={{fontSize:13,color:'var(--n500)',marginBottom:20}}>Up to 5 seats · 500 assets</div>
              <button onClick={() => nav('/auth')} style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:40,background:'transparent',color:'#0d1420',border:'1px solid var(--n300)',borderRadius:4,fontSize:14,fontWeight:500,cursor:'pointer',marginBottom:24,fontFamily:'inherit'}}>Start free trial</button>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {['Asset register + map','Work orders','Basic maintenance scheduling','Email notifications'].map(f => (
                  <div key={f} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--n700)'}}><Check/>{f}</div>
                ))}
                {['Compliance module','Custom reports','SSO / MFA'].map(f => (
                  <div key={f} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--n400)'}}><Cross/>{f}</div>
                ))}
              </div>
            </div>

            {/* Growth */}
            <div style={{background:'#0d1420',border:'1px solid rgba(255,255,255,.1)',borderRadius:8,padding:28,boxShadow:'0 8px 24px rgba(8,18,42,.2)',position:'relative'}}>
              <div style={{position:'absolute',top:-11,left:'50%',transform:'translateX(-50%)',background:'var(--b500)',color:'#fff',fontSize:11,fontWeight:600,padding:'3px 12px',borderRadius:999,whiteSpace:'nowrap'}}>Most popular</div>
              <div style={{fontFamily:'var(--ff-m)',fontSize:11,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--b300)',marginBottom:10}}>Growth</div>
              <div style={{fontFamily:'var(--ff-d)',fontSize:36,fontWeight:800,color:'#fff',lineHeight:1,marginBottom:4}}>$875<span style={{fontSize:16,fontWeight:400,color:'rgba(255,255,255,.5)'}}>/mo</span></div>
              <div style={{fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:20}}>Up to 25 seats · Unlimited assets</div>
              <button onClick={() => nav('/auth')} style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:40,background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:14,fontWeight:500,cursor:'pointer',marginBottom:24,fontFamily:'inherit'}}>Start free trial</button>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {['Everything in Starter','Compliance & licence tracking','Inspections module','Custom reports & export','MFA + audit log export','5 GB document storage'].map(f => (
                  <div key={f} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'rgba(255,255,255,.8)'}}><Check/>{f}</div>
                ))}
                {['SSO / SAML','Dedicated account manager'].map(f => (
                  <div key={f} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'rgba(255,255,255,.5)'}}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0}}><path d="M4 4l6 6M10 4l-6 6" stroke="rgba(255,255,255,.3)" strokeWidth="1.4" strokeLinecap="round"/></svg>{f}
                  </div>
                ))}
              </div>
            </div>

            {/* Enterprise */}
            <div style={{background:'#fff',border:'1px solid var(--n200)',borderRadius:8,padding:28,boxShadow:'0 1px 3px rgba(8,18,42,.07)'}}>
              <div style={{fontFamily:'var(--ff-m)',fontSize:11,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--n500)',marginBottom:10}}>Enterprise</div>
              <div style={{fontFamily:'var(--ff-d)',fontSize:36,fontWeight:800,color:'#0d1420',lineHeight:1,marginBottom:4}}>Custom</div>
              <div style={{fontSize:13,color:'var(--n500)',marginBottom:20}}>Unlimited seats &amp; assets · SLA</div>
              <button style={{display:'flex',alignItems:'center',justifyContent:'center',width:'100%',height:40,background:'#fff',color:'#0d1420',border:'1.5px solid var(--n300)',borderRadius:4,fontSize:14,fontWeight:500,cursor:'pointer',marginBottom:24,fontFamily:'inherit'}}>Contact sales</button>
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {['Everything in Growth','SSO / SAML integration','Dedicated account manager','On-premises / VPC deployment','Custom SCADA / ERP integrations','99.9% uptime SLA','Priority 24/7 support'].map(f => (
                  <div key={f} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,color:'var(--n700)'}}><Check/>{f}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Comparison table */}
          <div style={{background:'#fff',border:'1px solid var(--n200)',borderRadius:8,overflow:'hidden',marginBottom:48,boxShadow:'0 1px 3px rgba(8,18,42,.06)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 120px 120px 120px',background:'var(--n50)',borderBottom:'1px solid var(--n200)'}}>
              <div style={{padding:'12px 20px',fontSize:12,fontWeight:600,color:'var(--n600)'}}>Feature</div>
              <div style={{padding:'12px 16px',textAlign:'center',fontSize:12,fontWeight:600,color:'var(--n600)'}}>Starter</div>
              <div style={{padding:'12px 16px',textAlign:'center',fontSize:12,fontWeight:700,color:'var(--b600)',background:'var(--b50)'}}>Growth</div>
              <div style={{padding:'12px 16px',textAlign:'center',fontSize:12,fontWeight:600,color:'var(--n600)'}}>Enterprise</div>
            </div>
            {[
              {f:'Asset register & map',s:true,g:true,e:true},
              {f:'Work orders & maintenance',s:true,g:true,e:true},
              {f:'Compliance & licences',s:false,g:true,e:true},
              {f:'Inspections module',s:false,g:true,e:true},
              {f:'Reports & exports',s:'Basic',g:true,e:true},
              {f:'SSO / SAML',s:false,g:false,e:true},
              {f:'On-prem / VPC deployment',s:false,g:false,e:true},
            ].map((row,i,arr) => (
              <div key={row.f} style={{display:'grid',gridTemplateColumns:'1fr 120px 120px 120px',borderBottom:i<arr.length-1?'1px solid var(--n200)':'none',alignItems:'center'}}>
                <div style={{padding:'10px 20px',fontSize:13,color:'var(--n800)'}}>{row.f}</div>
                {[row.s,row.g,row.e].map((v,ci) => (
                  <div key={ci} style={{padding:'10px 16px',textAlign:'center',background:ci===1?'var(--b50)':'transparent'}}>
                    {v===true ? <span style={{color:'var(--sgt)',fontSize:16}}>✓</span>
                    : v===false ? <span style={{color:'var(--n300)',fontSize:16}}>—</span>
                    : <span style={{fontSize:12,color:'var(--n500)'}}>{v}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* FAQ */}
          <div style={{maxWidth:700,margin:'0 auto'}}>
            <h3 style={{fontFamily:'var(--ff-d)',fontSize:24,fontWeight:700,color:'#0d1420',marginBottom:24,textAlign:'center'}}>Frequently asked questions</h3>
            <div style={{display:'flex',flexDirection:'column',gap:0,border:'1px solid var(--n200)',borderRadius:8,overflow:'hidden',background:'#fff'}}>
              {[
                {q:'Can I import our existing Excel asset register?',a:"Yes. AssetCore's onboarding wizard accepts CSV and Excel files. You map your columns to AssetCore fields, validate, and your full register is live within minutes."},
                {q:'Does it work offline / in poor network conditions?',a:'The field technician mobile interface is optimised for low-bandwidth environments. Core work order updates and checklist completions sync when connectivity is restored.'},
                {q:'Which Nigerian regulatory authorities are pre-configured?',a:'NMDPRA (primary gas distribution regulator under PIA 2021), NUPRC, NESREA, FRSC, and SON come pre-loaded. You can add any custom authority your operation requires.'},
                {q:'What does "unlimited assets" mean in Growth and Enterprise?',a:'There is no per-asset fee. You can register and manage as many physical assets as your operation requires on Growth and Enterprise plans.'},
              ].map((faq,i,arr) => (
                <div key={faq.q} style={{padding:'16px 20px',borderBottom:i<arr.length-1?'1px solid var(--n200)':'none'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'var(--n900)',marginBottom:6}}>{faq.q}</div>
                  <div style={{fontSize:13,color:'var(--n600)',lineHeight:1.65}}>{faq.a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <div style={{background:'#0d1420',padding:'80px 0'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 40px',textAlign:'center'}}>
          <div style={{fontFamily:'var(--ff-m)',fontSize:11,color:'var(--b300)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:16}}>Get started today</div>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:44,fontWeight:800,letterSpacing:'-1px',color:'#fff',marginBottom:16,lineHeight:1.1}}>One platform for<br/>your entire asset lifecycle.</h2>
          <p style={{fontSize:16,color:'rgba(255,255,255,.55)',maxWidth:480,margin:'0 auto 36px',lineHeight:1.7}}>Start your 30-day free trial. No credit card. No consultant. Import your first assets in under an hour.</p>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:12}}>
            <button onClick={() => nav('/auth')} style={{height:52,padding:'0 32px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:16,fontWeight:500,cursor:'pointer',fontFamily:'inherit'}}>Start free trial</button>
            <button style={{display:'flex',alignItems:'center',gap:8,background:'rgba(255,255,255,.06)',border:'1px solid rgba(255,255,255,.12)',color:'rgba(255,255,255,.8)',borderRadius:4,padding:'0 24px',height:52,fontSize:15,cursor:'pointer',fontFamily:'inherit'}}>Contact sales</button>
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer style={{background:'oklch(8% .006 237)',padding:'48px 0 24px',borderTop:'1px solid rgba(255,255,255,.06)'}}>
        <div style={{maxWidth:1200,margin:'0 auto',padding:'0 40px'}}>
          <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:48,marginBottom:48}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
                <svg width="24" height="24" viewBox="0 0 28 28" fill="none"><path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.8" fill="none"/><text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text></svg>
                <span style={{fontFamily:'var(--ff-d)',fontSize:16,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
              </div>
              <p style={{fontSize:13,color:'rgba(255,255,255,.4)',lineHeight:1.7,maxWidth:280}}>Infrastructure asset management for Nigerian gas &amp; midstream operators. Pilot partner: NGML (NNPC Subsidiary).</p>
              <div style={{marginTop:16,fontFamily:'var(--ff-m)',fontSize:11,color:'rgba(255,255,255,.2)'}}>Lagos · Abuja · Port Harcourt</div>
            </div>
            {[
              {title:'Product',links:['Features','Pricing','Changelog','Roadmap']},
              {title:'Resources',links:['Documentation','NMDPRA compliance guide','API reference','Support']},
              {title:'Legal',links:['Privacy policy','Terms of service','NDPR compliance','Security']},
            ].map(col => (
              <div key={col.title}>
                <div style={{fontSize:11,fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'rgba(255,255,255,.3)',marginBottom:14}}>{col.title}</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {col.links.map(l => <a key={l} href="#" style={{fontSize:13,color:'rgba(255,255,255,.5)',textDecoration:'none'}}>{l}</a>)}
                </div>
              </div>
            ))}
          </div>
          <div style={{borderTop:'1px solid rgba(255,255,255,.06)',paddingTop:20,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:12,color:'rgba(255,255,255,.25)'}}>© 2025 AssetCore Ltd. NGML (NNPC Subsidiary) is a valued client.</span>
            <span style={{fontFamily:'var(--ff-m)',fontSize:11,color:'rgba(255,255,255,.15)'}}>v1.0.0</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
