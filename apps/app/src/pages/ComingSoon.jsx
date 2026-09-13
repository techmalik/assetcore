import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

/**
 * Stands in for a module that is announced but not open. The sidebar entry is
 * already inert; this covers a bookmark or a typed URL, so the old page is
 * never reachable half-finished.
 */
export default function ComingSoon({ dark, toggleDark, active, title, description }) {
  const nav = useNavigate()
  return (
    <div className="app-shell">
      <Sidebar active={active} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb={title} dark={dark} toggleDark={toggleDark} />
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, margin: '0 auto 16px', background: 'var(--b50)', color: 'var(--b600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M8 1.8l5.2 2.9v5.8L8 13.4 2.8 10.5V4.7L8 1.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M2.8 4.7L8 7.6l5.2-2.9M8 7.6v5.8" stroke="currentColor" strokeWidth="1.1"/></svg>
            </div>
            <span className="nav-soon" style={{ display: 'inline-block', marginBottom: 10 }}>Coming soon</span>
            <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 24, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.3px' }}>{title}</h1>
            <p style={{ fontSize: 13, color: 'var(--n500)', marginTop: 8, lineHeight: 1.6 }}>{description}</p>
            <button className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13, marginTop: 20 }} onClick={() => nav('/dashboard')}>
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
