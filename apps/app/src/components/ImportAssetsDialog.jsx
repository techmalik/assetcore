import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { importAssets } from '../lib/db/assets'

// Columns the server understands. Header matching is case- and
// separator-insensitive, so "Purchase Date" and "purchase_date" both land.
const KNOWN_COLUMNS = [
  ['ain', 'required — the asset tag'],
  ['name', 'required'],
  ['site', 'must already exist'],
  ['category', 'created on import if you allow it'],
  ['status', 'operational · attention · critical · offline'],
  ['lifecycle_status', 'planned · in_service · standby · under_maintenance · in_storage · disposed'],
  ['criticality', 'low · medium · high · critical'],
  ['manufacturer', ''],
  ['model', ''],
  ['serial_number', ''],
  ['supplier', ''],
  ['purchase_date', 'YYYY-MM-DD or DD/MM/YYYY'],
  ['commission_date', ''],
  ['warranty_expiry', ''],
  ['purchase_value', '₦, commas fine'],
  ['salvage_value', ''],
  ['useful_life_years', ''],
  ['health_score', '0–100'],
  ['lat', ''],
  ['lng', ''],
  ['tags', 'separate with ; or ,'],
  ['notes', ''],
]

const TEMPLATE_HEADERS = KNOWN_COLUMNS.map(([c]) => c).join(',')

export default function ImportAssetsDialog({ onClose, onDone }) {
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [mode, setMode] = useState('create')
  const [createCategories, setCreateCategories] = useState(true)
  const [parseError, setParseError] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [showColumns, setShowColumns] = useState(false)
  const fileRef = useRef(null)

  function pickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setResult(null)
    setFileName(file.name)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (out) => {
        if (!out.data.length) { setParseError('That file has no data rows.'); setRows(null); return }
        if (out.data.length > 5000) { setParseError('Files are limited to 5,000 rows. Split the sheet and import in batches.'); setRows(null); return }
        setHeaders(out.meta.fields || [])
        setRows(out.data)
      },
      error: () => setParseError('Could not read that file. Is it a CSV?'),
    })
  }

  async function run() {
    setRunning(true)
    setParseError('')
    try {
      setResult(await importAssets({ rows, mode, create_missing_categories: createCategories }))
    } catch (e) {
      // A 422 carries the aborted-import payload, which is more useful than the message.
      setParseError(e.message || 'Import failed.')
    } finally {
      setRunning(false)
    }
  }

  function downloadTemplate() {
    const blob = new Blob([`${TEMPLATE_HEADERS}\n`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'assetcore-asset-import-template.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const saved = result ? result.created + result.updated : 0

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <div style={{ position: 'relative', width: 620, maxHeight: '86vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)' }}>Import assets from CSV</h3>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>Bring an existing asset register in one file.</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result ? (
            <>
              <div style={{
                background: result.aborted ? 'var(--srb)' : 'var(--sgb)',
                border: `1px solid ${result.aborted ? 'var(--srbr)' : 'var(--sgbr)'}`,
                borderRadius: 6, padding: '14px 16px',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: result.aborted ? 'var(--srt)' : 'var(--sgt)', marginBottom: 4 }}>
                  {result.aborted
                    ? 'Import stopped — nothing was saved'
                    : `${saved} asset${saved === 1 ? '' : 's'} saved`}
                </div>
                <div style={{ fontSize: 12.5, color: result.aborted ? 'var(--srt)' : 'var(--sgt)' }}>
                  {result.aborted
                    ? 'Fix the row below and import the file again.'
                    : `${result.created} created · ${result.updated} updated · ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped`}
                </div>
              </div>

              {result.errors.length > 0 && (
                <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '9px 14px', background: 'var(--n50)', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>
                    Rows not imported
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {result.errors.map((e, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--n500)', flexShrink: 0, width: 46 }}>Row {e.row}</span>
                        <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--b700)', flexShrink: 0, width: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.ain || '—'}</span>
                        <span style={{ color: 'var(--n700)' }}>{e.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ border: '1px dashed var(--n300)', borderRadius: 8, padding: 20, textAlign: 'center' }}>
                <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={pickFile} style={{ display: 'none' }} />
                <button onClick={() => fileRef.current?.click()} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>
                  {fileName ? 'Choose a different file' : 'Choose CSV file'}
                </button>
                {fileName && (
                  <p style={{ fontSize: 12, color: 'var(--n600)', marginTop: 10 }}>
                    <strong style={{ fontFamily: 'var(--ff-m)' }}>{fileName}</strong>
                    {rows ? ` · ${rows.length} row${rows.length === 1 ? '' : 's'} · ${headers.length} columns` : ''}
                  </p>
                )}
                <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 10 }}>
                  <button onClick={downloadTemplate} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--b600)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
                    Download a template
                  </button>
                  {' or '}
                  <button onClick={() => setShowColumns((v) => !v)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--b600)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
                    see accepted columns
                  </button>
                </p>
              </div>

              {showColumns && (
                <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden', maxHeight: 200, overflowY: 'auto' }}>
                  {KNOWN_COLUMNS.map(([col, hint]) => (
                    <div key={col} style={{ display: 'flex', gap: 12, padding: '6px 14px', borderBottom: 'var(--bdr)', fontSize: 11.5 }}>
                      <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--n800)', width: 150, flexShrink: 0 }}>{col}</span>
                      <span style={{ color: 'var(--n500)' }}>{hint}</span>
                    </div>
                  ))}
                </div>
              )}

              {rows && (
                <div style={{ border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '9px 14px', background: 'var(--n50)', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>
                    First rows
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: '100%' }}>
                      <thead>
                        <tr>{headers.slice(0, 7).map((h) => (
                          <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: 'var(--n500)', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 3).map((r, i) => (
                          <tr key={i}>{headers.slice(0, 7).map((h) => (
                            <td key={h} style={{ padding: '7px 12px', color: 'var(--n700)', whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: 'var(--bdr)' }}>{r[h]}</td>
                          ))}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label className="label" style={{ display: 'block', marginBottom: 5 }}>If an AIN already exists</label>
                  <select className="input" value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: '100%' }}>
                    <option value="create">Skip it and report the row</option>
                    <option value="upsert">Update the existing asset</option>
                  </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--n700)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={createCategories} onChange={(e) => setCreateCategories(e.target.checked)} />
                  Create categories that don&rsquo;t exist yet
                </label>
              </div>

              {parseError && <p style={{ fontSize: 12, color: 'var(--srt)' }}>{parseError}</p>}
            </>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {result ? (
            <button onClick={() => { onDone(); onClose() }} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Done</button>
          ) : (
            <>
              <button onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
              <button onClick={run} disabled={!rows || running} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: !rows || running ? 0.6 : 1 }}>
                {running ? 'Importing…' : `Import ${rows ? rows.length : 0} rows`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
