import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Title, Text, Stack, Group, Button, Tabs, Card, Table, Badge, SimpleGrid,
  Modal, TextInput, Select, Textarea, ActionIcon, Anchor, Box, Divider,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import {
  IconArrowLeft, IconEdit, IconBan, IconRestore, IconPlus,
} from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { date, dateTime, money } from '../lib/format'
import { useAdminAuth } from '../lib/AdminAuthContext'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import StatCard from '../components/StatCard.jsx'
import { PLANS, BILLING } from './Organizations.jsx'

function CountTiles({ counts }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      <StatCard label="Sites" value={counts.sites} />
      <StatCard label="Assets" value={counts.assets} />
      <StatCard label="Work orders" value={counts.workOrders} />
      <StatCard label="Users" value={counts.users} />
    </SimpleGrid>
  )
}

function UsersTab({ orgId }) {
  const { data, loading, error, reload } = useAsync(() => api.get(`/orgs/${orgId}/users`), [orgId])
  const rows = data?.users ?? []
  return (
    <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No members.">
      <Table>
        <Table.Thead>
          <Table.Tr><Table.Th>Name</Table.Th><Table.Th>Email</Table.Th><Table.Th>Role</Table.Th><Table.Th>Status</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((m) => (
            <Table.Tr key={m.id}>
              <Table.Td>{m.profiles?.full_name || '—'}</Table.Td>
              <Table.Td>{m.profiles?.email || '—'}</Table.Td>
              <Table.Td><Badge variant="light" color="gray">{m.role_key}</Badge></Table.Td>
              <Table.Td><StatusBadge value={m.status} /></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </DataState>
  )
}

function UsageTab({ orgId }) {
  const { data, loading, error, reload } = useAsync(() => api.get(`/orgs/${orgId}/usage`), [orgId])
  const tally = (obj) => Object.entries(obj || {})
  return (
    <DataState loading={loading} error={error} onRetry={reload}>
      {data && (
        <Stack gap="lg">
          <CountTiles counts={data.counts} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
            <Card padding="lg">
              <Text fw={600} fz="sm" mb="sm">Assets by status</Text>
              <Group gap="xs">
                {tally(data.assetsByStatus).map(([k, v]) => <Badge key={k} variant="light">{k}: {v}</Badge>)}
                {tally(data.assetsByStatus).length === 0 && <Text c="dimmed" size="sm">None</Text>}
              </Group>
            </Card>
            <Card padding="lg">
              <Text fw={600} fz="sm" mb="sm">Work orders by status</Text>
              <Group gap="xs">
                {tally(data.workOrdersByStatus).map(([k, v]) => <Badge key={k} variant="light" color="grape">{k}: {v}</Badge>)}
                {tally(data.workOrdersByStatus).length === 0 && <Text c="dimmed" size="sm">None</Text>}
              </Group>
            </Card>
          </SimpleGrid>
        </Stack>
      )}
    </DataState>
  )
}

function AuditTab({ orgId }) {
  const { data, loading, error, reload } = useAsync(() => api.get(`/orgs/${orgId}/audit`), [orgId])
  const rows = data?.entries ?? []
  return (
    <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No tenant audit activity.">
      <Table>
        <Table.Thead>
          <Table.Tr><Table.Th>When</Table.Th><Table.Th>Action</Table.Th><Table.Th>Entity</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td><Text size="sm" c="dimmed">{dateTime(e.created_at)}</Text></Table.Td>
              <Table.Td><Badge variant="light" color="gray">{e.action}</Badge></Table.Td>
              <Table.Td><Text size="sm">{e.entity_type}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </DataState>
  )
}

function BillingTab({ orgId }) {
  const { data, loading, error, reload } = useAsync(() => api.get(`/billing/invoices?org_id=${orgId}`), [orgId])
  const rows = data?.invoices ?? []
  return (
    <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No invoices for this org.">
      <Table>
        <Table.Thead>
          <Table.Tr><Table.Th>Number</Table.Th><Table.Th>Amount</Table.Th><Table.Th>Status</Table.Th><Table.Th>Due</Table.Th></Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((i) => (
            <Table.Tr key={i.id}>
              <Table.Td><Text fw={600} size="sm">{i.number}</Text>{i.po_number && <Text size="xs" c="dimmed">PO {i.po_number}</Text>}</Table.Td>
              <Table.Td>{money(i.amount_cents, i.currency)}</Table.Td>
              <Table.Td><StatusBadge value={i.status} /></Table.Td>
              <Table.Td><Text size="sm" c="dimmed">{date(i.due_at)}</Text></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </DataState>
  )
}

function NotesTab({ orgId }) {
  const { can } = useAdminAuth()
  const [body, setBody] = useState('')
  const { data, loading, error, reload } = useAsync(() => api.get(`/orgs/${orgId}/notes`), [orgId])
  const rows = data?.notes ?? []

  const add = async () => {
    if (!body.trim()) return
    try {
      await api.post(`/orgs/${orgId}/notes`, { body })
      setBody('')
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  return (
    <Stack gap="md">
      {can('org:write') && (
        <Card padding="md">
          <Textarea placeholder="Add an internal support note…" autosize minRows={2}
            value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <Group justify="flex-end" mt="sm"><Button size="xs" onClick={add} disabled={!body.trim()}>Add note</Button></Group>
        </Card>
      )}
      <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No notes yet.">
        <Stack gap="sm">
          {rows.map((n) => (
            <Card key={n.id} padding="md">
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={600}>{n.profiles?.full_name || n.profiles?.email || 'Unknown'}</Text>
                <Text size="xs" c="dimmed">{dateTime(n.created_at)}</Text>
              </Group>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</Text>
            </Card>
          ))}
        </Stack>
      </DataState>
    </Stack>
  )
}

export default function OrgDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAdminAuth()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)
  const { data, loading, error, reload } = useAsync(() => api.get(`/orgs/${id}`), [id])
  const org = data?.org
  const suspended = Boolean(org?.deleted_at)

  const form = useForm({ initialValues: { name: '', short_name: '', industry: '', region: '', plan: 'trial', billing_status: 'trial' } })

  const openEdit = () => {
    form.setValues({
      name: org.name || '', short_name: org.short_name || '', industry: org.industry || '',
      region: org.region || '', plan: org.plan || 'trial', billing_status: org.billing_status || 'trial',
    })
    setEditOpen(true)
  }

  const saveEdit = async (values) => {
    try {
      await api.patch(`/orgs/${id}`, values)
      notifications.show({ message: 'Organization updated', color: 'teal' })
      setEditOpen(false)
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  const toggleSuspend = async () => {
    try {
      await api.post(`/orgs/${id}/${suspended ? 'restore' : 'suspend'}`)
      notifications.show({ message: suspended ? 'Organization restored' : 'Organization suspended', color: suspended ? 'teal' : 'orange' })
      setConfirmSuspend(false)
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  return (
    <Stack gap="lg">
      <Anchor onClick={() => navigate('/orgs')} size="sm">
        <Group gap={4}><IconArrowLeft size={14} /> All organizations</Group>
      </Anchor>

      <DataState loading={loading} error={error} onRetry={reload}>
        {org && (
          <>
            <Group justify="space-between" align="flex-start">
              <div>
                <Group gap="sm">
                  <Title order={2}>{org.name}</Title>
                  {suspended && <Badge color="red" variant="filled">Suspended</Badge>}
                </Group>
                <Group gap="xs" mt={6}>
                  <StatusBadge value={org.plan} />
                  <StatusBadge value={org.billing_status} />
                  <Text size="sm" c="dimmed">{org.region || '—'} · {org.industry || '—'}</Text>
                </Group>
              </div>
              <Group gap="xs">
                {can('org:write') && <Button variant="default" leftSection={<IconEdit size={16} />} onClick={openEdit}>Edit</Button>}
                {can('org:suspend') && (
                  <Button color={suspended ? 'teal' : 'red'} variant="light"
                    leftSection={suspended ? <IconRestore size={16} /> : <IconBan size={16} />}
                    onClick={() => setConfirmSuspend(true)}>
                    {suspended ? 'Restore' : 'Suspend'}
                  </Button>
                )}
              </Group>
            </Group>

            <Tabs defaultValue="overview" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="overview">Overview</Tabs.Tab>
                <Tabs.Tab value="users">Users</Tabs.Tab>
                <Tabs.Tab value="usage">Usage</Tabs.Tab>
                <Tabs.Tab value="billing">Billing</Tabs.Tab>
                <Tabs.Tab value="audit">Audit</Tabs.Tab>
                <Tabs.Tab value="notes">Notes</Tabs.Tab>
              </Tabs.List>

              <Box pt="lg">
                <Tabs.Panel value="overview">
                  <Stack gap="lg">
                    <CountTiles counts={data.counts} />
                    <Card padding="lg">
                      <Text fw={600} mb="sm">Details</Text>
                      <Divider mb="sm" />
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                        <Text size="sm"><b>Created:</b> {date(org.created_at)}</Text>
                        <Text size="sm"><b>Plan:</b> {org.plan}</Text>
                        <Text size="sm"><b>Billing:</b> {org.billing_status}</Text>
                        <Text size="sm"><b>Short name:</b> {org.short_name || '—'}</Text>
                        <Text size="sm"><b>Region:</b> {org.region || '—'}</Text>
                        <Text size="sm"><b>Industry:</b> {org.industry || '—'}</Text>
                      </SimpleGrid>
                    </Card>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="users"><UsersTab orgId={id} /></Tabs.Panel>
                <Tabs.Panel value="usage"><UsageTab orgId={id} /></Tabs.Panel>
                <Tabs.Panel value="billing"><BillingTab orgId={id} /></Tabs.Panel>
                <Tabs.Panel value="audit"><AuditTab orgId={id} /></Tabs.Panel>
                <Tabs.Panel value="notes"><NotesTab orgId={id} /></Tabs.Panel>
              </Box>
            </Tabs>
          </>
        )}
      </DataState>

      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Edit organization" centered>
        <form onSubmit={form.onSubmit(saveEdit)}>
          <Stack gap="sm">
            <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
            <Group grow>
              <TextInput label="Short name" {...form.getInputProps('short_name')} />
              <TextInput label="Region" {...form.getInputProps('region')} />
            </Group>
            <TextInput label="Industry" {...form.getInputProps('industry')} />
            <Group grow>
              <Select label="Plan" data={PLANS} {...form.getInputProps('plan')} />
              <Select label="Billing status" data={BILLING} {...form.getInputProps('billing_status')} />
            </Group>
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={confirmSuspend} onClose={() => setConfirmSuspend(false)}
        title={suspended ? 'Restore organization?' : 'Suspend organization?'} centered>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {suspended
              ? 'Members will regain access on their next sign-in / token refresh.'
              : 'Members lose access on their next token refresh. Data is retained and can be restored.'}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmSuspend(false)}>Cancel</Button>
            <Button color={suspended ? 'teal' : 'red'} onClick={toggleSuspend}>
              {suspended ? 'Restore' : 'Suspend'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
