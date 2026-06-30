import { useState } from 'react'
import {
  Title, Text, Stack, Group, Button, Card, Table, Menu, ActionIcon, Modal,
  TextInput, Select, Alert,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconDots, IconInfoCircle } from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { date } from '../lib/format'
import { useAdminAuth } from '../lib/AdminAuthContext'
import { ROLE_LABELS } from '../lib/rbac'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const ROLES = ['superadmin', 'admin', 'support', 'billing']

export default function Settings() {
  const { can, user } = useAdminAuth()
  const canWrite = can('admin:write')
  const [addOpen, setAddOpen] = useState(false)
  const { data, loading, error, reload } = useAsync(() => api.get('/admins'), [])
  const rows = data?.admins ?? []

  const form = useForm({
    initialValues: { email: '', role: 'support', full_name: '' },
    validate: { email: (v) => (/^\S+@\S+$/.test(v) ? null : 'Valid email required') },
  })

  const add = async (v) => {
    try {
      await api.post('/admins', v)
      notifications.show({ message: 'Platform admin added', color: 'teal' })
      setAddOpen(false); form.reset(); reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  const update = async (userId, patch) => {
    try {
      await api.patch(`/admins/${userId}`, patch)
      notifications.show({ message: 'Updated', color: 'teal' })
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Platform admins</Title>
          <Text c="dimmed" size="sm">AssetCore staff with backoffice access.</Text>
        </div>
        {canWrite && <Button leftSection={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>Add admin</Button>}
      </Group>

      {!canWrite && (
        <Alert color="gray" icon={<IconInfoCircle size={16} />}>
          Only Super Admins can add or modify platform admins.
        </Alert>
      )}

      <Card padding={0}>
        <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No platform admins.">
          <Table.ScrollContainer minWidth={680}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th><Table.Th>Email</Table.Th><Table.Th>Role</Table.Th>
                  <Table.Th>Status</Table.Th><Table.Th>Added</Table.Th><Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((a) => {
                  const isSelf = a.user_id === user?.id
                  return (
                    <Table.Tr key={a.user_id}>
                      <Table.Td>{a.full_name || '—'} {isSelf && <Text span size="xs" c="dimmed">(you)</Text>}</Table.Td>
                      <Table.Td>{a.profiles?.email || '—'}</Table.Td>
                      <Table.Td><StatusBadge value={a.role} label={ROLE_LABELS[a.role] || a.role} /></Table.Td>
                      <Table.Td><StatusBadge value={a.status} /></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed">{date(a.created_at)}</Text></Table.Td>
                      <Table.Td>
                        {canWrite && !isSelf && (
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target><ActionIcon variant="subtle" color="gray"><IconDots size={16} /></ActionIcon></Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Label>Set role</Menu.Label>
                              {ROLES.map((r) => (
                                <Menu.Item key={r} disabled={r === a.role} onClick={() => update(a.user_id, { role: r })}>
                                  {ROLE_LABELS[r]}
                                </Menu.Item>
                              ))}
                              <Menu.Divider />
                              <Menu.Item color={a.status === 'disabled' ? 'teal' : 'red'}
                                onClick={() => update(a.user_id, { status: a.status === 'disabled' ? 'active' : 'disabled' })}>
                                {a.status === 'disabled' ? 'Re-enable' : 'Disable'}
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </DataState>
      </Card>

      <Modal opened={addOpen} onClose={() => setAddOpen(false)} title="Add platform admin" centered>
        <form onSubmit={form.onSubmit(add)}>
          <Stack gap="sm">
            <Alert color="blue" icon={<IconInfoCircle size={16} />} p="xs">
              The person must already have an AssetCore account (any sign-up). Enter their email to grant backoffice access.
            </Alert>
            <TextInput label="Email" withAsterisk placeholder="name@assetcore.io" {...form.getInputProps('email')} />
            <TextInput label="Full name" {...form.getInputProps('full_name')} />
            <Select label="Role" data={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} {...form.getInputProps('role')} />
            <Group justify="flex-end" mt="xs">
              <Button variant="default" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit">Add</Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  )
}
