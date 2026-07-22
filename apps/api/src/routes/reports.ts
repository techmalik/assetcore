import { Router } from 'express'
import { z } from 'zod'
import ExcelJS from 'exceljs'
import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { requireCap } from '../middleware/rbac.js'
import { config } from '../config.js'
import { buildReportData, REPORT_KINDS, type ReportKind } from '../reportBuilders.js'

export const reportsRouter = Router()
reportsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const SELECT = `
  select r.*,
    case when u.id is null then null else jsonb_build_object('full_name', u.full_name) end as created_by_profile
  from public.reports r
  left join public.users u on u.id = r.created_by
`

reportsRouter.get('/reports', async (req, res) => {
  const limit = Number(req.query.limit) || 50
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} order by r.created_at desc limit $1`, [limit]).then((r) => r.rows)
  )
  res.json(rows)
})

// Per-location asset/WO rollups + a category breakdown, for the Reports page's
// analytics tab. Asset and work-order aggregates are computed in separate
// CTEs before joining to locations — joining assets AND work_orders directly
// (both on sites) in one query would fan out (N assets x M work orders per
// site), silently inflating sum(purchase_value_cents)/sum(cost_cents). RLS
// (via withOrgContext) already scopes every table here to the caller's org
// and site access, so no separate scoping logic is needed.
reportsRouter.get('/reports/location-analytics', async (req, res) => {
  const data = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: locations } = await c.query(`
      with asset_agg as (
        select s.location_id,
          count(a.id) as asset_count,
          avg(a.health_score) as avg_health,
          sum(coalesce(a.purchase_value_cents, 0)) as total_value_cents
        from public.assets a
        join public.sites s on s.id = a.site_id
        where a.deleted_at is null
        group by s.location_id
      ),
      wo_agg as (
        select s.location_id,
          count(*) filter (where w.status <> 'closed') as wo_open,
          count(*) filter (where w.status = 'closed') as wo_completed,
          -- Total cost across every non-deleted WO regardless of status, not
          -- just completed ones — a WO's cost is normally estimated/logged at
          -- creation (see the new "Estimated cost" field), so a rollup scoped
          -- to closed-only would hide it until someone closes the ticket.
          sum(coalesce(w.cost_cents, 0)) as wo_cost_cents
        from public.work_orders w
        join public.sites s on s.id = w.site_id
        where w.deleted_at is null
        group by s.location_id
      )
      select loc.id, loc.name,
        coalesce(aa.asset_count, 0)::int as asset_count,
        round(aa.avg_health)::int as avg_health,
        coalesce(aa.total_value_cents, 0)::bigint as total_value_cents,
        coalesce(wa.wo_open, 0)::int as wo_open,
        coalesce(wa.wo_completed, 0)::int as wo_completed,
        coalesce(wa.wo_cost_cents, 0)::bigint as wo_cost_cents
      from public.locations loc
      left join asset_agg aa on aa.location_id = loc.id
      left join wo_agg wa on wa.location_id = loc.id
      where loc.deleted_at is null
      order by loc.name
    `)

    const { rows: categories } = await c.query(`
      select coalesce(cat.name, 'Uncategorized') as name, count(a.id)::int as count
      from public.assets a
      left join public.asset_categories cat on cat.id = a.category_id
      where a.deleted_at is null
      group by coalesce(cat.name, 'Uncategorized')
      order by count desc
    `)

    return { locations, categories }
  })
  res.json(data)
})

const requestInput = z.object({
  title: z.string().min(1),
  kind: z.enum(REPORT_KINDS as [ReportKind, ...ReportKind[]]),
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  params: z.record(z.unknown()).optional(),
})

reportsRouter.post('/reports', requireCap('report:create'), async (req, res) => {
  const parsed = requestInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { title, kind, format, params } = parsed.data

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.reports (org_id, title, kind, format, params, status, created_by)
       values (current_org_id(), $1, $2, $3, $4, 'pending', current_user_id())
       returning *`,
      [title, kind, format, params ?? {}]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
})

function toCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

// Builds the report file synchronously (small orgs, small files — no queue needed)
// and writes it to FILES_DIR/{org_id}/reports/. Replaces the old fake-completion
// stub that just marked reports ready with a random file size.
reportsRouter.post('/reports/:id/generate', requireCap('report:create'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query('select * from public.reports where id = $1', [req.params.id])
    const report = rows[0]
    if (!report) return { error: 'not_found' as const }
    if (!REPORT_KINDS.includes(report.kind as ReportKind)) {
      await c.query(`update public.reports set status = 'failed' where id = $1`, [req.params.id])
      return { error: 'unsupported_kind' as const }
    }

    const data = await buildReportData(c, report.kind as ReportKind)
    const orgId = req.claims!.org_id!
    const dir = path.join(config.FILES_DIR, orgId, 'reports')
    mkdirSync(dir, { recursive: true })
    const filename = `${report.id}.${report.format}`
    const fullPath = path.join(dir, filename)

    if (report.format === 'xlsx') {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet(report.kind)
      sheet.columns = data.columns
      sheet.getRow(1).font = { bold: true }
      for (const r of data.rows) sheet.addRow(r)
      await workbook.xlsx.writeFile(fullPath)
    } else {
      const { writeFile } = await import('node:fs/promises')
      const lines = [data.columns.map((col) => csvEscape(col.header)).join(',')]
      for (const r of data.rows) {
        lines.push(data.columns.map((col) => csvEscape(toCell(r[col.key]))).join(','))
      }
      await writeFile(fullPath, lines.join('\n'), 'utf8')
    }

    const { size } = await stat(fullPath)
    const { rows: updated } = await c.query(
      `update public.reports set status = 'ready', completed_at = now(),
         storage_path = $2, file_size_bytes = $3
       where id = $1 returning *`,
      [req.params.id, `reports/${filename}`, size]
    )
    return { data: updated[0] }
  })

  if ('error' in row) {
    if (row.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(400).json({ error: row.error })
  }
  res.json(row.data)
})
