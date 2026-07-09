import type { PoolClient } from 'pg'

export type ReportKind = 'asset_register' | 'wo_summary' | 'compliance_register' | 'pm_history'

export const REPORT_KINDS: ReportKind[] = ['asset_register', 'wo_summary', 'compliance_register', 'pm_history']

export type ReportColumn = { header: string; key: string; width?: number }
export type ReportData = { columns: ReportColumn[]; rows: Record<string, unknown>[] }

/** Pulls the rows for a given report kind, scoped to the caller's org via RLS
 * (queries run on the same client `withOrgContext` already set `app.org_id` on). */
export async function buildReportData(c: PoolClient, kind: ReportKind): Promise<ReportData> {
  switch (kind) {
    case 'asset_register': {
      const { rows } = await c.query(`
        select a.ain, a.name, cat.name as category, s.name as site, a.status,
          a.health_score, a.purchase_value_cents, a.nbv_cents, a.created_at
        from public.assets a
        left join public.asset_categories cat on cat.id = a.category_id
        left join public.sites s on s.id = a.site_id
        where a.deleted_at is null
        order by a.ain
      `)
      return {
        columns: [
          { header: 'AIN', key: 'ain', width: 18 },
          { header: 'Name', key: 'name', width: 32 },
          { header: 'Category', key: 'category', width: 20 },
          { header: 'Site', key: 'site', width: 18 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Health Score', key: 'health_score', width: 14 },
          { header: 'Purchase Value (NGN)', key: 'purchase_value', width: 20 },
          { header: 'NBV (NGN)', key: 'nbv', width: 18 },
          { header: 'Created', key: 'created_at', width: 14 },
        ],
        rows: rows.map((r) => ({
          ain: r.ain, name: r.name, category: r.category || '', site: r.site || '', status: r.status,
          health_score: r.health_score ?? '',
          purchase_value: r.purchase_value_cents != null ? Number(r.purchase_value_cents) / 100 : '',
          nbv: r.nbv_cents != null ? Number(r.nbv_cents) / 100 : '',
          created_at: r.created_at,
        })),
      }
    }
    case 'wo_summary': {
      const { rows } = await c.query(`
        select w.ref, w.title, s.name as site, a.ain as asset_ain, w.type, w.status, w.priority,
          w.sla_due, w.created_at, w.updated_at
        from public.work_orders w
        left join public.sites s on s.id = w.site_id
        left join public.assets a on a.id = w.asset_id
        where w.deleted_at is null
        order by w.created_at desc
      `)
      return {
        columns: [
          { header: 'Ref', key: 'ref', width: 14 },
          { header: 'Title', key: 'title', width: 32 },
          { header: 'Site', key: 'site', width: 18 },
          { header: 'Asset', key: 'asset_ain', width: 16 },
          { header: 'Type', key: 'type', width: 14 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Priority', key: 'priority', width: 12 },
          { header: 'SLA Due', key: 'sla_due', width: 18 },
          { header: 'Created', key: 'created_at', width: 18 },
          { header: 'Updated', key: 'updated_at', width: 18 },
        ],
        rows: rows.map((r) => ({
          ref: r.ref, title: r.title, site: r.site || '', asset_ain: r.asset_ain || '',
          type: r.type, status: r.status, priority: r.priority,
          sla_due: r.sla_due, created_at: r.created_at, updated_at: r.updated_at,
        })),
      }
    }
    case 'compliance_register': {
      const { rows } = await c.query(`
        select cl.name, cl.licence_number, au.code as authority, s.name as site,
          cl.issued_date, cl.expiry_date
        from public.compliance_licences cl
        left join public.regulatory_authorities au on au.id = cl.authority_id
        left join public.sites s on s.id = cl.site_id
        where cl.deleted_at is null
        order by cl.expiry_date asc
      `)
      return {
        columns: [
          { header: 'Name', key: 'name', width: 32 },
          { header: 'Licence Number', key: 'licence_number', width: 20 },
          { header: 'Authority', key: 'authority', width: 14 },
          { header: 'Site', key: 'site', width: 18 },
          { header: 'Issued', key: 'issued_date', width: 14 },
          { header: 'Expires', key: 'expiry_date', width: 14 },
        ],
        rows: rows.map((r) => ({
          name: r.name, licence_number: r.licence_number || '', authority: r.authority || '',
          site: r.site || '', issued_date: r.issued_date, expiry_date: r.expiry_date,
        })),
      }
    }
    case 'pm_history': {
      const { rows } = await c.query(`
        select t.title, a.ain as asset_ain, s.name as site, t.status, t.due_date, t.completed_at
        from public.pm_tasks t
        left join public.assets a on a.id = t.asset_id
        left join public.sites s on s.id = t.site_id
        order by t.due_date desc
      `)
      return {
        columns: [
          { header: 'Title', key: 'title', width: 32 },
          { header: 'Asset', key: 'asset_ain', width: 16 },
          { header: 'Site', key: 'site', width: 18 },
          { header: 'Status', key: 'status', width: 14 },
          { header: 'Due Date', key: 'due_date', width: 14 },
          { header: 'Completed At', key: 'completed_at', width: 18 },
        ],
        rows: rows.map((r) => ({
          title: r.title, asset_ain: r.asset_ain || '', site: r.site || '', status: r.status,
          due_date: r.due_date, completed_at: r.completed_at,
        })),
      }
    }
  }
}
