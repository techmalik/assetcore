import { useState, useRef } from 'react'
import { importAssets } from '../../lib/db/assets'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { downloadTemplate, parseCSV } from '../../lib/csv'
import Modal from '../../components/Modal.jsx'
import { FormError } from '../../components/form.jsx'

// ── CSV Import Modal ───────────────────────────────────────────────────────────
export function ImportModal({ onClose, onDone }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')
  const fileRef = useRef(null)

  async function onFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(true); setErr(''); setResult(null)
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (!rows.length) { setErr('No data rows found. Make sure the first line is the header row.'); setBusy(false); return }
      const imported = await importAssets(rows)
      setResult(imported)
      const { created, skipped, errors } = imported.summary
      if (errors > 0) toast.error(`Import finished with ${errors} error${errors !== 1 ? 's' : ''} — ${created} created, ${skipped} skipped.`)
      else toast.success(`Import complete — ${created} created, ${skipped} skipped.`)
    } catch (ex) { setErr(errorText(ex, 'Import failed.')) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <Modal
      title="Import assets from CSV" width={460} onClose={onClose}
      footer={(
        <button type="button" onClick={() => { if (result) onDone(); onClose() }} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{result ? 'Done' : 'Close'}</button>
      )}
    >
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 14, lineHeight: 1.6 }}>
          Download the template, fill it in, then upload it. Assets are matched by AIN — existing AINs are skipped. Category, Location and Site are matched by name or code; the Location column disambiguates sites that share a name across locations. Last and next maintenance dates are required per row (they drive the health decay schedule).
        </p>
        <button onClick={downloadTemplate} className="btn btn-secondary" style={{ height: 34, padding: '0 14px', fontSize: 13, marginBottom: 14 }}>↓ Download template</button>
        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} style={{ fontSize: 12 }} />
          {busy && <span style={{ fontSize: 12, color: 'var(--n500)', marginLeft: 8 }}>Importing…</span>}
        </div>
        <FormError style={{ marginTop: 12 }}>{err}</FormError>
        {result && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--sgt)', fontWeight: 600 }}>{result.summary.created} created</span>
              <span style={{ fontSize: 12, color: 'var(--sat)', fontWeight: 600 }}>{result.summary.skipped} skipped</span>
              <span style={{ fontSize: 12, color: 'var(--srt)', fontWeight: 600 }}>{result.summary.errors} errors</span>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: 'var(--bdr)', borderRadius: 6 }}>
              {result.results.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: i < result.results.length - 1 ? 'var(--bdr)' : 'none', fontSize: 12 }}>
                  <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--n700)', width: 110, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.ain}</span>
                  <span style={{ color: r.status === 'created' ? 'var(--sgt)' : r.status === 'skipped' ? 'var(--sat)' : 'var(--srt)', width: 60, flexShrink: 0 }}>{r.status}</span>
                  <span style={{ color: 'var(--n500)', flex: 1 }}>{r.message || ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
    </Modal>
  )
}
