// Shown if the API base URL can't be reached, so the app gives a clear,
// actionable message instead of crashing.
export default function NotConfigured() {
  return (
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-lg)',width:'100%',maxWidth:520,overflow:'hidden'}}>
        <div style={{background:'var(--n950)',padding:'20px 28px',display:'flex',alignItems:'center',gap:10}}>
          <svg width="24" height="24" viewBox="0 0 28 28" fill="none"><path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/><text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text></svg>
          <span style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
        </div>
        <div style={{padding:'28px 28px 26px'}}>
          <h1 style={{fontFamily:'var(--ff-d)',fontSize:20,fontWeight:700,color:'var(--n950)',marginBottom:8}}>Backend unreachable</h1>
          <p style={{fontSize:13,color:'var(--n600)',lineHeight:1.7,marginBottom:18}}>
            The app couldn't reach the AssetCore API. If you're running this locally, make sure
            the API is running (<code style={{fontFamily:'var(--ff-m)',background:'var(--n100)',padding:'1px 5px',borderRadius:3}}>npm run dev:api</code>)
            and that <code style={{fontFamily:'var(--ff-m)',background:'var(--n100)',padding:'1px 5px',borderRadius:3}}>VITE_API_URL</code> in
            <code style={{fontFamily:'var(--ff-m)',background:'var(--n100)',padding:'1px 5px',borderRadius:3}}> apps/app/.env</code> (if set) points at it.
          </p>
          <ol style={{fontSize:13,color:'var(--n600)',lineHeight:1.8,paddingLeft:18,margin:0}}>
            <li>Start Postgres and run <span style={{fontFamily:'var(--ff-m)'}}>node scripts/migrate.mjs</span></li>
            <li>Seed demo data with <span style={{fontFamily:'var(--ff-m)'}}>node scripts/seed-dev.mjs</span></li>
            <li>Start the API with <span style={{fontFamily:'var(--ff-m)'}}>npm run dev:api</span>, then reload this page</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
