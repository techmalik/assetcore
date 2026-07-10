import { Badge } from '@mantine/core'

// Color is paired with the text label (never color alone).
const COLORS = {
  // org status — every org is provisioned 'licensed' with no plan tiers;
  // the only state worth badging here is suspended
  active: 'teal', suspended: 'red',
  // invoice status (billing_invoices.status)
  draft: 'gray', sent: 'blue', paid: 'teal', overdue: 'orange', void: 'dark',
  // membership / admin status
  disabled: 'red',
  // generic
  unknown: 'gray',
}

export default function StatusBadge({ value, label }) {
  const key = String(value ?? 'unknown').toLowerCase()
  return (
    <Badge variant="light" color={COLORS[key] || 'gray'} radius="sm">
      {label ?? String(value ?? '—').replace(/_/g, ' ')}
    </Badge>
  )
}
