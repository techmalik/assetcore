import { Router, type Request } from 'express'
import type { PoolClient } from 'pg'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { hasCap } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { config } from '../config.js'
import { localDateStamp, renderCsv, renderXlsx, type ColumnType, type ReportColumn, type ReportData } from '../reportBuilders.js'
import { buildWhere as buildAuditWhere, filters as auditFilters } from './audit.js'

// Export module: every register a role can read, as CSV or Excel, built in
// memory and streamed straight back. Unlike /reports nothing is stored — an
// export is a snapshot of what the caller can see right now, and a stored
// copy would outlive the access that produced it.
//
// Scoping is RLS's job (withOrgContext sets org + site scope), so a
// site-scoped user's file only ever holds their sites. Capability gating is
// done here per dataset, because one router serves registers with different
// read capabilities.

export const exportsRouter = Router()
exportsRouter.use(requireAuth, requireOrg, requireActiveMembership)

/** Past this a spreadsheet stops being something a person opens. The file
 * says so (X-Export-Truncated) rather than silently dropping the tail. */
const ROW_LIMIT = 100_000

type FilterKey = 'location' | 'site' | 'date' | 'status' | 'q' | 'actor' | 'action' | 'entity_type'

type SchemaFlags = { hasTransfers: boolean; hasSiteStatus: boolean; hasSiteShutdown: boolean }

type CommonFilters = { location_id?: string; site_id?: string; from?: string; to?: string; status?: string }

type BuildCtx = { c: PoolClient; req: Request; f: CommonFilters; schema: SchemaFlags }

type Dataset = {
  key: string
  label: string
  description: string
  cap: string
  filters: FilterKey[] | ((s: SchemaFlags) => FilterKey[])
  /** What the date range is measured against, so the page can label it. */
  dateLabel?: string
  statuses?: string[]
  available?: (s: SchemaFlags) => boolean
  /** Datasets with their own filter vocabulary (the audit log) parse the
   * query themselves; everything else gets the common filters. */
  parse?: (query: Request['query']) => Record<string, string>
  build: (ctx: BuildCtx & { raw: Record<string, string> }) => Promise<ReportData>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

const col = (header: string, key: string, type?: ColumnType, width?: number): ReportColumn => ({ header, key, type, width })

/** Positional-parameter where-clause builder. `$?` placeholders are numbered
 * in order, so a clause that needs the same value twice just takes it twice. */
class Where {
  clauses: string[] = []
  params: unknown[] = []
  add(sql: string, ...values: unknown[]) {
    let out = sql
    for (const v of values) {
      this.params.push(v)
      out = out.replace('$?', `$${this.params.length}`)
    }
    this.clauses.push(out)
  }
  get sql() {
    return this.clauses.length ? `where ${this.clauses.join(' and ')}` : ''
  }
}

type FilterCols = { site?: string; location?: string; date?: string; status?: string }

function applyFilters(w: Where, f: CommonFilters, cols: FilterCols) {
  if (f.location_id && cols.location) w.add(`${cols.location} = $?`, f.location_id)
  if (f.site_id && cols.site) w.add(`${cols.site} = $?`, f.site_id)
  // Compared as calendar days — the request sets the session TimeZone to the
  // org's, so `::date` on a timestamptz is the local day, and `to` includes
  // the whole of that day for date and timestamptz columns alike.
  if (f.from && cols.date) w.add(`(${cols.date})::date >= $?::date`, f.from)
  if (f.to && cols.date) w.add(`(${cols.date})::date <= $?::date`, f.to)
  if (f.status && cols.status) w.add(`${cols.status} = $?`, f.status)
}

const LIMIT_SQL = `limit ${ROW_LIMIT + 1}`

async function rows(c: PoolClient, sql: string, params: unknown[]) {
  return (await c.query(sql, params)).rows as Record<string, unknown>[]
}

const DATASETS: Dataset[] = [
  {
    key: 'assets',
    label: 'Asset register',
    description: 'Every asset with its identity, location, status, condition, dates and value.',
    cap: 'asset:read',
    filters: ['location', 'site', 'status', 'date'],
    dateLabel: 'Purchase date',
    statuses: ['operational', 'maintenance', 'standby', 'offline', 'attention', 'critical', 'inactive'],
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
  },
  {
    key: 'work_orders',
    label: 'Work orders',
    description: 'Jobs with asset, assignee, schedule, hours, cost and close-out notes.',
    cap: 'wo:read',
    filters: ['location', 'site', 'status', 'date'],
    dateLabel: 'Raised',
    statuses: ['draft', 'new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed'],
    build: async ({ c, f }) => {
      const w = new Where()
      w.add('w.deleted_at is null')
      applyFilters(w, f, { site: 'w.site_id', location: 's.location_id', date: 'w.created_at', status: 'w.status' })
      const data = await rows(c, `
        select w.ref, w.title, w.type, w.status, w.priority, loc.name as location, s.name as site,
          a.ain as asset_ain, a.name as asset_name, asg.full_name as assignee, cr.full_name as created_by,
          w.sla_due, w.planned_start, w.planned_end, w.actual_start, w.actual_end,
          w.estimated_hours, w.actual_hours, w.downtime_hours, w.estimated_cost_cents, w.cost_cents,
          w.failure_mode, w.root_cause, w.corrective_actions, w.completion_notes, w.created_at, w.updated_at
        from public.work_orders w
        left join public.sites s on s.id = w.site_id
        left join public.locations loc on loc.id = s.location_id
        left join public.assets a on a.id = w.asset_id
        left join public.users asg on asg.id = w.assignee_id
        left join public.users cr on cr.id = w.created_by
        ${w.sql}
        order by w.created_at desc
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Ref', 'ref', 'text', 14), col('Title', 'title', 'text', 32), col('Type', 'type', 'text', 12),
          col('Status', 'status', 'text', 14), col('Priority', 'priority', 'text', 10),
          col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
          col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
          col('Assignee', 'assignee', 'text', 20), col('Raised By', 'created_by', 'text', 20),
          col('SLA Due', 'sla_due', 'datetime', 17), col('Planned Start', 'planned_start', 'date', 13), col('Planned End', 'planned_end', 'date', 13),
          col('Actual Start', 'actual_start', 'datetime', 17), col('Actual End', 'actual_end', 'datetime', 17),
          col('Estimated Hours', 'estimated_hours', 'number', 15), col('Actual Hours', 'actual_hours', 'number', 13),
          col('Downtime Hours', 'downtime_hours', 'number', 15),
          col('Estimated Cost (NGN)', 'estimated_cost_cents', 'money', 20), col('Cost (NGN)', 'cost_cents', 'money', 16),
          col('Failure Mode', 'failure_mode', 'text', 20), col('Root Cause', 'root_cause', 'text', 24),
          col('Corrective Actions', 'corrective_actions', 'text', 28), col('Completion Notes', 'completion_notes', 'text', 28),
          col('Created', 'created_at', 'datetime', 17), col('Updated', 'updated_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
    key: 'pm_history',
    label: 'PM history',
    description: 'Preventive maintenance tasks by asset and site, with due and completion dates.',
    cap: 'pm:read',
    filters: ['location', 'site', 'status', 'date'],
    dateLabel: 'Due date',
    statuses: ['pending', 'in_progress', 'completed', 'overdue', 'skipped'],
    build: async ({ c, f }) => {
      const w = new Where()
      applyFilters(w, f, { site: 't.site_id', location: 's.location_id', date: 't.due_date', status: 't.status' })
      const data = await rows(c, `
        select t.title, sch.frequency, a.ain as asset_ain, a.name as asset_name, loc.name as location, s.name as site,
          t.status, asg.full_name as assignee, t.due_date, t.completed_at, t.notes, t.created_at
        from public.pm_tasks t
        left join public.pm_schedules sch on sch.id = t.schedule_id
        left join public.assets a on a.id = t.asset_id
        left join public.sites s on s.id = t.site_id
        left join public.locations loc on loc.id = s.location_id
        left join public.users asg on asg.id = t.assignee_id
        ${w.sql}
        order by t.due_date desc nulls last, t.created_at desc
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Task', 'title', 'text', 32), col('Frequency', 'frequency', 'text', 12),
          col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
          col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
          col('Status', 'status', 'text', 12), col('Assignee', 'assignee', 'text', 20),
          col('Due Date', 'due_date', 'date', 13), col('Completed', 'completed_at', 'datetime', 17),
          col('Notes', 'notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
    key: 'maintenance_events',
    label: 'Maintenance completions',
    description: 'Every recorded maintenance completion, what closed it, who did it and the next due date.',
    cap: 'pm:read',
    filters: ['location', 'site', 'date'],
    dateLabel: 'Completed on',
    build: async ({ c, f }) => {
      const w = new Where()
      applyFilters(w, f, { site: 'e.site_id', location: 's.location_id', date: 'e.completed_at' })
      const data = await rows(c, `
        select e.completed_at, a.ain as asset_ain, a.name as asset_name, loc.name as location, s.name as site,
          e.source, t.title as pm_task, wo.ref as work_order_ref, u.full_name as performed_by,
          e.next_maintenance_at, e.notes, e.created_at
        from public.maintenance_events e
        left join public.assets a on a.id = e.asset_id
        left join public.sites s on s.id = e.site_id
        left join public.locations loc on loc.id = s.location_id
        left join public.pm_tasks t on t.id = e.pm_task_id
        left join public.work_orders wo on wo.id = e.work_order_id
        left join public.users u on u.id = e.performed_by
        ${w.sql}
        order by e.completed_at desc, e.created_at desc
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Completed On', 'completed_at', 'date', 13),
          col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
          col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
          col('Source', 'source', 'text', 12), col('PM Task', 'pm_task', 'text', 28), col('Work Order', 'work_order_ref', 'text', 14),
          col('Performed By', 'performed_by', 'text', 20), col('Next Maintenance', 'next_maintenance_at', 'date', 16),
          col('Notes', 'notes', 'text', 30), col('Recorded', 'created_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
    key: 'inspections',
    label: 'Inspections',
    description: 'Inspections with kind, inspector, schedule, condition rating and findings.',
    cap: 'inspection:read',
    filters: ['location', 'site', 'status', 'date'],
    dateLabel: 'Scheduled date',
    statuses: ['scheduled', 'due', 'in_progress', 'completed', 'overdue'],
    build: async ({ c, f }) => {
      const w = new Where()
      applyFilters(w, f, { site: 'i.site_id', location: 's.location_id', date: 'i.scheduled_date', status: 'i.status' })
      const data = await rows(c, `
        select i.title, i.kind, i.status, a.ain as asset_ain, a.name as asset_name, loc.name as location, s.name as site,
          u.full_name as inspector, i.scheduled_date, i.completed_date, i.condition_rating, i.findings, i.notes, i.created_at
        from public.inspections i
        left join public.assets a on a.id = i.asset_id
        left join public.sites s on s.id = i.site_id
        left join public.locations loc on loc.id = s.location_id
        left join public.users u on u.id = i.inspector_id
        ${w.sql}
        order by i.scheduled_date desc nulls last, i.created_at desc
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Title', 'title', 'text', 30), col('Kind', 'kind', 'text', 14), col('Status', 'status', 'text', 12),
          col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
          col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18), col('Inspector', 'inspector', 'text', 20),
          col('Scheduled', 'scheduled_date', 'date', 13), col('Completed', 'completed_date', 'date', 13),
          col('Condition Rating', 'condition_rating', 'number', 16),
          col('Findings', 'findings', 'text', 36), col('Notes', 'notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
    key: 'defects',
    label: 'Defects',
    description: 'Raised defects with severity, status, owner, due date and resolution.',
    cap: 'defect:read',
    filters: ['location', 'site', 'status', 'date'],
    dateLabel: 'Identified',
    statuses: ['open', 'acknowledged', 'in_progress', 'resolved', 'closed', 'deferred'],
    build: async ({ c, f }) => {
      const w = new Where()
      w.add('d.deleted_at is null')
      applyFilters(w, f, { site: 'd.site_id', location: 's.location_id', date: 'd.identified_date', status: 'd.status' })
      const data = await rows(c, `
        select d.ref, d.title, d.severity, d.status, d.category, a.ain as asset_ain, a.name as asset_name,
          loc.name as location, s.name as site, rep.full_name as reported_by, asg.full_name as assigned_to,
          d.identified_date, d.due_date, d.resolved_at, wo.ref as work_order_ref, d.description, d.resolution_notes, d.created_at
        from public.defects d
        left join public.assets a on a.id = d.asset_id
        left join public.sites s on s.id = d.site_id
        left join public.locations loc on loc.id = s.location_id
        left join public.users rep on rep.id = d.reported_by
        left join public.users asg on asg.id = d.assigned_to
        left join public.work_orders wo on wo.id = d.work_order_id
        ${w.sql}
        order by d.identified_date desc nulls last, d.created_at desc
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Ref', 'ref', 'text', 14), col('Title', 'title', 'text', 30), col('Severity', 'severity', 'text', 11),
          col('Status', 'status', 'text', 13), col('Category', 'category', 'text', 14),
          col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
          col('Location', 'location', 'text', 18), col('Site', 'site', 'text', 18),
          col('Reported By', 'reported_by', 'text', 20), col('Assigned To', 'assigned_to', 'text', 20),
          col('Identified', 'identified_date', 'date', 13), col('Due', 'due_date', 'date', 13), col('Resolved', 'resolved_at', 'datetime', 17),
          col('Work Order', 'work_order_ref', 'text', 14), col('Description', 'description', 'text', 36),
          col('Resolution Notes', 'resolution_notes', 'text', 30), col('Created', 'created_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
    key: 'risks',
    label: 'Risk register',
    description: 'Risk assessments with inherent and residual scores, bands, controls and owners.',
    cap: 'risk:read',
    filters: ['location', 'site', 'status', 'date'],
    dateLabel: 'Raised',
    statuses: ['open', 'mitigating', 'accepted', 'closed'],
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
  },
  {
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
  },
  {
    key: 'sites',
    label: 'Sites',
    description: 'Sites with their location, region, coordinates and asset count.',
    cap: 'asset:read',
    // sites.status arrives with migration 0027; until then there is nothing
    // to filter on and no column to show.
    filters: (s) => (s.hasSiteStatus ? ['location', 'site', 'status'] : ['location', 'site']),
    statuses: ['active', 'shutdown'],
    build: async ({ c, f, schema }) => {
      const w = new Where()
      w.add('s.deleted_at is null')
      applyFilters(w, { ...f, status: schema.hasSiteStatus ? f.status : undefined }, {
        site: 's.id', location: 's.location_id', status: 's.status',
      })
      const data = await rows(c, `
        select s.name, s.code, loc.name as location, s.region,
          ${schema.hasSiteStatus ? 's.status,' : ''}
          ${schema.hasSiteShutdown ? 's.shutdown_at, s.shutdown_reason,' : ''}
          s.lat, s.lng,
          (select count(*) from public.assets a where a.site_id = s.id and a.deleted_at is null)::int as asset_count,
          s.created_at
        from public.sites s
        left join public.locations loc on loc.id = s.location_id
        ${w.sql}
        order by loc.name nulls last, s.name
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Site', 'name', 'text', 24), col('Code', 'code', 'text', 10), col('Location', 'location', 'text', 18),
          col('Region', 'region', 'text', 16),
          ...(schema.hasSiteStatus ? [col('Status', 'status', 'text', 12)] : []),
          ...(schema.hasSiteShutdown ? [col('Shut Down', 'shutdown_at', 'datetime', 17), col('Shutdown Reason', 'shutdown_reason', 'text', 30)] : []),
          col('Latitude', 'lat', 'number', 12), col('Longitude', 'lng', 'number', 12),
          col('Assets', 'asset_count', 'number', 9), col('Created', 'created_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
    key: 'asset_transfers',
    label: 'Asset transfers',
    description: 'Assets moved between sites: from where, to where, why and by whom.',
    cap: 'asset:read',
    filters: ['location', 'site', 'date'],
    dateLabel: 'Transferred',
    available: (s) => s.hasTransfers,
    build: async ({ c, f }) => {
      const w = new Where()
      // A transfer belongs to both ends — filtering by a site or location
      // should show assets that left it as well as those that arrived.
      if (f.site_id) w.add('(t.from_site_id = $? or t.to_site_id = $?)', f.site_id, f.site_id)
      if (f.location_id) w.add('(fs.location_id = $? or ts.location_id = $?)', f.location_id, f.location_id)
      applyFilters(w, { from: f.from, to: f.to }, { date: 't.transferred_at' })
      const data = await rows(c, `
        select t.transferred_at, a.ain as asset_ain, a.name as asset_name,
          fs.name as from_site, fl.name as from_location, ts.name as to_site, tl.name as to_location,
          t.reason, u.full_name as transferred_by, t.created_at
        from public.asset_transfers t
        left join public.assets a on a.id = t.asset_id
        left join public.sites fs on fs.id = t.from_site_id
        left join public.locations fl on fl.id = fs.location_id
        left join public.sites ts on ts.id = t.to_site_id
        left join public.locations tl on tl.id = ts.location_id
        left join public.users u on u.id = t.transferred_by
        ${w.sql}
        order by t.transferred_at desc, t.created_at desc
        ${LIMIT_SQL}`, w.params)
      return {
        columns: [
          col('Transferred', 'transferred_at', 'datetime', 17),
          col('Asset AIN', 'asset_ain', 'text', 16), col('Asset', 'asset_name', 'text', 24),
          col('From Site', 'from_site', 'text', 18), col('From Location', 'from_location', 'text', 18),
          col('To Site', 'to_site', 'text', 18), col('To Location', 'to_location', 'text', 18),
          col('Reason', 'reason', 'text', 32), col('Transferred By', 'transferred_by', 'text', 20),
          col('Recorded', 'created_at', 'datetime', 17),
        ],
        rows: data,
      }
    },
  },
  {
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
  },
]

/** Tables and columns other migrations are still landing (0027). Checked per
 * request so the module works on either side of that migration. */
async function schemaFlags(c: PoolClient): Promise<SchemaFlags> {
  const { rows: r } = await c.query(`
    select to_regclass('public.asset_transfers') is not null as has_transfers,
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sites' and column_name = 'status') as has_site_status,
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sites' and column_name = 'shutdown_at') as has_site_shutdown`)
  return { hasTransfers: r[0].has_transfers, hasSiteStatus: r[0].has_site_status, hasSiteShutdown: r[0].has_site_shutdown }
}

function filtersFor(ds: Dataset, schema: SchemaFlags): FilterKey[] {
  return typeof ds.filters === 'function' ? ds.filters(schema) : ds.filters
}

/** Common filters, keeping only the ones this dataset supports and values
 * that could match. Anything else is ignored rather than 400'd, like the
 * audit log's own filter bar. */
function parseCommon(ds: Dataset, schema: SchemaFlags, q: Request['query']): CommonFilters {
  const allowed = filtersFor(ds, schema)
  const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).trim() : '')
  const f: CommonFilters = {}
  if (allowed.includes('location') && UUID.test(str('location_id'))) f.location_id = str('location_id')
  if (allowed.includes('site') && UUID.test(str('site_id'))) f.site_id = str('site_id')
  if (allowed.includes('date')) {
    if (DAY.test(str('from'))) f.from = str('from')
    if (DAY.test(str('to'))) f.to = str('to')
  }
  if (allowed.includes('status') && ds.statuses?.includes(str('status'))) f.status = str('status')
  return f
}

exportsRouter.get('/exports', async (req, res) => {
  const schema = await withOrgContext(claimsFromReq(req), schemaFlags)
  const list = DATASETS
    .filter((ds) => hasCap(req, ds.cap) && (!ds.available || ds.available(schema)))
    .map((ds) => {
      const filters = filtersFor(ds, schema)
      return {
        key: ds.key,
        label: ds.label,
        description: ds.description,
        filters,
        ...(filters.includes('date') && ds.dateLabel ? { date_label: ds.dateLabel } : {}),
        ...(filters.includes('status') && ds.statuses ? { statuses: ds.statuses } : {}),
      }
    })
  res.json(list)
})

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

exportsRouter.get('/exports/:dataset', async (req, res) => {
  const ds = DATASETS.find((d) => d.key === req.params.dataset)
  if (!ds) return res.status(404).json({ error: 'unknown_dataset' })
  if (!hasCap(req, ds.cap)) return res.status(403).json({ error: 'forbidden', capability: ds.cap })

  const rawFormat = req.query.format ?? 'xlsx'
  if (rawFormat !== 'csv' && rawFormat !== 'xlsx') return res.status(400).json({ error: 'invalid_format' })
  const format: 'csv' | 'xlsx' = rawFormat

  const out = await withOrgContext(claimsFromReq(req), async (c) => {
    // Dates in the file, `current_date` and the from/to day boundaries all
    // follow the org's clock rather than the database server's UTC.
    await c.query(`select set_config('TimeZone', $1, true)`, [config.TZ])
    const schema = await schemaFlags(c)
    if (ds.available && !ds.available(schema)) return null

    const f = ds.parse ? {} : parseCommon(ds, schema, req.query)
    const raw = ds.parse ? ds.parse(req.query) : {}
    const data = await ds.build({ c, req, f, schema, raw })

    const truncated = data.rows.length > ROW_LIMIT
    if (truncated) data.rows = data.rows.slice(0, ROW_LIMIT)

    // Rendered before the audit row commits, so a render failure can't leave
    // the log claiming a download that never happened.
    const body = format === 'xlsx' ? await renderXlsx(data, ds.label) : Buffer.from(renderCsv(data), 'utf8')

    await writeAuditLog(c, {
      orgId: req.claims!.org_id!,
      actorId: req.claims!.sub,
      action: 'export.download',
      entityType: 'export',
      // `title` is what resolve_audit_label reads for a row with no entity_id,
      // so the log's Entity column says which register left the building.
      after: { title: ds.label, dataset: ds.key, format, filters: ds.parse ? raw : f, row_count: data.rows.length, truncated },
      ip: req.ip ?? null,
    })
    return { body, rowCount: data.rows.length, truncated }
  })

  if (!out) return res.status(404).json({ error: 'unknown_dataset' })

  const filename = `assetcore-${ds.key}-${localDateStamp()}.${format}`
  res.setHeader('Content-Type', CONTENT_TYPES[format])
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length', String(out.body.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Export-Row-Count', String(out.rowCount))
  res.setHeader('X-Export-Truncated', String(out.truncated))
  // A split-host dev setup (VITE_API_URL) can't read these cross-origin otherwise.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Row-Count, X-Export-Truncated')
  res.end(out.body)
})
