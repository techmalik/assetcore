import { saveBlob } from './apiClient'

// The asset import's CSV: the columns it reads, a template to start from, and
// a parser for what comes back (quoted fields, doubled quotes, CRLF, blank
// rows). Rows come back as objects keyed by the lower-cased header.

// health_score is deliberately absent: it's derived from the two maintenance
// dates by recompute_asset_health_for(), so an imported value would be
// overwritten on the very next write. Importers who supplied one were being
// quietly ignored.
export const CSV_HEADERS = ['ain', 'name', 'category', 'location', 'site', 'status', 'manufacturer', 'model', 'serial_number', 'install_date', 'purchase_date', 'runtime_hours', 'value', 'last_maintenance_date', 'next_maintenance_date', 'tags', 'lat', 'lng']

export function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadTemplate() {
  // One value per header, in the same order. The '90' that used to sit
  // between value and last_maintenance_date was health_score, dropped from
  // CSV_HEADERS above and left behind here — it shifted every date, the
  // tags and both coordinates one column left in the file we hand people.
  const example = ['AST-001', 'Compressor Unit X-5', 'Compressor', 'Lagos', 'Lagos DS-04', 'operational', 'GE', 'GCF-700', 'SN-001', '2023-01-15', '2022-11-01', '18240', '5000000', '2025-06-01', '2025-12-01', 'critical,offshore', '6.45', '3.4']
  if (example.length !== CSV_HEADERS.length) throw new Error('asset import template: example row does not match its headers')
  const csv = CSV_HEADERS.join(',') + '\n' + example.map(csvCell).join(',') + '\n'
  saveBlob(new Blob([csv], { type: 'text/csv' }), 'asset-import-template.csv')
}

export function parseCSV(text) {
  const rows = []
  let i = 0, field = '', row = [], inQuotes = false
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { rows.push(row); row = [] }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue } inQuotes = false; i++; continue }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { pushField(); i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { pushField(); pushRow(); i++; continue }
    field += ch; i++
  }
  if (field.length || row.length) { pushField(); pushRow() }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (!nonEmpty.length) return []
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase())
  return nonEmpty.slice(1).map((r) => {
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim() })
    return obj
  })
}
