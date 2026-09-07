import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { isConfigured } from './lib/apiClient'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { NotificationsProvider } from './lib/NotificationsContext'
import { SidebarProvider } from './lib/SidebarContext'
import { ToastProvider } from './lib/ToastContext'
import { LocationFilterProvider } from './lib/LocationFilterContext'
import { can, ADMIN_ENTRY_CAPS } from './lib/rbac'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import LicenceBanner from './components/LicenceBanner.jsx'
import NotConfigured from './pages/NotConfigured.jsx'
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
import SpareParts from './pages/SpareParts.jsx'
import Depreciation from './pages/Depreciation.jsx'
import Scan from './pages/Scan.jsx'
import Inspections from './pages/Inspections.jsx'
import Devices from './pages/Devices.jsx'
import Integrations from './pages/Integrations.jsx'
import Notifications from './pages/Notifications.jsx'
import Reports from './pages/Reports.jsx'
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

function Routed() {
  const { loading, authed, orgId, needsOnboarding, mustChangePassword, roleKey, extraCaps } = useAuth()
  const [dark, setDark] = useState(false)

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : '')
  }

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
  const props = { dark, toggleDark }

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
      <Route path="/dashboard" element={gate(<Dashboard {...props} />)} />
      <Route path="/assets" element={gate(<Assets {...props} />)} />
      <Route path="/work-orders" element={gate(<WorkOrders {...props} />)} />
      <Route path="/maintenance" element={gate(<Maintenance {...props} />)} />
      <Route path="/scan" element={gate(<Scan {...props} />)} />
      <Route path="/calendar" element={gate(<Calendar {...props} />)} />
      <Route path="/spare-parts" element={gate(can(roleKey, 'parts:read', extraCaps) ? <SpareParts {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/defects" element={gate(can(roleKey, 'defect:read', extraCaps) ? <Defects {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/risks" element={gate(can(roleKey, 'risk:read', extraCaps) ? <Risks {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/approvals" element={gate(can(roleKey, 'approval:read', extraCaps) ? <Approvals {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/depreciation" element={gate(can(roleKey, 'depreciation:read', extraCaps) ? <Depreciation {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/analytics" element={gate(can(roleKey, 'report:read', extraCaps) ? <Analytics {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/compliance" element={gate(<Compliance {...props} />)} />
      <Route path="/inspections" element={gate(<Inspections {...props} />)} />
      <Route path="/devices" element={gate(<Devices {...props} />)} />
      <Route path="/integrations" element={gate(<Integrations {...props} />)} />
      <Route path="/notifications" element={gate(<Notifications {...props} />)} />
      <Route path="/settings" element={gate(<Settings {...props} />)} />
      <Route path="/reports" element={gate(can(roleKey, 'report:read', extraCaps) ? <Reports {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="/admin" element={gate(ADMIN_ENTRY_CAPS.some((c) => can(roleKey, c, extraCaps)) ? <Admin {...props} /> : <Navigate to="/dashboard" replace />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <ErrorBoundary>
      <AuthProvider>
        <NotificationsProvider>
          <SidebarProvider>
            <ToastProvider>
              <LocationFilterProvider>
                <Routed />
                <OfflineBanner />
                <LicenceBanner />
              </LocationFilterProvider>
            </ToastProvider>
          </SidebarProvider>
        </NotificationsProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
