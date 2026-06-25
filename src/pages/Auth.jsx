import { useState } from 'react'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text>
  </svg>
)

function LoginScreen({ onSwitch, onLogin }) {
  const [showError, setShowError] = useState(true)
  return (
    <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:480}}>
      <div style={{background:'var(--n950)',padding:'24px 32px',display:'flex',alignItems:'center',gap:10}}>
        <Logo/>
        <span style={{fontFamily:'var(--ff-d)',fontSize:18,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
      </div>
      <div style={{padding:'36px 32px'}}>
        <h1 style={{fontFamily:'var(--ff-d)',fontSize:24,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:6}}>Sign in</h1>
        <p style={{fontSize:13,color:'var(--n500)',marginBottom:28}}>Nigeria Gas Marketing Limited workspace</p>

        <button className="btn btn-secondary" style={{width:'100%',marginBottom:20}}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx=".8" fill="#4285F4"/><rect x="9" y="2" width="5" height="5" rx=".8" fill="#EA4335"/><rect x="2" y="9" width="5" height="5" rx=".8" fill="#34A853"/><rect x="9" y="9" width="5" height="5" rx=".8" fill="#FBBC05"/></svg>
          Continue with Google SSO
        </button>

        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{flex:1,height:1,background:'var(--n200)'}}/>
          <span style={{fontSize:12,color:'var(--n400)'}}>or sign in with email</span>
          <div style={{flex:1,height:1,background:'var(--n200)'}}/>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:20}}>
          <div>
            <label className="label">Work email</label>
            <input className="input" defaultValue="a.okeke@ngml.gov.ng" type="email"/>
          </div>
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5}}>
              <label className="label" style={{margin:0}}>Password</label>
              <a href="#" style={{fontSize:12,color:'var(--b600)'}}>Forgot password?</a>
            </div>
            <div style={{position:'relative'}}>
              <input className="input" defaultValue="••••••••••••" type="password" style={{paddingRight:40}}/>
              <button style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'var(--n400)'}}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.3"/></svg>
              </button>
            </div>
          </div>
        </div>

        <button className="btn btn-primary" style={{width:'100%',height:42,marginBottom:16,fontSize:14}} onClick={onLogin}>Sign in</button>

        {showError && (
          <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 12px',display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--sr)" strokeWidth="1.2"/><path d="M7 4.5v3M7 8.5v.5" stroke="var(--srt)" strokeWidth="1.2" strokeLinecap="round"/></svg>
            <span style={{fontSize:12,color:'var(--srt)'}}>Incorrect password. 2 attempts remaining before lockout.</span>
          </div>
        )}

        <div style={{textAlign:'center',fontSize:13,color:'var(--n500)'}}>
          New to AssetCore? <a href="#" onClick={e=>{e.preventDefault();onSwitch()}} style={{color:'var(--b600)',fontWeight:500}}>Register your organisation</a>
        </div>
      </div>
    </div>
  )
}

function RegisterScreen({ onSwitch }) {
  return (
    <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:520}}>
      <div style={{background:'var(--n950)',padding:'18px 28px',display:'flex',alignItems:'center',gap:10}}>
        <Logo/>
        <span style={{fontFamily:'var(--ff-d)',fontSize:16,fontWeight:700,color:'#fff'}}>AssetCore</span>
        <span style={{marginLeft:'auto',fontSize:12,color:'rgba(255,255,255,.4)'}}>Step 1 of 2</span>
      </div>
      <div style={{padding:'28px 28px 24px'}}>
        <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:4}}>Create your organisation</h1>
        <p style={{fontSize:13,color:'var(--n500)',marginBottom:24}}>Sets up a new multi-tenant workspace for your company</p>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:14}}>
          <div style={{gridColumn:'1/-1'}}>
            <label className="label">Organisation name <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" defaultValue="Nigeria Gas Marketing Limited"/>
            <div style={{fontSize:11,color:'var(--n400)',marginTop:4}}>This appears in the app and on all exports</div>
          </div>
          <div>
            <label className="label">Short name / ticker</label>
            <input className="input" defaultValue="NGML" style={{fontFamily:'var(--ff-m)'}}/>
          </div>
          <div>
            <label className="label">Industry <span style={{color:'var(--sr)'}}>*</span></label>
            <div style={{position:'relative'}}>
              <select className="input" style={{appearance:'none',paddingRight:32}}><option>Oil & Gas Distribution</option></select>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div>
            <label className="label">Primary region <span style={{color:'var(--sr)'}}>*</span></label>
            <div style={{position:'relative'}}>
              <select className="input" style={{appearance:'none',paddingRight:32}}><option>Nigeria</option></select>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}}><path d="M3 4.5l3 3 3-3" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div style={{gridColumn:'1/-1',borderTop:'var(--bdr)',paddingTop:14}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--n600)',marginBottom:10}}>Your account details</div>
          </div>
          <div>
            <label className="label">First name <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" defaultValue="Adaeze"/>
          </div>
          <div>
            <label className="label">Last name <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" defaultValue="Okeke"/>
          </div>
          <div style={{gridColumn:'1/-1'}}>
            <label className="label">Work email <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" defaultValue="a.okeke@ngml.gov.ng" type="email"/>
          </div>
          <div>
            <label className="label">Password <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" defaultValue="••••••••••••" type="password"/>
            <div style={{height:3,background:'var(--n200)',borderRadius:2,overflow:'hidden',marginTop:5}}>
              <div style={{width:'80%',height:'100%',background:'var(--sg)',borderRadius:2}}/>
            </div>
            <div style={{fontSize:11,color:'var(--sgt)',marginTop:3}}>Strong</div>
          </div>
          <div>
            <label className="label">Confirm password <span style={{color:'var(--sr)'}}>*</span></label>
            <input className="input" defaultValue="••••••••••••" type="password"/>
          </div>
        </div>

        <div style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:18,padding:'10px 12px',background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:4}}>
          <div style={{width:15,height:15,background:'var(--b500)',borderRadius:3,flexShrink:0,marginTop:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2L7.5 2.5" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span style={{fontSize:12,color:'var(--n700)',lineHeight:1.5}}>I agree to AssetCore's <a href="#" style={{color:'var(--b600)'}}>Terms of Service</a> and <a href="#" style={{color:'var(--b600)'}}>Privacy Policy</a>. I confirm I am authorised to register this organisation.</span>
        </div>

        <button className="btn btn-primary" style={{width:'100%',height:42,marginBottom:10}}>Create organisation →</button>
        <div style={{textAlign:'center',fontSize:12,color:'var(--n400)'}}>Already have an account? <a href="#" onClick={e=>{e.preventDefault();onSwitch()}} style={{color:'var(--b600)'}}>Sign in</a></div>
      </div>
    </div>
  )
}

export default function Auth({ onLogin }) {
  const [screen, setScreen] = useState('login')

  return (
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      {screen === 'login'
        ? <LoginScreen onSwitch={() => setScreen('register')} onLogin={onLogin}/>
        : <RegisterScreen onSwitch={() => setScreen('login')}/>
      }
    </div>
  )
}
