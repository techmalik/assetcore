import { Where } from '../../http/query.js'
import { hasCap } from '../../middleware/rbac.js'
import { ASSET_STATUSES } from '@assetcore/domain'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const assets: Dataset = {
  key: 'assets',
  label: 'Asset register',
  description: 'Every asset with its identity, location, status, condition, dates and value.',
  cap: 'asset:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Purchase date',
  statuses: ASSET_STATUSES,
  build: async ({ c, req, f }) => {
    // Book value is depreciation data; /analytics and /depreciation gate it
    // on depreciation:read, so the register must not be a way around that.
    const showDep = hasCap(req, 'depreciation:read')
    const w = new Where()
    w.add('a.deleted_at is null')
    applyFilters(w, f, { site: 'a.site_id', location: 's.location_id', date: 'a.purchase_date', status: 'a.status' })
    const data = await rows(c, `
      select a.ain, a.name, cat.name as category, loc.name as location, s.name as site,
        a.status, a.lifecycle_status, a.criticality, a.manufacturer, a.model, a.serial_number, a.supplier,
        a.install_date, a.purchase_date, a.warranty_expiry, a.health_score,
        a.last_maintenance_at, a.next_maintenance_at, a.purchase_value_cents,
        ${showDep ? 'a.depreciation_method, a.accumulated_depreciation_cents, a.nbv_cents, a.nbv_computed_at,' : ''}
        a.created_at
      from public.assets a
      left join public.asset_categories cat on cat.id = a.category_id
      left join public.sites s on s.id = a.site_id
      left join public.locations loc on loc.id = s.location_id
      ${w.sql}
      order by a.ain
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('AIN', 'ain', 'text', 18), col('Name', 'name', 'text', 32), col('Category', 'category', 'text', 20),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
        col('Status', 'status', 'text', 14), col('Lifecycle', 'lifecycle_status', 'text', 16), col('Criticality', 'criticality', 'text', 12),
        col('Manufacturer', 'manufacturer', 'text', 18), col('Model', 'model', 'text', 16), col('Serial Number', 'serial_number', 'text', 18),
        col('Supplier', 'supplier', 'text', 18),
        col('Install Date', 'install_date', 'date', 13), col('Purchase Date', 'purchase_date', 'date', 13), col('Warranty Expiry', 'warranty_expiry', 'date', 15),
        col('Health Score', 'health_score', 'number', 12),
        col('Last Maintenance', 'last_maintenance_at', 'date', 16), col('Next Maintenance', 'next_maintenance_at', 'date', 16),
        col('Purchase Value (NGN)', 'purchase_value_cents', 'money', 20),
        ...(showDep ? [
          col('Depreciation Method', 'depreciation_method', 'text', 20),
          col('Accumulated Depreciation (NGN)', 'accumulated_depreciation_cents', 'money', 28),
          col('Book Value (NGN)', 'nbv_cents', 'money', 18),
          col('Book Value As Of', 'nbv_computed_at', 'date', 16),
        ] : []),
        col('Created', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
