import { Routes, Route, Navigate } from 'react-router-dom'
import { Center, Loader, Stack, Title, Text, Button, Paper } from '@mantine/core'
import { isConfigured } from './lib/apiClient'
import { api } from './lib/api'
import { useAsync } from './lib/useAsync'
import { AdminAuthProvider, useAdminAuth } from './lib/AdminAuthContext'
import AdminShell from './components/AdminShell.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Organizations from './pages/Organizations.jsx'
import OrgDetail from './pages/OrgDetail.jsx'
import Users from './pages/Users.jsx'
import Billing from './pages/Billing.jsx'
import Support from './pages/Support.jsx'
import PlatformAudit from './pages/PlatformAudit.jsx'
import Settings from './pages/Settings.jsx'

function FullCenter({ children }) {
  return <Center mih="100vh" bg="var(--mantine-color-gray-0)">{children}</Center>
}

function NotConfigured() {
  return (
    <FullCenter>
      <Paper withBorder p="xl" maw={440} radius="md">
        <Title order={3} mb="xs">Backend unreachable</Title>
        <Text c="dimmed" size="sm">
          Couldn't reach the AssetCore API. Make sure it's running
          (<code>npm run dev:api</code>) and reload.
        </Text>
      </Paper>
    </FullCenter>
  )
}

function NotAuthorized() {
  const { adminName, signOut } = useAdminAuth()
  return (
    <FullCenter>
      <Paper withBorder p="xl" maw={440} radius="md">
        <Stack gap="sm">
          <Title order={3}>Not authorized</Title>
          <Text c="dimmed" size="sm">
            <b>{adminName}</b> is signed in but is not a platform administrator.
            Ask a Super Admin to grant access.
          </Text>
          <Button variant="light" onClick={signOut}>Sign out</Button>
        </Stack>
      </Paper>
    </FullCenter>
  )
}

// This console is deployed inside a single client instance, so there is
// exactly one live org in production. `/orgs` skips straight to its detail
// page; the list only surfaces as a fallback in dev seeds with 0 or 2+ orgs.
function ClientHome() {
  const { data, loading, error } = useAsync(() => api.get('/orgs'), [])
  if (loading) return <Center mih="60vh"><Loader /></Center>
  const live = (data?.orgs ?? []).filter((o) => !o.deleted_at)
  if (!error && live.length === 1) return <Navigate to={`/orgs/${live[0].id}`} replace />
  return <Organizations />
}

function Routed() {
  const { loading, adminLoaded, session, isAdmin } = useAdminAuth()

  if (loading) return <FullCenter><Loader /></FullCenter>

  // Unauthenticated → login only.
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // Authenticated but admin status still resolving.
  if (!adminLoaded) return <FullCenter><Loader /></FullCenter>
  if (!isAdmin) return <NotAuthorized />

  // Authenticated platform admin → full console.
  return (
    <AdminShell>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/orgs" element={<ClientHome />} />
        <Route path="/orgs/:id" element={<OrgDetail />} />
        <Route path="/users" element={<Users />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/support" element={<Support />} />
        <Route path="/audit" element={<PlatformAudit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AdminShell>
  )
}

export default function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <AdminAuthProvider>
      <Routed />
    </AdminAuthProvider>
  )
}
