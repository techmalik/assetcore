import { buildWhere as buildAuditWhere, filters as auditFilters } from '../../routes/audit.js'
import { col, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const auditLog: Dataset = {
  key: 'audit_log',
  label: 'Audit log',
  description: 'Who did what, to which record, and when — including the before and after values.',
  cap: 'audit:read',
  filters: ['date', 'q', 'actor', 'action', 'entity_type'],
  dateLabel: 'Occurred',
  parse: (query) => {
    // Blank values are dropped first: the schema rejects '' and one bad key
    // would otherwise throw away every filter, exporting the whole log.
    const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => typeof v === 'string' && v !== ''))
    const parsed = auditFilters.safeParse(clean)
    return parsed.success ? (Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v)) as Record<string, string>) : {}
  },
  build: async ({ c, raw }) => {
    const { sql: where, params } = buildAuditWhere(raw)
    const data = await rows(c, `
      select al.created_at, u.full_name as actor_name, u.email as actor_email, al.action, al.entity_type,
        al.entity_label, al.entity_id, al.ip, al.before, al.after
      from public.audit_log al
      left join public.users u on u.id = al.actor_id
      ${where}
      order by al.created_at desc, al.id desc
      ${LIMIT_SQL}`, params)
    return {
      columns: [
        col('Time', 'created_at', 'datetime', 19), col('Actor', 'actor_name', 'text', 22), col('Actor Email', 'actor_email', 'text', 28),
        col('Action', 'action', 'text', 24), col('Entity Type', 'entity_type', 'text', 16), col('Entity', 'entity_label', 'text', 32),
        col('Entity ID', 'entity_id', 'text', 38), col('IP', 'ip', 'text', 16),
        col('Before', 'before', 'text', 40), col('After', 'after', 'text', 40),
      ],
      rows: data,
    }
  },
}
