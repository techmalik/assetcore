import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Title, Text, Stack, Group, TextInput, Table, Card, ActionIcon,
} from '@mantine/core'
import { IconSearch, IconChevronRight } from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { date } from '../lib/format'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const PLANS = ['trial', 'starter', 'growth', 'enterprise']
const BILLING = ['trial', 'invoice', 'active', 'overdue', 'suspended']

// Dev fallback only: production deployments have exactly one client instance,
// so /orgs redirects straight to its detail page (see App.jsx ClientHome).
// This list only renders when a dev seed has 0 or 2+ orgs.
export default function Organizations() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { data, loading, error, reload } = useAsync(() => api.get('/orgs'), [])

  const orgs = data?.orgs ?? []
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return orgs
    return orgs.filter((o) =>
      o.name?.toLowerCase().includes(s) || o.short_name?.toLowerCase().includes(s) || o.region?.toLowerCase().includes(s))
  }, [orgs, q])

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Client instances</Title>
        <Text c="dimmed" size="sm">Every org visible to this console (dev fallback — expect exactly one in production).</Text>
      </div>

      <TextInput
        placeholder="Search by name, short name, or region"
        leftSection={<IconSearch size={16} />}
        value={q} onChange={(e) => setQ(e.currentTarget.value)} maw={420}
      />

      <Card padding={0}>
        <DataState
          loading={loading} error={error} onRetry={reload}
          empty={filtered.length === 0} emptyLabel="No organizations match."
        >
          <Table.ScrollContainer minWidth={720}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Region</Table.Th>
                  <Table.Th>Plan</Table.Th>
                  <Table.Th>Billing</Table.Th>
                  <Table.Th>Created</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((o) => (
                  <Table.Tr
                    key={o.id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/orgs/${o.id}`)}
                  >
                    <Table.Td>
                      <Text fw={600} size="sm">{o.name}</Text>
                      <Text size="xs" c="dimmed">{o.short_name || '—'}</Text>
                    </Table.Td>
                    <Table.Td>{o.region || '—'}</Table.Td>
                    <Table.Td><StatusBadge value={o.plan} /></Table.Td>
                    <Table.Td>
                      <StatusBadge value={o.deleted_at ? 'suspended' : o.billing_status} />
                    </Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{date(o.created_at)}</Text></Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="gray"><IconChevronRight size={16} /></ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </DataState>
      </Card>
    </Stack>
  )
}

export { PLANS, BILLING }
