import ExcelJS from 'exceljs'
import { config } from './config.js'

/** How a cell is written. `money` values are CENTS (as stored) and come out
 * in whole units of the org's base currency, which the route adds to the
 * column header; `date` is a pg `date` (a 'YYYY-MM-DD' string — db.ts disables the
 * Date parser for it); `datetime` is a timestamptz. Untyped columns are
 * written as-is. */
export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'datetime'

export type ReportColumn = { header: string; key: string; width?: number; type?: ColumnType }
export type ReportData = { columns: ReportColumn[]; rows: Record<string, unknown>[] }

// ---------------------------------------------------------------------------
// Renderers for the streamed /exports downloads.
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
