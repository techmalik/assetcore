import { SimpleGrid, Title, Text, Group, Card, Stack, Badge } from '@mantine/core'
import {
  IconBuildingSkyscraper, IconUsers, IconBox, IconClipboardList, IconCash, IconClockDollar,
} from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { money } from '../lib/format'
import DataState from '../components/DataState.jsx'
import StatCard from '../components/StatCard.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

export default function Dashboard() {
  const { data, loading, error, reload } = useAsync(() => api.get('/metrics'), [])

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Platform overview</Title>
        <Text c="dimmed" size="sm">Live totals across every tenant.</Text>
      </div>

      <DataState loading={loading} error={error} onRetry={reload}>
        {data && (
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
              <StatCard
                label="Organizations" value={data.orgs.total} icon={IconBuildingSkyscraper}
                sub={`${data.orgs.new30d} new in 30d · ${data.orgs.suspended} suspended`}
              />
              <StatCard label="Active memberships" value={data.users} icon={IconUsers} color="cyan" />
              <StatCard label="Assets" value={data.assets} icon={IconBox} color="teal" />
              <StatCard
                label="Work orders" value={data.workOrders.total} icon={IconClipboardList} color="grape"
                sub={`${data.workOrders.open} open`}
              />
              <StatCard
                label="Collected" value={money(data.billing.collectedCents)} icon={IconCash} color="green"
              />
              <StatCard
                label="Outstanding" value={money(data.billing.outstandingCents)} icon={IconClockDollar} color="orange"
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              <Card padding="lg">
                <Text fz="sm" fw={600} mb="sm">Organizations by plan</Text>
                <Group gap="xs">
                  {Object.entries(data.orgs.byPlan).map(([k, v]) => (
                    <Badge key={k} variant="light" size="lg" color="indigo">{k}: {v}</Badge>
                  ))}
                  {Object.keys(data.orgs.byPlan).length === 0 && <Text c="dimmed" size="sm">No data</Text>}
                </Group>
              </Card>
              <Card padding="lg">
                <Text fz="sm" fw={600} mb="sm">Organizations by billing status</Text>
                <Group gap="xs">
                  {Object.entries(data.orgs.byBilling).map(([k, v]) => (
                    <Group key={k} gap={6}><StatusBadge value={k} /><Text size="sm">{v}</Text></Group>
                  ))}
                  {Object.keys(data.orgs.byBilling).length === 0 && <Text c="dimmed" size="sm">No data</Text>}
                </Group>
              </Card>
            </SimpleGrid>
          </Stack>
        )}
      </DataState>
    </Stack>
  )
}
