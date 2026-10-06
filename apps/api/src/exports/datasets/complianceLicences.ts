import { Where } from '../../http/query.js'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const complianceLicences: Dataset = {
  key: 'compliance_licences',
  label: 'Compliance register',
  description: 'Licences, permits and certificates with authority, site, expiry and standing.',
  cap: 'compliance:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Expiry date',
  // The same buckets as GET /compliance-licences/counts: under 30 days is
  // expiring, under 90 is due soon.
  statuses: ['active', 'due_soon', 'expiring', 'expired'],
  build: async ({ c, f }) => {
    const w = new Where()
    applyFilters(w, f, { site: 'x.site_id', location: 'x.location_id', date: 'x.expiry_date', status: 'x.standing' })
    const data = await rows(c, `
      select x.* from (
        select cl.name, cl.kind, cl.licence_number, au.code as authority_code, au.name as authority,
          loc.name as location, s.name as site, a.ain as asset_ain, cl.issued_date, cl.expiry_date,
          (cl.expiry_date - current_date) as days_to_expiry,
          case
            when cl.expiry_date is null then null
            when cl.expiry_date < current_date then 'expired'
            when cl.expiry_date < current_date + 30 then 'expiring'
            when cl.expiry_date < current_date + 90 then 'due_soon'
            else 'active'
          end as standing,
          cl.notes, cl.created_at, cl.site_id, s.location_id
        from public.compliance_licences cl
        left join public.regulatory_authorities au on au.id = cl.authority_id
        left join public.sites s on s.id = cl.site_id
        left join public.locations loc on loc.id = s.location_id
        left join public.assets a on a.id = cl.asset_id
        where cl.deleted_at is null
      ) x
      ${w.sql}
      order by x.expiry_date asc nulls last
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Name', 'name', 'text', 32), col('Kind', 'kind', 'text', 14), col('Licence Number', 'licence_number', 'text', 18),
        col('Authority Code', 'authority_code', 'text', 14), col('Authority', 'authority', 'text', 28),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18), col('Asset AIN', 'asset_ain', 'text', 16),
        col('Issued', 'issued_date', 'date', 13), col('Expires', 'expiry_date', 'date', 13),
        col('Days To Expiry', 'days_to_expiry', 'number', 14), col('Standing', 'standing', 'text', 12),
        col('Notes', 'notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
