import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth, useCan } from './lib/AuthContext'
import { NotificationsProvider } from './lib/NotificationsContext'
import { SidebarProvider } from './lib/SidebarContext'
import { ToastProvider } from './lib/ToastContext'
import { ConfirmProvider } from './lib/ConfirmContext'
import { LocationFilterProvider } from './lib/LocationFilterContext'
import { ThemeProvider } from './lib/ThemeContext'
import { ROUTES, canOpen } from './routes'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import LicenceBanner from './components/LicenceBanner.jsx'
import Auth from './pages/Auth.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import Onboarding from './pages/Onboarding.jsx'
import NoOrganisation from './pages/NoOrganisation.jsx'
import ForcePasswordChange from './pages/ForcePasswordChange.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Assets from './pages/Assets.jsx'
import WorkOrders from './pages/WorkOrders.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Compliance from './pages/Compliance.jsx'
import Defects from './pages/Defects.jsx'
import Risks from './pages/Risks.jsx'
import Approvals from './pages/Approvals.jsx'
import Analytics from './pages/Analytics.jsx'
import Calendar from './pages/Calendar.jsx'
import ComingSoon from './pages/ComingSoon.jsx'
import Integrity from './pages/Integrity.jsx'
import Depreciation from './pages/Depreciation.jsx'
import Scan from './pages/Scan.jsx'
import AssetMapPage from './pages/AssetMapPage.jsx'
import Inspections from './pages/Inspections.jsx'
import Devices from './pages/Devices.jsx'
import Integrations from './pages/Integrations.jsx'
import Notifications from './pages/Notifications.jsx'
import Export from './pages/Export.jsx'
import Settings from './pages/Settings.jsx'
import Admin from './pages/Admin.jsx'

function Splash() {
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--n100)'}}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{animation:'pulse 1.2s ease-in-out infinite'}}>
        <path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b500)" strokeWidth="1.8" fill="none"/>
        <text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b600)">A</text>
      </svg>
    </div>
  )
}

/**
 * A set-password link works on its own token, not on whoever happens to be
 * signed in — and the person holding it is usually the admin who just
 * generated it. Redirecting an authenticated visitor to the dashboard made
 * the link look broken and gave no hint that signing out first was the trick.
 * With a token present the form is shown to anyone; without one there is
 * nothing to do here, so a signed-in visitor still goes to the app.
 */
function ResetPasswordRoute({ authed, to }) {
  const [params] = useSearchParams()
  if (!params.get('token') && authed) return <Navigate to={to} replace />
  return <ResetPassword />
}

// What each route in routes.js renders.
const PAGES = {
  dashboard: <Dashboard />,
  assets: <Assets />,
  'work-orders': <WorkOrders />,
  maintenance: <Maintenance />,
  scan: <Scan />,
  'asset-map': <AssetMapPage />,
  calendar: <Calendar />,
  'spare-parts': <ComingSoon active="spare-parts" title="Warehouse Inventory"
    description="Stock levels, bin locations and issues to work orders across your warehouses. This module is being prepared and will open here." />,
  integrity: <Integrity />,
  defects: <Defects />,
  risks: <Risks />,
  approvals: <Approvals />,
  depreciation: <Depreciation />,
  analytics: <Analytics />,
  compliance: <Compliance />,
  inspections: <Inspections />,
  devices: <Devices />,
  integrations: <Integrations />,
  notifications: <Notifications />,
  settings: <Settings />,
  export: <Export />,
  admin: <Admin />,
}

function Routed() {
  const can = useCan()
  const { loading, authed, orgId, needsOnboarding, mustChangePassword } = useAuth()
  if (loading) return <Splash />

  // Where an authenticated user lands: forced password change first, then
  // onboarding, then the app.
  const postAuthPath = () => {
    if (mustChangePassword) return '/force-password-change'
    if (needsOnboarding) return '/onboarding'
    return '/dashboard'
  }

  const gate = (el) => {
    if (!authed) return <Navigate to="/auth" replace />
    if (mustChangePassword) return <Navigate to="/force-password-change" replace />
    // No organisation means no scope: every page below is org-scoped and the
    // API answers all of them with no_org_context. Say so once, here, instead
    // of letting each page render its chrome and then fail on its own.
    // Members are invited, never self-signed-up, so this can only be an
    // account whose membership row is missing.
    if (!orgId) return <NoOrganisation />
    if (needsOnboarding) return <Navigate to="/onboarding" replace />
    return el
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={authed ? postAuthPath() : '/auth'} replace />} />
      <Route path="/auth" element={authed ? <Navigate to={postAuthPath()} replace /> : <Auth />} />
      <Route path="/forgot-password" element={authed ? <Navigate to={postAuthPath()} replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPasswordRoute authed={authed} to={postAuthPath()} />} />
      <Route path="/force-password-change" element={
        !authed ? <Navigate to="/auth" replace />
        : mustChangePassword ? <ForcePasswordChange />
        : <Navigate to={postAuthPath()} replace />
      } />
      <Route path="/onboarding" element={
        !authed ? <Navigate to="/auth" replace />
        : mustChangePassword ? <Navigate to="/force-password-change" replace />
        : <Onboarding />
      } />
      {ROUTES.map((r) => (
        <Route key={r.key} path={r.path} element={gate(canOpen(r, can) ? PAGES[r.key] : <Navigate to="/dashboard" replace />)} />
      ))}
      {/* Reports became Export; old bookmarks still land somewhere real. */}
      <Route path="/reports" element={<Navigate to="/export" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* Outermost, so every provider below can report a failure as a toast. */}
      <ToastProvider>
        <ConfirmProvider>
        <ThemeProvider>
        <AuthProvider>
          <NotificationsProvider>
            <SidebarProvider>
              <LocationFilterProvider>
                <Routed />
                <OfflineBanner />
                <LicenceBanner />
              </LocationFilterProvider>
            </SidebarProvider>
          </NotificationsProvider>
        </AuthProvider>
        </ThemeProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}
