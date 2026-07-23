import { useState, useMemo, useEffect } from 'react'
import {
  Title, Text, Stack, Group, Button, Table, Card, Menu, ActionIcon, Modal,
  Select, TextInput, NumberInput, Textarea, SimpleGrid,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { IconPlus, IconDots } from '@tabler/icons-react'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { money, date, dollarsToCents } from '../lib/format'
import { useAdminAuth } from '../lib/AdminAuthContext'
import DataState from '../components/DataState.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

const NEXT_STATUS = {
  draft: ['sent', 'void'],
  sent: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'void'],
  paid: [],
  void: [],
}

function LicenceEditor() {
  const { can } = useAdminAuth()
  const canWrite = can('billing:write')
  const { data, loading, error, reload } = useAsync(() => api.get('/licence'), [])
  const [initialized, setInitialized] = useState(false)

  const form = useForm({
    initialValues: {
      licensed_to: '', contract_ref: '', issued_at: '', expires_at: '', maintenance_expires_at: '',
      annual_fee: 0, currency: 'NGN', seats: 0, notes: '',
    },
    validate: { licensed_to: (v) => (v ? null : 'Required') },
  })

  useEffect(() => {
    if (data?.licence && !initialized) {
      const l = data.licence
      form.setValues({
        licensed_to: l.licensed_to || '',
        contract_ref: l.contract_ref || '',
        issued_at: l.issued_at ? String(l.issued_at).slice(0, 10) : '',
        expires_at: l.expires_at ? String(l.expires_at).slice(0, 10) : '',
        maintenance_expires_at: l.maintenance_expires_at ? String(l.maintenance_expires_at).slice(0, 10) : '',
        annual_fee: l.annual_fee_cents ? Number(l.annual_fee_cents) / 100 : 0,
        currency: l.currency || 'NGN',
        seats: l.seats ?? 0,
        notes: l.notes || '',
      })
      setInitialized(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, initialized])

  const save = async (v) => {
    try {
      await api.patch('/licence', {
        licensed_to: v.licensed_to,
        contract_ref: v.contract_ref || null,
        issued_at: v.issued_at || null,
        expires_at: v.expires_at || null,
        maintenance_expires_at: v.maintenance_expires_at || null,
        annual_fee_cents: dollarsToCents(v.annual_fee),
        currency: v.currency,
        seats: v.seats,
        notes: v.notes || null,
      })
      notifications.show({ message: 'Licence updated', color: 'teal' })
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  return (
    <Card padding="lg">
      <Text fw={600} mb="md">Licence</Text>
      <DataState
        loading={loading} error={error} onRetry={reload}
        empty={!loading && !error && !data?.licence}
        emptyLabel="No licence provisioned yet — run scripts/provision.mjs against this instance."
      >
        <form onSubmit={form.onSubmit(save)}>
          <Stack gap="sm">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Licensed to" withAsterisk disabled={!canWrite} {...form.getInputProps('licensed_to')} />
              <TextInput label="Contract ref" disabled={!canWrite} {...form.getInputProps('contract_ref')} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label="Issued" type="date" disabled={!canWrite} {...form.getInputProps('issued_at')} />
              <TextInput label="Expires" type="date" disabled={!canWrite} {...form.getInputProps('expires_at')} />
              <TextInput label="Maintenance until" type="date" disabled={!canWrite} {...form.getInputProps('maintenance_expires_at')} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput label="Annual fee" min={0} decimalScale={2} thousandSeparator="," disabled={!canWrite} {...form.getInputProps('annual_fee')} />
              <Select label="Currency" data={['NGN', 'USD']} disabled={!canWrite} {...form.getInputProps('currency')} />
              <NumberInput label="Seats" min={0} disabled={!canWrite} {...form.getInputProps('seats')} />
            </SimpleGrid>
            <Textarea label="Notes" autosize minRows={2} disabled={!canWrite} {...form.getInputProps('notes')} />
            {canWrite && (
              <Group justify="flex-end">
                <Button type="submit">Save licence</Button>
              </Group>
            )}
          </Stack>
        </form>
      </DataState>
    </Card>
  )
}

export default function Billing() {
  const { can } = useAdminAuth()
  const [orgFilter, setOrgFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const orgsQ = useAsync(() => api.get('/orgs'), [])
  const orgOptions = (orgsQ.data?.orgs ?? []).map((o) => ({ value: o.id, label: o.name }))

  const { data, loading, error, reload } = useAsync(
    () => api.get(`/billing/invoices${orgFilter ? `?org_id=${orgFilter}` : ''}`),
    [orgFilter],
  )
  const rows = data?.invoices ?? []

  const form = useForm({
    initialValues: { org_id: '', number: '', amount: 0, currency: 'NGN', po_number: '', due_at: '', notes: '', status: 'draft' },
    validate: {
      org_id: (v) => (v ? null : 'Required'),
      number: (v) => (v ? null : 'Required'),
    },
  })

  const create = async (v) => {
    try {
      await api.post('/billing/invoices', {
        org_id: v.org_id, number: v.number, amount_cents: dollarsToCents(v.amount), currency: v.currency,
        po_number: v.po_number || null, due_at: v.due_at ? new Date(v.due_at).toISOString() : null,
        notes: v.notes || null, status: v.status,
      })
      notifications.show({ message: `Invoice ${v.number} created`, color: 'teal' })
      setCreateOpen(false); form.reset(); reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  const setStatus = async (inv, status) => {
    try {
      await api.patch(`/billing/invoices/${inv.id}`, { status })
      notifications.show({ message: `Marked ${status}`, color: 'teal' })
      reload()
    } catch (e) { notifications.show({ message: e.message, color: 'red' }) }
  }

  const totals = useMemo(() => {
    const t = { outstanding: 0, collected: 0 }
    for (const i of rows) {
      if (i.status === 'paid') t.collected += i.amount_cents
      else if (i.status === 'sent' || i.status === 'overdue') t.outstanding += i.amount_cents
    }
    return t
  }, [rows])

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Licence &amp; Invoices</Title>
        <Text c="dimmed" size="sm">Annual licence &amp; maintenance fee records. No payment processing.</Text>
      </div>

      <LicenceEditor />

      <Group justify="space-between" align="flex-end">
        <Title order={3} fz="lg">Invoices</Title>
        {can('billing:write') && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>New invoice</Button>
        )}
      </Group>

      <Group>
        <Select placeholder="All organizations" data={orgOptions} value={orgFilter || null}
          onChange={(v) => setOrgFilter(v || '')} clearable searchable maw={320} />
        <Text size="sm" c="dimmed">
          Outstanding <b>{money(totals.outstanding)}</b> · Collected <b>{money(totals.collected)}</b>
        </Text>
      </Group>

      <Card padding={0}>
        <DataState loading={loading} error={error} onRetry={reload} empty={rows.length === 0} emptyLabel="No invoices.">
          <Table.ScrollContainer minWidth={760}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Number</Table.Th><Table.Th>Organization</Table.Th><Table.Th>Amount</Table.Th>
                  <Table.Th>Status</Table.Th><Table.Th>Due</Table.Th><Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((i) => (
                  <Table.Tr key={i.id}>
                    <Table.Td>
                      <Text fw={600} size="sm">{i.number}</Text>
                      {i.po_number && <Text size="xs" c="dimmed">PO {i.po_number}</Text>}
                    </Table.Td>
                    <Table.Td>{i.organizations?.name || '—'}</Table.Td>
                    <Table.Td>{money(i.amount_cents, i.currency)}</Table.Td>
                    <Table.Td><StatusBadge value={i.status} /></Table.Td>
                    <Table.Td><Text size="sm" c="dimmed">{date(i.due_at)}</Text></Table.Td>
                    <Table.Td>
                      {can('billing:write') && (NEXT_STATUS[i.status] || []).length > 0 && (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target><ActionIcon variant="subtle" color="gray"><IconDots size={16} /></ActionIcon></Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Mark as</Menu.Label>
                            {NEXT_STATUS[i.status].map((s) => (
                              <Menu.Item key={s} onClick={() => setStatus(i, s)} tt="capitalize">{s}</Menu.Item>
                            ))}
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

      <Modal opened={createOpen} onClose={() => setCreateOpen(false)} title="New invoice" centered>
        <form onSubmit={form.onSubmit(create)}>
          <Stack gap="sm">
            <Select label="Organization" withAsterisk data={orgOptions} searchable {...form.getInputProps('org_id')} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Invoice number" withAsterisk placeholder="INV-2026-0001" {...form.getInputProps('number')} />
              <TextInput label="PO number" {...form.getInputProps('po_number')} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <NumberInput label="Amount" min={0} decimalScale={2} thousandSeparator="," {...form.getInputProps('amount')} />
              <Select label="Currency" data={['NGN', 'USD']} {...form.getInputProps('currency')} />
              <TextInput label="Due date" type="date" {...form.getInputProps('due_at')} />
            </SimpleGrid>
            <Select label="Status" data={['draft', 'sent']} {...form.getInputProps('status')} />
            <Textarea label="Notes" autosize minRows={2} {...form.getInputProps('notes')} />
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
