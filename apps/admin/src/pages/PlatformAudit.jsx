import { useState } from 'react'
import { Title, Text, Stack, Card, Table, Badge, Modal, Code, Group } from '@mantine/core'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { dateTime } from '../lib/format'
import DataState from '../components/DataState.jsx'

export default function PlatformAudit() {
  const [detail, setDetail] = useState(null)
  const { data, loading, error, reload } = useAsync(() => api.get('/audit'), [])
  const rows = data?.entries ?? []

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Platform audit</Title>
        <Text c="dimmed" size="sm">Every privileged admin action, append-only.</Text>
      </div>

      <Card padding={0}>
        <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No admin activity yet.">
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th><Table.Th>Actor</Table.Th><Table.Th>Action</Table.Th>
                  <Table.Th>Target</Table.Th><Table.Th>Organization</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((e) => (
                  <Table.Tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(e)}>
                    <Table.Td><Text size="sm" c="dimmed">{dateTime(e.created_at)}</Text></Table.Td>
                    <Table.Td><Text size="sm">{e.profiles?.full_name || e.profiles?.email || '—'}</Text></Table.Td>
                    <Table.Td><Badge variant="light" color="indigo">{e.action}</Badge></Table.Td>
                    <Table.Td><Text size="sm">{e.target_type}</Text></Table.Td>
                    <Table.Td><Text size="sm">{e.organizations?.name || '—'}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </DataState>
      </Card>

      <Modal opened={Boolean(detail)} onClose={() => setDetail(null)} title="Audit entry" size="lg" centered>
        {detail && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge variant="light" color="indigo">{detail.action}</Badge>
              <Text size="sm" c="dimmed">{dateTime(detail.created_at)}</Text>
            </Group>
            <Text size="sm"><b>Actor:</b> {detail.profiles?.email || detail.actor_id}</Text>
            {detail.before && (<><Text size="xs" fw={600} c="dimmed">BEFORE</Text><Code block>{JSON.stringify(detail.before, null, 2)}</Code></>)}
            {detail.after && (<><Text size="xs" fw={600} c="dimmed">AFTER</Text><Code block>{JSON.stringify(detail.after, null, 2)}</Code></>)}
          </Stack>
        )}
      </Modal>
    </Stack>
  )
}
