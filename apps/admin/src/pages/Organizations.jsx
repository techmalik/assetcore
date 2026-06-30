import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Title, Text, Stack, Group, Button, TextInput, Table, Card, Modal, Select, ActionIcon,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconSearch, IconChevronRight } from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { date } from '../lib/format'
import { useAdminAuth } from '../lib/AdminAuthContext'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const PLANS = ['trial', 'starter', 'growth', 'enterprise']
const BILLING = ['trial', 'invoice', 'active', 'overdue', 'suspended']

export default function Organizations() {
  const navigate = useNavigate()
  const { can } = useAdminAuth()
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const { data, loading, error, reload } = useAsync(() => api.get('/orgs'), [])

  const orgs = data?.orgs ?? []
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return orgs
    return orgs.filter((o) =>
      o.name?.toLowerCase().includes(s) || o.short_name?.toLowerCase().includes(s) || o.region?.toLowerCase().includes(s))
  }, [orgs, q])

  const form = useForm({
    initialValues: { name: '', short_name: '', industry: '', region: '', plan: 'trial' },
    validate: { name: (v) => (v ? null : 'Required') },
  })

  const create = async (values) => {
    try {
      const { org } = await api.post('/orgs', values)
      notifications.show({ message: `Created ${org.name}`, color: 'teal' })
      setCreateOpen(false)
      form.reset()
      navigate(`/orgs/${org.id}`)
    } catch (e) {
      notifications.show({ message: e.message, color: 'red' })
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Organizations</Title>
          <Text c="dimmed" size="sm">Every tenant on the platform.</Text>
        </div>
        {can('org:write') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            New organization
          </Button>
        )}
      </Group>

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

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="New organization" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack gap="sm">
            <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
            <Group grow>
              <TextInput label="Short name" {...form.getInputProps('short_name')} />
              <TextInput label="Region" {...form.getInputProps('region')} />
            </Group>
            <TextInput label="Industry" {...form.getInputProps('industry')} />
            <Select label="Plan" data={PLANS} {...form.getInputProps('plan')} />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}

export { PLANS, BILLING }
