import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/apiClient'
import { useAuth } from '../lib/AuthContext'

const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
    <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b300)" strokeWidth="1.6" fill="none"/>
    <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b300)">A</text>
  </svg>
)

export default function ForcePasswordChange() {
  const { refreshSession } = useAuth()
  const nav = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (next !== confirm) return setError('Passwords do not match.')
    if (next.length < 8) return setError('Password must be at least 8 characters.')
    setBusy(true)
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next })
      await refreshSession()
      nav('/', { replace: true })
    } catch (err) {
      setError(err?.message || 'Could not change your password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--n100)',display:'flex',alignItems:'center',justifyContent:'center',padding:40}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,overflow:'hidden',boxShadow:'var(--sh-lg)',width:440}}>
        <div style={{background:'var(--n950)',padding:'24px 32px',display:'flex',alignItems:'center',gap:10}}>
          <Logo/>
          <span style={{fontFamily:'var(--ff-d)',fontSize:18,fontWeight:700,color:'#fff',letterSpacing:'-.3px'}}>AssetCore</span>
        </div>
        <div style={{padding:'36px 32px'}}>
          <form onSubmit={submit}>
            <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)',marginBottom:6}}>Set your password</h1>
            <p style={{fontSize:13,color:'var(--n500)',marginBottom:24}}>
              For security, you need to set a new password before continuing.
            </p>

            <div style={{display:'flex',flexDirection:'column',gap:14,marginBottom:20}}>
              <div>
                <label className="label">Temporary password</label>
                <input className="input" value={current} onChange={(e)=>setCurrent(e.target.value)} type="password" autoComplete="current-password" required autoFocus/>
              </div>
              <div>
                <label className="label">New password</label>
                <input className="input" value={next} onChange={(e)=>setNext(e.target.value)} type="password" autoComplete="new-password" placeholder="Min 8 characters" required/>
              </div>
              <div>
                <label className="label">Confirm new password</label>
                <input className="input" value={confirm} onChange={(e)=>setConfirm(e.target.value)} type="password" autoComplete="new-password" required/>
              </div>
            </div>

            {error && (
              <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 12px',fontSize:12,color:'var(--srt)',marginBottom:16}}>{error}</div>
            )}

            <button type="submit" disabled={busy} className="btn btn-primary" style={{width:'100%',height:44,fontSize:14,opacity:busy?.7:1}}>
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
