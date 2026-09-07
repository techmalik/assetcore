import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { useAuth } from '../lib/AuthContext'
import { errorText } from '../lib/errors'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text>
  </svg>
)

export default function ResetPassword() {
  const [params] = useSearchParams()
  const { authed, user, signOut } = useAuth()
  const nav = useNavigate()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!token) return setError('This reset link is invalid. Request a new one.')
    if (password !== confirm) return setError('Passwords do not match.')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      // The link is normally opened by the admin who generated it, still
      // signed in as themselves. The password just set belongs to somebody
      // else, so end that session before sending them to the sign-in form —
      // otherwise /auth bounces straight back to the admin's own dashboard.
      if (authed) await signOut()
      setDone(true)
      setTimeout(() => nav('/auth', { replace: true }), 2000)
    } catch (err) {
      setError(errorText(err, 'This reset link is invalid or has expired.'))
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
          {done ? (
            <>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:10}}>Password changed</h1>
              <p style={{fontSize:13,color:'var(--n500)',lineHeight:1.7}}>Taking you to sign in…</p>
            </>
          ) : (
            <form onSubmit={submit}>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:6}}>Set a new password</h1>
              <p style={{fontSize:13,color:'var(--n500)',marginBottom:authed?12:24}}>Choose a new password for your account.</p>

              {authed && (
                <p style={{background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:4,padding:'9px 12px',fontSize:12,color:'var(--b700)',lineHeight:1.55,marginBottom:24}}>
                  You are signed in as <strong>{user?.email}</strong>. Setting a password here changes the
                  account this link was issued for, not yours, and will sign you out.
                </p>
              )}

              <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:20}}>
                <div>
                  <label className="label">New password</label>
                  <input className="input" value={password} onChange={(e)=>setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Min 8 characters" required autoFocus/>
                </div>
                <div>
                  <label className="label">Confirm new password</label>
                  <input className="input" value={confirm} onChange={(e)=>setConfirm(e.target.value)} type="password" autoComplete="new-password" required/>
                </div>
              </div>

              {error && (
                <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 12px',fontSize:12,color:'var(--srt)',marginBottom:16}}>{error}</div>
              )}

              <button type="submit" disabled={busy} className="btn btn-primary" style={{width:'100%',height:44,marginBottom:16,fontSize:14,opacity:busy?.7:1}}>
                {busy ? 'Saving…' : 'Set new password'}
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
