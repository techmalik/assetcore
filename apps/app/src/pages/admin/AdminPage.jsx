import { lazy, Suspense, useState, useEffect } from 'react'
import Sidebar from '../../components/Sidebar.jsx'
import Topbar from '../../components/Topbar.jsx'
import { useAuth, useCan } from '../../lib/AuthContext.jsx'

// Each tab is loaded when it is first opened: most visits use one of the
// seven, and a viewer who can open only the audit log never downloads the
// user management screens.
const SitesTab = lazy(() => import('./SitesTab.jsx'))
const LocationsTab = lazy(() => import('./LocationsTab.jsx'))
const CategoriesTab = lazy(() => import('./CategoriesTab.jsx'))
const UsersTab = lazy(() => import('./UsersTab.jsx'))
const AuditTab = lazy(() => import('./AuditTab.jsx'))
const ConfigTab = lazy(() => import('./ConfigTab.jsx'))
const EscalationsTab = lazy(() => import('./EscalationsTab.jsx'))

// ── Main Admin page ───────────────────────────────────────────────────────────

const TABS = [
  { k: 'locations', label: 'Locations', cap: 'org:manage' },
  { k: 'sites', label: 'Sites', cap: 'org:manage' },
  { k: 'categories', label: 'Asset Categories', cap: 'org:manage' },
  { k: 'users', label: 'Users & Roles', cap: 'user:manage' },
  { k: 'config', label: 'Configuration', cap: 'org:manage' },
  { k: 'escalations', label: 'Escalations', cap: 'escalation:read' },
  { k: 'audit', label: 'Audit Log', cap: 'audit:read' },
]

export default function Admin({ dark, toggleDark }) {
  const can = useCan()
  const { roleKey } = useAuth()
  const visibleTabs = TABS.filter((t) => can(t.cap))
  const [tab, setTab] = useState(visibleTabs[0]?.k)

  useEffect(() => {
    if (!visibleTabs.some((t) => t.k === tab)) setTab(visibleTabs[0]?.k)
  }, [roleKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-shell">
      <Sidebar active="admin"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Admin" dark={dark} toggleDark={toggleDark}/>
        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{marginBottom:12}}>
              <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Admin</h1>
              <p style={{fontSize:12,color:'var(--n500)'}}>Manage your organisation settings, team, and audit trail</p>
            </div>
            <div className="tab-strip" style={{gap:0}}>
              {visibleTabs.map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <Suspense fallback={<div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>}>
            {tab === 'locations' && <LocationsTab />}
            {tab === 'sites' && <SitesTab />}
            {tab === 'categories' && <CategoriesTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'config' && <ConfigTab />}
            {tab === 'escalations' && <EscalationsTab />}
            {tab === 'audit' && <AuditTab />}
            {!tab && <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>You don't have access to any Admin section.</div>}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
