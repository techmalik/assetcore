// Shown when the Supabase env vars are missing, so the app gives a clear,
// actionable message instead of crashing.
export default function NotConfigured() {
  return (
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,boxShadow:'var(--sh-lg)',width:520,overflow:'hidden'}}>
        <div style={{background:'var(--n950)',padding:'20px 28px',display:'flex',alignItems:'center',gap:10}}>
          <svg width="24" height="24" viewBox="0 0 28 28" fill="none"><path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/><text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text></svg>
          <span style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
        </div>
        <div style={{padding:'28px 28px 26px'}}>
          <h1 style={{fontFamily:'var(--ff-d)',fontSize:20,fontWeight:700,color:'var(--n950)',marginBottom:8}}>Backend not configured</h1>
          <p style={{fontSize:13,color:'var(--n600)',lineHeight:1.7,marginBottom:18}}>
            The app needs a Supabase project to connect to. Create one (free), then add its
            keys to <code style={{fontFamily:'var(--ff-m)',background:'var(--n100)',padding:'1px 5px',borderRadius:3}}>apps/app/.env</code>:
          </p>
          <pre style={{fontFamily:'var(--ff-m)',fontSize:12,background:'var(--n950)',color:'var(--b200)',padding:'14px 16px',borderRadius:6,overflowX:'auto',lineHeight:1.7,marginBottom:18}}>{`VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}</pre>
          <ol style={{fontSize:13,color:'var(--n600)',lineHeight:1.8,paddingLeft:18,margin:0}}>
            <li>Create a project at <span style={{fontFamily:'var(--ff-m)'}}>supabase.com</span></li>
            <li>Apply the migration in <span style={{fontFamily:'var(--ff-m)'}}>supabase/migrations</span> and run <span style={{fontFamily:'var(--ff-m)'}}>seed.sql</span></li>
            <li>Enable the Custom Access Token hook (Authentication → Hooks)</li>
            <li>Copy URL + anon key from Project Settings → API into the file above, then restart the dev server</li>
          </ol>
        </div>
      </div>
    </div>
  )
}
