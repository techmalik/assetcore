import { useState } from 'react'
import { signIn, registerOrg } from '../lib/auth'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text>
  </svg>
)

const ErrorBanner = ({ msg }) => (
  <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 12px',display:'flex',alignItems:'flex-start',gap:8,marginBottom:16}}>
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0,marginTop:1}}><circle cx="7" cy="7" r="5.5" stroke="var(--sr)" strokeWidth="1.2"/><path d="M7 4.5v3M7 8.5v.5" stroke="var(--srt)" strokeWidth="1.2" strokeLinecap="round"/></svg>
    <span style={{fontSize:12,color:'var(--srt)',lineHeight:1.5}}>{msg}</span>
  </div>
)

function LoginScreen({ onSwitch }) {
  // Prefilled with the demo seed login for a one-click pilot demo.
  const [email, setEmail] = useState('a.okeke@ngml.example')
  const [password, setPassword] = useState('Password123!')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      await signIn(email, password)
      // AuthProvider observes the session change and the router redirects.
    } catch (err) {
      setError(err?.message || 'Sign in failed. Check your email and password.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:480}}>
      <div style={{background:'var(--n950)',padding:'24px 32px',display:'flex',alignItems:'center',gap:10}}>
        <Logo/>
        <span style={{fontFamily:'var(--ff-d)',fontSize:18,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
      </div>
      <div style={{padding:'36px 32px'}}>
        <h1 style={{fontFamily:'var(--ff-d)',fontSize:24,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:6}}>Sign in</h1>
        <p style={{fontSize:13,color:'var(--n500)',marginBottom:28}}>Asset management for oil &amp; gas operations</p>

        <button type="button" title="SSO is not enabled yet" disabled className="btn btn-secondary" style={{width:'100%',marginBottom:20,opacity:.55,cursor:'not-allowed'}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx=".8" fill="#4285F4"/><rect x="9" y="2" width="5" height="5" rx=".8" fill="#EA4335"/><rect x="2" y="9" width="5" height="5" rx=".8" fill="#34A853"/><rect x="9" y="9" width="5" height="5" rx=".8" fill="#FBBC05"/></svg>
          Continue with SSO (coming soon)
        </button>

        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{flex:1,height:1,background:'var(--n200)'}}/>
          <span style={{fontSize:12,color:'var(--n400)'}}>or sign in with email</span>
          <div style={{flex:1,height:1,background:'var(--n200)'}}/>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:20}}>
          <div>
            <label className="label">Work email</label>
            <input className="input" value={email} onChange={(e)=>setEmail(e.target.value)} type="email" autoComplete="email" required/>
          </div>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5}}>
              <label className="label" style={{margin:0}}>Password</label>
              <a href="#" onClick={(e)=>{e.preventDefault();alert('Password reset is coming soon. Contact your administrator.')}} style={{fontSize:12,color:'var(--b600)'}}>Forgot password?</a>
            </div>
            <div style={{position:'relative'}}>
              <input className="input" value={password} onChange={(e)=>setPassword(e.target.value)} type={showPw?'text':'password'} autoComplete="current-password" required style={{paddingRight:40}}/>
              <button type="button" onClick={()=>setShowPw(s=>!s)} style={{position:'absolute',right:6,top:'50%',transform:'translateY(-50%)',width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',cursor:'pointer',color:'var(--n400)'}}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.3"/></svg>
              </button>
            </div>
          </div>
        </div>

        {error && <ErrorBanner msg={error}/>}

        <button type="submit" disabled={busy} className="btn btn-primary" style={{width:'100%',height:44,marginBottom:16,fontSize:14,opacity:busy?.7:1}}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={{textAlign:'center',fontSize:13,color:'var(--n500)'}}>
          New to AssetCore? <a href="#" onClick={e=>{e.preventDefault();onSwitch()}} style={{color:'var(--b600)',fontWeight:500}}>Register your organisation</a>
        </div>
      </div>
    </form>
  )
}

function strength(pw) {
  if (!pw) return { w: '0%', label: '', color: 'var(--n200)' }
  if (pw.length < 8) return { w: '33%', label: 'Weak', color: 'var(--sr)' }
  if (pw.length < 12) return { w: '66%', label: 'Fair', color: 'var(--sa)' }
  return { w: '100%', label: 'Strong', color: 'var(--sg)' }
}

function RegisterScreen({ onSwitch }) {
  const [f, setF] = useState({
    orgName: '', shortName: '', industry: 'Oil & Gas Distribution', region: 'Nigeria',
    firstName: '', lastName: '', email: '', password: '', confirm: '', agree: false,
  })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const st = strength(f.password)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!f.agree) return setError('Please accept the Terms of Service to continue.')
    if (f.password !== f.confirm) return setError('Passwords do not match.')
    if (f.password.length < 8) return setError('Password must be at least 8 characters.')
    setBusy(true)
    try {
      await registerOrg({
        fullName: `${f.firstName} ${f.lastName}`.trim(),
        email: f.email, password: f.password,
        orgName: f.orgName, shortName: f.shortName, industry: f.industry, region: f.region,
      })
      // Session now carries org_id; router redirects to the app.
    } catch (err) {
      setError(err?.message || 'Could not create your organisation.')
      setBusy(false)
    }
  }

  const Caret = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
  )

  return (
    <form onSubmit={submit} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:520}}>
      <div style={{background:'var(--n950)',padding:'18px 28px',display:'flex',alignItems:'center',gap:10}}>
        <Logo/>
        <span style={{fontFamily:'var(--ff-d)',fontSize:16,fontWeight:700,color:'#fff'}}>AssetCore</span>
      </div>
      <div style={{padding:'28px 28px 24px'}}>
        <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:4}}>Create your organisation</h1>
        <p style={{fontSize:13,color:'var(--n500)',marginBottom:24}}>Sets up a new multi-tenant workspace for your company</p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
          <div style={{gridColumn:'1/-1'}}>
            <label className="label">Organisation name <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" value={f.orgName} onChange={set('orgName')} placeholder="e.g. Nigeria Gas Marketing Limited" required/>
            <div style={{fontSize:11,color:'var(--n400)',marginTop:4}}>This appears in the app and on all exports</div>
          </div>
          <div>
            <label className="label">Short name / ticker</label>
            <input className="input" value={f.shortName} onChange={set('shortName')} placeholder="e.g. NGML" style={{fontFamily:'var(--ff-m)'}}/>
          </div>
          <div>
            <label className="label">Industry <span style={{color:'var(--sr)'}}>*</span></label>
            <div style={{position:'relative'}}>
              <select className="input" value={f.industry} onChange={set('industry')} style={{appearance:'none',paddingRight:32}}>
                <option>Oil &amp; Gas Distribution</option>
                <option>Oil &amp; Gas Upstream</option>
                <option>Power &amp; Utilities</option>
                <option>Industrial / Manufacturing</option>
              </select>
              <Caret/>
            </div>
          </div>
          <div>
            <label className="label">Primary region <span style={{color:'var(--sr)'}}>*</span></label>
            <div style={{position:'relative'}}>
              <select className="input" value={f.region} onChange={set('region')} style={{appearance:'none',paddingRight:32}}>
                <option>Nigeria</option>
                <option>West Africa</option>
                <option>Other</option>
              </select>
              <Caret/>
            </div>
          </div>
          <div style={{gridColumn:'1/-1',borderTop:'var(--bdr)',paddingTop:14}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--n600)',marginBottom:10}}>Your account details</div>
          </div>
          <div>
            <label className="label">First name <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" value={f.firstName} onChange={set('firstName')} required/>
          </div>
          <div>
            <label className="label">Last name <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" value={f.lastName} onChange={set('lastName')} required/>
          </div>
          <div style={{gridColumn:'1/-1'}}>
            <label className="label">Work email <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" value={f.email} onChange={set('email')} type="email" autoComplete="email" required/>
          </div>
          <div>
            <label className="label">Password <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" value={f.password} onChange={set('password')} type="password" autoComplete="new-password" required/>
            <div style={{height:3,background:'var(--n200)',borderRadius:2,overflow:'hidden',marginTop:5}}>
              <div style={{width:st.w,height:'100%',background:st.color,borderRadius:2,transition:'width .15s'}}/>
            </div>
            <div style={{fontSize:11,color:st.color==='var(--n200)'?'var(--n400)':st.color,marginTop:3,minHeight:14}}>{st.label}</div>
          </div>
          <div>
            <label className="label">Confirm password <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" value={f.confirm} onChange={set('confirm')} type="password" autoComplete="new-password" required/>
          </div>
        </div>

        <label style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:18,padding:'10px 12px',background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:4,cursor:'pointer'}}>
          <input type="checkbox" checked={f.agree} onChange={set('agree')} style={{width:15,height:15,marginTop:1,flexShrink:0,accentColor:'var(--b500)'}}/>
          <span style={{fontSize:12,color:'var(--n700)',lineHeight:1.5}}>I agree to AssetCore's <a href="#" onClick={e=>e.preventDefault()} style={{color:'var(--b600)'}}>Terms of Service</a> and <a href="#" onClick={e=>e.preventDefault()} style={{color:'var(--b600)'}}>Privacy Policy</a>. I confirm I am authorised to register this organisation.</span>
        </label>

        {error && <ErrorBanner msg={error}/>}

        <button type="submit" disabled={busy} className="btn btn-primary" style={{width:'100%',height:44,marginBottom:10,opacity:busy?.7:1}}>
          {busy ? 'Creating…' : 'Create organisation →'}
        </button>
        <div style={{textAlign:'center',fontSize:12,color:'var(--n400)'}}>Already have an account? <a href="#" onClick={e=>{e.preventDefault();onSwitch()}} style={{color:'var(--b600)'}}>Sign in</a></div>
      </div>
    </form>
  )
}

export default function Auth() {
  const [screen, setScreen] = useState('login')
  return (
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      {screen === 'login'
        ? <LoginScreen onSwitch={() => setScreen('register')}/>
        : <RegisterScreen onSwitch={() => setScreen('login')}/>
      }
    </div>
  )
}
