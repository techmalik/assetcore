import { useState, useMemo } from 'react'
import {
  Title, Text, Stack, Group, TextInput, Table, Card, Badge, Menu, ActionIcon,
  Modal, Select, Button, CopyButton, Code,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconSearch, IconDots, IconUserCog, IconBan, IconCheck, IconKey, IconCopy } from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { date } from '../lib/format'
import { useAdminAuth } from '../lib/AdminAuthContext'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const TENANT_ROLES = ['owner', 'ops_manager', 'maint_engineer', 'field_tech', 'hse_officer', 'viewer']

export default function Users() {
  const { can } = useAdminAuth()
  const [q, setQ] = useState('')
  const [roleEdit, setRoleEdit] = useState(null) // membership row
  const [newRole, setNewRole] = useState('')
  const [resetLink, setResetLink] = useState(null)
  const { data, loading, error, reload } = useAsync(() => api.get('/users'), [])

  const rows = data?.users ?? []
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((m) =>
      m.profiles?.email?.toLowerCase().includes(s) ||
      m.profiles?.full_name?.toLowerCase().includes(s) ||
      m.organizations?.name?.toLowerCase().includes(s))
  }, [rows, q])

  const saveRole = async () => {
    try {
      await api.patch(`/users/${roleEdit.id}/role`, { org_id: roleEdit.org_id, role_key: newRole })
      notifications.show({ message: 'Role updated', color: 'teal' })
      setRoleEdit(null)
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  const toggleDisable = async (m) => {
    try {
      await api.post(`/users/${m.id}/${m.status === 'disabled' ? 'enable' : 'disable'}`)
      notifications.show({ message: m.status === 'disabled' ? 'User enabled' : 'User disabled', color: 'teal' })
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  const sendReset = async (m) => {
    try {
      const { action_link } = await api.post(`/users/${m.user_id}/reset-password`, { email: m.profiles?.email })
      setResetLink(action_link || 'Link generated (check email delivery settings).')
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Users</Title>
        <Text c="dimmed" size="sm">Every membership on this client instance.</Text>
      </div>

      <TextInput placeholder="Search by name, email, or org" leftSection={<IconSearch size={16} />}
        value={q} onChange={(e) => setQ(e.currentTarget.value)} maw={420} />

      <Card padding={0}>
        <DataState loading={loading} error={error} onRetry={reload} empty={filtered.length === 0} emptyLabel="No users match.">
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th><Table.Th>Email</Table.Th><Table.Th>Organization</Table.Th>
                  <Table.Th>Role</Table.Th><Table.Th>Status</Table.Th><Table.Th>Joined</Table.Th><Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filtered.map((m) => (
                  <Table.Tr key={m.id}>
                    <Table.Td>{m.profiles?.full_name || '—'}</Table.Td>
                    <Table.Td>{m.profiles?.email || '—'}</Table.Td>
                    <Table.Td>{m.organizations?.name || '—'}</Table.Td>
                    <Table.Td><Badge variant="light" color="gray">{m.role_key}</Badge></Table.Td>
                    <Table.Td><StatusBadge value={m.status} /></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{date(m.created_at)}</Text></Table.Td>
                    <Table.Td>
                      {can('user:write') && (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target><ActionIcon variant="subtle" color="gray"><IconDots size={16} /></ActionIcon></Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconUserCog size={15} />}
                              onClick={() => { setRoleEdit(m); setNewRole(m.role_key) }}>Change role</Menu.Item>
                            <Menu.Item leftSection={<IconKey size={15} />} onClick={() => sendReset(m)}>Send reset link</Menu.Item>
                            <Menu.Item color={m.status === 'disabled' ? 'teal' : 'red'}
                              leftSection={m.status === 'disabled' ? <IconCheck size={15} /> : <IconBan size={15} />}
                              onClick={() => toggleDisable(m)}>
                              {m.status === 'disabled' ? 'Enable' : 'Disable'}
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </DataState>
      </Card>

      <Modal opened={Boolean(roleEdit)} onClose={() => setRoleEdit(null)} title="Change role" centered>
        <Stack gap="md">
          <Text size="sm" c="dimmed">{roleEdit?.profiles?.email} · {roleEdit?.organizations?.name}</Text>
          <Select label="Role" data={TENANT_ROLES} value={newRole} onChange={setNewRole} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRoleEdit(null)}>Cancel</Button>
            <Button onClick={saveRole}>Save</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={Boolean(resetLink)} onClose={() => setResetLink(null)} title="Password reset link" centered>
        <Stack gap="sm">
          <Text size="sm" c="dimmed">Share this one-time recovery link with the user (also emailed if SMTP is configured):</Text>
          <Code block style={{ wordBreak: 'break-all' }}>{resetLink}</Code>
          <Group justify="flex-end">
            <CopyButton value={resetLink || ''}>
              {({ copied, copy }) => (
                <Button leftSection={<IconCopy size={15} />} variant="light" onClick={copy}>
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              )}
            </CopyButton>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
