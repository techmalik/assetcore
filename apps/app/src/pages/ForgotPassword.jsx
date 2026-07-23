import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/apiClient'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text>
  </svg>
)

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      // The API always returns 200 here, whether or not the email is registered.
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:'100%',maxWidth:440}}>
        <div style={{background:'var(--n950)',padding:'24px 32px',display:'flex',alignItems:'center',gap:10}}>
          <Logo/>
          <span style={{fontFamily:'var(--ff-d)',fontSize:18,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
        </div>
        <div style={{padding:'36px 32px'}}>
          {sent ? (
            <>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:10}}>Check your email</h1>
              <p style={{fontSize:13,color:'var(--n500)',lineHeight:1.7,marginBottom:24}}>
                If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. The link expires in 1 hour.
              </p>
              <Link to="/auth" className="btn btn-primary" style={{width:'100%',height:44,fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none'}}>
                Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:6}}>Reset your password</h1>
              <p style={{fontSize:13,color:'var(--n500)',marginBottom:24}}>Enter your work email and we'll send you a reset link.</p>

              <div style={{marginBottom:20}}>
                <label className="label">Work email</label>
                <input className="input" value={email} onChange={(e)=>setEmail(e.target.value)} type="email" autoComplete="email" required autoFocus/>
              </div>

              {error && (
                <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 12px',fontSize:12,color:'var(--srt)',marginBottom:16}}>{error}</div>
              )}

              <button type="submit" disabled={busy} className="btn btn-primary" style={{width:'100%',height:44,marginBottom:16,fontSize:14,opacity:busy?.7:1}}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>

              <div style={{textAlign:'center',fontSize:13,color:'var(--n500)'}}>
                <Link to="/auth" style={{color:'var(--b600)',fontWeight:500}}>Back to sign in</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
