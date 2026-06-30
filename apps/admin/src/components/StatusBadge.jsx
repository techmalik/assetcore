import { Badge } from '@mantine/core'

// Color is paired with the text label (never color alone).
const COLORS = {
  // org billing_status
  trial: 'gray', invoice: 'blue', active: 'teal', paid: 'teal',
  suspended: 'red', overdue: 'orange', past_due: 'orange',
  // invoice status
  draft: 'gray', sent: 'blue', void: 'dark',
  // plans
  growth: 'indigo', enterprise: 'grape', starter: 'cyan',
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
