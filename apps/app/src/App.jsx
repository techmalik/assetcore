import { Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { isConfigured } from './lib/apiClient'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { NotificationsProvider } from './lib/NotificationsContext'
import { SidebarProvider } from './lib/SidebarContext'
import { ToastProvider } from './lib/ToastContext'
import { can, ADMIN_ENTRY_CAPS } from './lib/rbac'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import LicenceBanner from './components/LicenceBanner.jsx'
import NotConfigured from './pages/NotConfigured.jsx'
import Auth from './pages/Auth.jsx'
import ForgotPassword from './pages/ForgotPassword.jsx'
import ResetPassword from './pages/ResetPassword.jsx'
import Onboarding from './pages/Onboarding.jsx'
import ForcePasswordChange from './pages/ForcePasswordChange.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Assets from './pages/Assets.jsx'
import WorkOrders from './pages/WorkOrders.jsx'
import Maintenance from './pages/Maintenance.jsx'
import Compliance from './pages/Compliance.jsx'
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

function Routed() {
  const { loading, authed, needsOnboarding, mustChangePassword, roleKey } = useAuth()
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
    if (needsOnboarding) return <Navigate to="/onboarding" replace />
    return el
  }
  const props = { dark, toggleDark }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={authed ? postAuthPath() : '/auth'} replace />} />
      <Route path="/auth" element={authed ? <Navigate to={postAuthPath()} replace /> : <Auth />} />
      <Route path="/forgot-password" element={authed ? <Navigate to={postAuthPath()} replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={authed ? <Navigate to={postAuthPath()} replace /> : <ResetPassword />} />
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
      <Route path="/compliance" element={gate(<Compliance {...props} />)} />
      <Route path="/inspections" element={gate(<Inspections {...props} />)} />
      <Route path="/devices" element={gate(<Devices {...props} />)} />
      <Route path="/integrations" element={gate(<Integrations {...props} />)} />
      <Route path="/notifications" element={gate(<Notifications {...props} />)} />
      <Route path="/settings" element={gate(<Settings {...props} />)} />
      <Route path="/reports" element={gate(<Reports {...props} />)} />
      <Route path="/admin" element={gate(ADMIN_ENTRY_CAPS.some((c) => can(roleKey, c)) ? <Admin {...props} /> : <Navigate to="/dashboard" replace />)} />
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
              <Routed />
              <OfflineBanner />
              <LicenceBanner />
            </ToastProvider>
          </SidebarProvider>
        </NotificationsProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
