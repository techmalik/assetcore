import { useState } from 'react'
import { Link } from 'react-router-dom'
import { signIn } from '../lib/auth'
import { INSTANCE_CLIENT, SUPPORT_EMAIL } from '../lib/instance'

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

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      <form onSubmit={submit} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:'100%',maxWidth:480}}>
        <div style={{background:'var(--n950)',padding:'24px 32px',display:'flex',alignItems:'center',gap:10}}>
          <Logo/>
          <span style={{fontFamily:'var(--ff-d)',fontSize:18,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
        </div>
        <div style={{padding:'36px 32px'}}>
          <h1 style={{fontFamily:'var(--ff-d)',fontSize:24,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:6}}>Sign in</h1>
          <p style={{fontSize:13,color:'var(--n500)',marginBottom:28}}>
            {INSTANCE_CLIENT ? `Asset management for ${INSTANCE_CLIENT}` : 'Asset management for oil & gas operations'}
          </p>

          <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:20}}>
            <div>
              <label className="label">Work email</label>
              <input className="input" value={email} onChange={(e)=>setEmail(e.target.value)} type="email" autoComplete="email" required autoFocus/>
            </div>
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5}}>
                <label className="label" style={{margin:0}}>Password</label>
                <Link to="/forgot-password" style={{fontSize:12,color:'var(--b600)'}}>Forgot password?</Link>
              </div>
              <div style={{position:'relative'}}>
                <input className="input" value={password} onChange={(e)=>setPassword(e.target.value)} type={showPw?'text':'password'} autoComplete="current-password" required style={{paddingRight:40}}/>
                <button type="button" onClick={()=>setShowPw(s=>!s)} style={{position:'absolute',right:2,top:'50%',transform:'translateY(-50%)',width:44,height:44,display:'flex',alignItems:'center',justifyContent:'center',background:'none',border:'none',cursor:'pointer',color:'var(--n400)'}}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.3"/></svg>
                </button>
              </div>
            </div>
          </div>

          {error && <ErrorBanner msg={error}/>}

          <button type="submit" disabled={busy} className="btn btn-primary" style={{width:'100%',height:44,marginBottom:16,fontSize:14,opacity:busy?.7:1}}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div style={{textAlign:'center',fontSize:12,color:'var(--n400)'}}>
            {INSTANCE_CLIENT ? `Licensed to ${INSTANCE_CLIENT} · ` : ''}Supported by AssetCore
            {SUPPORT_EMAIL && <> · <a href={`mailto:${SUPPORT_EMAIL}`} style={{color:'var(--b600)'}}>{SUPPORT_EMAIL}</a></>}
          </div>
        </div>
      </form>
    </div>
  )
}
