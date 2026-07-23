import { useState } from 'react'
import {
  Title, Text, Stack, Group, Button, Card, Select, Textarea, NumberInput,
  Alert, Table, Badge, SimpleGrid, Box,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconLifebuoy, IconEye, IconLockOpen2, IconAlertTriangle } from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { dateTime, date } from '../lib/format'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

export default function Support() {
  const orgsQ = useAsync(() => api.get('/orgs'), [])
  const orgOptions = (orgsQ.data?.orgs ?? []).map((o) => ({ value: o.id, label: o.name }))

  const [orgId, setOrgId] = useState('')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [starting, setStarting] = useState(false)
  const [grant, setGrant] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [snapLoading, setSnapLoading] = useState(false)
  const [snapError, setSnapError] = useState(null)

  const loadSnapshot = async (id) => {
    setSnapLoading(true); setSnapError(null)
    try { setSnapshot(await api.get(`/support/org/${id}`)) }
    catch (e) { setSnapError(e) }
    finally { setSnapLoading(false) }
  }

  const start = async () => {
    if (!orgId || !reason.trim()) {
      notifications.show({ message: 'Pick an org and a reason', color: 'red' }); return
    }
    setStarting(true)
    try {
      const { grant } = await api.post('/support/impersonate', { org_id: orgId, reason, minutes })
      setGrant(grant)
      await loadSnapshot(orgId)
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
    finally { setStarting(false) }
  }

  const end = async () => {
    try { await api.post(`/support/revoke/${grant.id}`) } catch { /* ignore */ }
    setGrant(null); setSnapshot(null); setReason('')
    notifications.show({ message: 'Support session ended', color: 'gray' })
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Support</Title>
        <Text c="dimmed" size="sm">Time-boxed, audited, read-only access to a client instance’s data.</Text>
      </div>

      {!grant && (
        <Card padding="lg" maw={560}>
          <Group gap="xs" mb="md"><IconLifebuoy size={18} /><Text fw={600}>Start a support session</Text></Group>
          <Stack gap="sm">
            <Select label="Organization" placeholder="Select client" data={orgOptions} searchable
              value={orgId || null} onChange={(v) => setOrgId(v || '')} />
            <Textarea label="Reason" placeholder="Ticket #, what you’re investigating…" autosize minRows={2}
              value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
            <NumberInput label="Duration (minutes)" min={5} max={240} value={minutes} onChange={setMinutes} maw={200} />
            <Group justify="flex-end">
              <Button leftSection={<IconEye size={16} />} loading={starting} onClick={start}>Start read-only session</Button>
            </Group>
          </Stack>
        </Card>
      )}

      {grant && (
        <>
          <Alert color="orange" icon={<IconAlertTriangle size={18} />}
            title="Read-only support session active">
            <Group justify="space-between">
              <Text size="sm">
                Viewing <b>{snapshot?.org?.name || 'client instance'}</b> · expires {dateTime(grant.expires_at)} · this access is logged.
              </Text>
              <Button size="xs" color="red" variant="white" leftSection={<IconLockOpen2 size={14} />} onClick={end}>
                End session
              </Button>
            </Group>
          </Alert>

          <DataState loading={snapLoading} error={snapError} onRetry={() => loadSnapshot(orgId)}>
            {snapshot && (
              <Stack gap="lg">
                <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
                  <Card padding="lg">
                    <Text fw={600} fz="sm" mb="sm">Assets ({snapshot.assets?.length || 0})</Text>
                    <Box style={{ maxHeight: 320, overflow: 'auto' }}>
                      <Table>
                        <Table.Thead><Table.Tr><Table.Th>AIN</Table.Th><Table.Th>Name</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
                        <Table.Tbody>
                          {(snapshot.assets || []).map((a) => (
                            <Table.Tr key={a.id}>
                              <Table.Td><Text size="xs" ff="monospace">{a.ain}</Text></Table.Td>
                              <Table.Td><Text size="sm">{a.name}</Text></Table.Td>
                              <Table.Td><StatusBadge value={a.status} /></Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Box>
                  </Card>
                  <Card padding="lg">
                    <Text fw={600} fz="sm" mb="sm">Work orders ({snapshot.workOrders?.length || 0})</Text>
                    <Box style={{ maxHeight: 320, overflow: 'auto' }}>
                      <Table>
                        <Table.Thead><Table.Tr><Table.Th>Ref</Table.Th><Table.Th>Title</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
                        <Table.Tbody>
                          {(snapshot.workOrders || []).map((w) => (
                            <Table.Tr key={w.id}>
                              <Table.Td><Text size="xs" ff="monospace">{w.ref}</Text></Table.Td>
                              <Table.Td><Text size="sm">{w.title}</Text></Table.Td>
                              <Table.Td><Badge variant="light" color="grape">{w.status}</Badge></Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Box>
                  </Card>
                </SimpleGrid>
                <Card padding="lg">
                  <Text fw={600} fz="sm" mb="sm">Compliance licences ({snapshot.licences?.length || 0})</Text>
                  <Table.ScrollContainer minWidth={400}>
                    <Table>
                      <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Number</Table.Th><Table.Th>Expires</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>
                        {(snapshot.licences || []).map((l) => (
                          <Table.Tr key={l.id}>
                            <Table.Td><Text size="sm">{l.name}</Text></Table.Td>
                            <Table.Td><Text size="xs" ff="monospace">{l.licence_number}</Text></Table.Td>
                            <Table.Td><Text size="sm" c="dimmed">{date(l.expiry_date)}</Text></Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Card>
              </Stack>
            )}
          </DataState>
        </>
      )}
    </Stack>
  )
}
