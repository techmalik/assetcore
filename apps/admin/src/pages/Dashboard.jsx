import { SimpleGrid, Title, Text, Group, Card, Stack, Badge } from '@mantine/core'
import {
  IconUsers, IconBox, IconClipboardList, IconHistory,
} from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { date } from '../lib/format'
import DataState from '../components/DataState.jsx'
import StatCard from '../components/StatCard.jsx'

function licenceDaysRemaining(expiresAt) {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.ceil(ms / 86400000)
}

function LicenceCard({ licence }) {
  if (!licence) {
    return (
      <Card padding="lg">
        <Text fz="sm" fw={600} mb="sm">Licence status</Text>
        <Text c="dimmed" size="sm">No licence provisioned yet.</Text>
      </Card>
    )
  }
  const daysLeft = licenceDaysRemaining(licence.expires_at)
  const expired = daysLeft !== null && daysLeft < 0
  const expiring = daysLeft !== null && daysLeft >= 0 && daysLeft <= 60

  return (
    <Card padding="lg">
      <Group justify="space-between" mb="sm">
        <Text fz="sm" fw={600}>Licence status</Text>
        {expired && <Badge color="red">Expired</Badge>}
        {!expired && expiring && <Badge color="orange">Expiring soon</Badge>}
        {!expired && !expiring && <Badge color="teal">Active</Badge>}
      </Group>
      <Stack gap={4}>
        <Text size="sm"><b>Licensed to:</b> {licence.licensed_to}</Text>
        <Text size="sm"><b>Contract ref:</b> {licence.contract_ref || '—'}</Text>
        <Text size="sm"><b>Expires:</b> {date(licence.expires_at)}{daysLeft !== null && ` (${expired ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`})`}</Text>
        <Text size="sm"><b>Maintenance until:</b> {date(licence.maintenance_expires_at)}</Text>
        <Text size="sm"><b>Seats:</b> {licence.seats ?? '—'}</Text>
      </Stack>
    </Card>
  )
}

function VersionCard({ version }) {
  return (
    <Card padding="lg">
      <Text fz="sm" fw={600} mb="sm">App &amp; DB version</Text>
      <Stack gap={4}>
        <Text size="sm"><b>App version:</b> {version?.version || '—'}</Text>
        <Text size="sm"><b>Latest migration:</b> {version?.latestMigration || '—'}</Text>
      </Stack>
    </Card>
  )
}

export default function Dashboard() {
  const metricsQ = useAsync(() => api.get('/metrics'), [])
  const licenceQ = useAsync(() => api.get('/licence'), [])
  const versionQ = useAsync(() => api.get('/version'), [])
  const { data, loading, error, reload } = metricsQ

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Instance overview</Title>
        <Text c="dimmed" size="sm">Live health of this client instance.</Text>
      </div>

      <DataState loading={loading} error={error} onRetry={reload}>
        {data && (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
            <StatCard label="Active users" value={data.users} icon={IconUsers} color="cyan" />
            <StatCard label="Assets" value={data.assets} icon={IconBox} color="teal" />
            <StatCard label="Open work orders" value={data.workOrders.open} icon={IconClipboardList} color="grape" />
            <StatCard label="Audit events (24h)" value={data.auditEvents24h} icon={IconHistory} color="orange" />
          </SimpleGrid>
        )}
      </DataState>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <DataState loading={licenceQ.loading} error={licenceQ.error} onRetry={licenceQ.reload}>
          <LicenceCard licence={licenceQ.data?.licence} />
        </DataState>
        <DataState loading={versionQ.loading} error={versionQ.error} onRetry={versionQ.reload}>
          <VersionCard version={versionQ.data} />
        </DataState>
      </SimpleGrid>
    </Stack>
  )
}
