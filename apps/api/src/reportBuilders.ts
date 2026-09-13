import type { PoolClient } from 'pg'
import ExcelJS from 'exceljs'
import { config } from './config.js'

export type ReportKind = 'asset_register' | 'wo_summary' | 'compliance_register' | 'pm_history'

export const REPORT_KINDS: ReportKind[] = ['asset_register', 'wo_summary', 'compliance_register', 'pm_history']

/** How a cell is written. `money` values are CENTS (as stored) and come out as
 * NGN units; `date` is a pg `date` (a 'YYYY-MM-DD' string — db.ts disables the
 * Date parser for it); `datetime` is a timestamptz. Untyped columns are
 * written as-is, which is what the older /reports builders rely on. */
export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'datetime'

export type ReportColumn = { header: string; key: string; width?: number; type?: ColumnType }
export type ReportData = { columns: ReportColumn[]; rows: Record<string, unknown>[] }

/** Pulls the rows for a given report kind, scoped to the caller's org via RLS
 * (queries run on the same client `withOrgContext` already set `app.org_id` on). */
export async function buildReportData(c: PoolClient, kind: ReportKind): Promise<ReportData> {
  switch (kind) {
    case 'asset_register': {
      const { rows } = await c.query(`
        select a.ain, a.name, cat.name as category, s.name as site, a.status,
          a.health_score, a.purchase_value_cents, a.nbv_cents,
          a.accumulated_depreciation_cents, a.depreciation_method, a.created_at
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
          { header: 'Accumulated Depreciation (NGN)', key: 'accumulated_depreciation', width: 28 },
          { header: 'Book Value (NGN)', key: 'nbv', width: 18 },
          { header: 'Created', key: 'created_at', width: 14 },
        ],
        rows: rows.map((r) => ({
          ain: r.ain, name: r.name, category: r.category || '', site: r.site || '', status: r.status,
          health_score: r.health_score ?? '',
          purchase_value: r.purchase_value_cents != null ? Number(r.purchase_value_cents) / 100 : '',
          // Blank, not 0 — a null book value means "not calculable from the
          // data we hold", which is a different claim from "fully written down".
          accumulated_depreciation: r.accumulated_depreciation_cents != null ? Number(r.accumulated_depreciation_cents) / 100 : '',
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

// ---------------------------------------------------------------------------
// Shared renderers — used by both the stored /reports files and the streamed
// /exports downloads, so a CSV or workbook looks the same whichever door it
// came out of.
// ---------------------------------------------------------------------------

// Wall-clock parts in the org's timezone. A timestamptz handed to exceljs as a
// raw Date is written as UTC, so an event at 00:30 in Lagos would appear in
// the sheet on the previous day.
const wallClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function localParts(d: Date) {
  const p: Record<string, string> = {}
  for (const part of wallClock.formatToParts(d)) p[part.type] = part.value
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}

const pad = (n: number) => String(n).padStart(2, '0')
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Today's date in the org's timezone, for filenames. */
export function localDateStamp(now = new Date()): string {
  const p = localParts(now)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`
}

type Cell =
  | { kind: 'blank' }
  | { kind: 'date'; y: number; mo: number; d: number }
  | { kind: 'datetime'; y: number; mo: number; d: number; h: number; mi: number; s: number }
  | { kind: 'number'; value: number; money: boolean }
  | { kind: 'text'; value: string }

function toCell(v: unknown, type: ColumnType | undefined): Cell {
  if (v === null || v === undefined || v === '') return { kind: 'blank' }

  if (type === 'date' || type === 'datetime' || v instanceof Date) {
    if (typeof v === 'string') {
      const m = DATE_ONLY.exec(v)
      // A pg `date` stays a calendar date even under a datetime column (e.g.
      // asset_transfers.transferred_at may be either) — no invented midnight.
      if (m) return { kind: 'date', y: +m[1], mo: +m[2], d: +m[3] }
    }
    const d = v instanceof Date ? v : new Date(String(v))
    if (Number.isNaN(d.getTime())) return { kind: 'text', value: String(v) }
    const p = localParts(d)
    return type === 'date' ? { kind: 'date', y: p.y, mo: p.mo, d: p.d } : { kind: 'datetime', ...p }
  }

  if (type === 'money' || type === 'number') {
    // bigint and numeric arrive from pg as strings.
    const n = Number(v)
    if (!Number.isFinite(n)) return { kind: 'blank' }
    return type === 'money' ? { kind: 'number', value: n / 100, money: true } : { kind: 'number', value: n, money: false }
  }

  if (typeof v === 'number') return { kind: 'number', value: v, money: false }
  if (Array.isArray(v)) return { kind: 'text', value: v.join(', ') }
  if (typeof v === 'object') return { kind: 'text', value: JSON.stringify(v) }
  return { kind: 'text', value: String(v) }
}

const NUM_FMT: Partial<Record<ColumnType, string>> = {
  money: '#,##0.00',
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm',
}

/** Excel workbook: bold frozen header with an autofilter, real dates and real
 * numbers so the sheet can be sorted and summed without cleaning it first. */
export async function renderXlsx(data: ReportData, sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AssetCore'
  workbook.created = new Date()
  // Excel rejects sheet names over 31 chars or containing []:*?/\ outright.
  const name = sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Export'
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = data.columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? Math.min(40, Math.max(12, col.header.length + 4)),
  }))
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F5' } }
  if (data.columns.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.columns.length } }
  }

  for (const r of data.rows) {
    const row = sheet.addRow([])
    data.columns.forEach((col, i) => {
      const cell = toCell(r[col.key], col.type)
      const target = row.getCell(i + 1)
      switch (cell.kind) {
        case 'blank': return
        case 'date':
          // UTC-constructed so exceljs's UTC serialisation lands on the same day.
          target.value = new Date(Date.UTC(cell.y, cell.mo - 1, cell.d))
          target.numFmt = NUM_FMT.date!
          return
        case 'datetime':
          target.value = new Date(Date.UTC(cell.y, cell.mo - 1, cell.d, cell.h, cell.mi, cell.s))
          target.numFmt = NUM_FMT.datetime!
          return
        case 'number':
          target.value = cell.value
          if (cell.money) target.numFmt = NUM_FMT.money!
          return
        case 'text':
          target.value = cell.value
      }
    })
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function csvField(value: string): string {
  // RFC 4180: quote anything holding a quote, comma, CR or LF; double quotes.
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** CSV with a UTF-8 BOM (without it Excel decodes as Windows-1252 and every ₦
 * becomes mojibake) and CRLF line endings per RFC 4180. */
export function renderCsv(data: ReportData): string {
  const lines = [data.columns.map((col) => csvField(col.header)).join(',')]
  for (const r of data.rows) {
    lines.push(data.columns.map((col) => {
      const cell = toCell(r[col.key], col.type)
      switch (cell.kind) {
        case 'blank': return ''
        case 'date': return `${cell.y}-${pad(cell.mo)}-${pad(cell.d)}`
        case 'datetime': return `${cell.y}-${pad(cell.mo)}-${pad(cell.d)} ${pad(cell.h)}:${pad(cell.mi)}:${pad(cell.s)}`
        case 'number': return cell.money ? cell.value.toFixed(2) : String(cell.value)
        case 'text': {
          // A text cell starting with = + - @ is executed as a formula when the
          // file is opened in Excel — and names, notes and audit labels are
          // typed by users. The leading apostrophe makes it inert.
          const safe = /^[=+\-@\t\r]/.test(cell.value) ? `'${cell.value}` : cell.value
          return csvField(safe)
        }
      }
    }).join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
