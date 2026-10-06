import StatusBadge from '../../components/StatusBadge.jsx'
import { WO_PRIORITY_LABEL, WO_TYPE_LABEL, WO_PRIORITY_STYLE } from '../../lib/db/workOrders'

export const STATUS_COL_ORDER = ['draft', 'new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed']

export function PriorityBadge({ p }) {
  const s = WO_PRIORITY_STYLE[p] || WO_PRIORITY_STYLE.low
  return <StatusBadge tone={s} label={WO_PRIORITY_LABEL[p]} weight={600} uppercase style={{ padding: '1px 6px' }} />
}

export function TypeBadge({ t }) {
  return <span style={{ padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 500, background: 'var(--n100)', color: 'var(--n600)', border: '1px solid var(--n200)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{WO_TYPE_LABEL[t] || t}</span>
}

export function SlaDue({ date }) {
  if (!date) return null
  const d = new Date(date)
  const diffH = (d - Date.now()) / 36e5
  const overdue = diffH < 0
  const urgent = diffH >= 0 && diffH < 24
  const label = overdue ? `Overdue ${Math.abs(Math.ceil(diffH / 24))}d` : diffH < 24 ? `Due in ${Math.ceil(diffH)}h` : `Due ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  return <span style={{ fontSize: 11, color: overdue ? 'var(--srt)' : urgent ? 'var(--sat)' : 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{label}</span>
}
