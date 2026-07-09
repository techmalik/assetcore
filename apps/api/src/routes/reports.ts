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
