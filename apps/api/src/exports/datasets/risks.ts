import { Where } from '../../http/query.js'
import { RISK_STATUSES } from '@assetcore/domain'
import { col, applyFilters, LIMIT_SQL, rows } from '../common.js'
import type { Dataset } from '../common.js'

export const risks: Dataset = {
  key: 'risks',
  label: 'Risk register',
  description: 'Risk assessments with inherent and residual scores, bands, controls and owners.',
  cap: 'risk:read',
  filters: ['location', 'site', 'status', 'date'],
  dateLabel: 'Raised',
  statuses: RISK_STATUSES,
  build: async ({ c, f }) => {
    const w = new Where()
    w.add('r.deleted_at is null')
    applyFilters(w, f, { site: 'r.site_id', location: 's.location_id', date: 'r.created_at', status: 'r.status' })
    // Bands come from public.risk_band so the file uses the same words as
    // the register on screen.
    const data = await rows(c, `
      select r.ref, r.title, r.category, r.status, a.ain as asset_ain, a.name as asset_name,
        loc.name as location, s.name as site,
        r.likelihood, r.consequence, r.inherent_score, public.risk_band(r.inherent_score) as inherent_band,
        r.controls, r.residual_likelihood, r.residual_consequence, r.residual_score,
        public.risk_band(r.residual_score) as residual_band,
        o.full_name as owner, r.review_date, r.created_at
      from public.risk_assessments r
      left join public.assets a on a.id = r.asset_id
      left join public.sites s on s.id = r.site_id
      left join public.locations loc on loc.id = s.location_id
      left join public.users o on o.id = r.owner_id
      ${w.sql}
      order by r.inherent_score desc nulls last, r.created_at desc
      ${LIMIT_SQL}`, w.params)
    return {
      columns: [
        col('Ref', 'ref', 'text', 14), col('Title', 'title', 'text', 30), col('Category', 'category', 'text', 14),
        col('Status', 'status', 'text', 12), col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
        col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
        col('Likelihood', 'likelihood', 'number', 11), col('Consequence', 'consequence', 'number', 12),
        col('Inherent Score', 'inherent_score', 'number', 14), col('Inherent Band', 'inherent_band', 'text', 14),
        col('Controls', 'controls', 'text', 32),
        col('Residual Likelihood', 'residual_likelihood', 'number', 18), col('Residual Consequence', 'residual_consequence', 'number', 20),
        col('Residual Score', 'residual_score', 'number', 14), col('Residual Band', 'residual_band', 'text', 14),
        col('Owner', 'owner', 'text', 20), col('Review Date', 'review_date', 'date', 13), col('Raised', 'created_at', 'datetime', 17),
      ],
      rows: data,
    }
  },
}
