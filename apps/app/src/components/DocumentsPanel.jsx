import { useState, useEffect, useCallback, useRef } from 'react'
import { listDocuments, uploadDocument, deleteDocument, DOCUMENT_KINDS } from '../lib/db/documents'
import AuthImage from './AuthImage.jsx'
import { api } from '../lib/apiClient'

// One typed document registry, rendered the same way wherever files hang off a
// record. `parent` is a single-key object: { asset_id }, { work_order_id },
// { inspection_id } or { compliance_licence_id }.

const KIND_LABEL = Object.fromEntries(DOCUMENT_KINDS)

function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function isImage(contentType) {
  return typeof contentType === 'string' && contentType.startsWith('image/')
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M4 2h5l3 3v9H4V2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

export default function DocumentsPanel({ parent, canEdit = false, compact = false }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('other')
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const fileRef = useRef(null)

  // Object identity changes on every render at the call site, so key the effect
  // on the serialised parent instead — otherwise this reloads in a loop.
  const parentKey = JSON.stringify(parent)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDocs(await listDocuments(JSON.parse(parentKey)))
    } catch (e) {
      setError(e.message || 'Could not load documents.')
    } finally {
      setLoading(false)
    }
  }, [parentKey])

  useEffect(() => { load() }, [load])

  async function handlePick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await uploadDocument(JSON.parse(parentKey), file, { kind })
      await load()
    } catch (ex) {
      setError(ex.message === 'forbidden' ? 'Your role cannot add documents here.' : ex.message || 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove(doc) {
    if (!confirm(`Remove "${doc.file_name}" from this record?`)) return
    try { await deleteDocument(doc.id); await load() }
    catch (ex) { setError(ex.message || 'Delete failed.') }
  }

  async function open(doc) {
    if (isImage(doc.content_type)) { setLightbox(doc); return }
    try { await api.download(`/files/${doc.storage_path}`, doc.file_name) }
    catch { setError('Could not open that file.') }
  }

  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>
          Documents
        </span>
        <span style={{ fontSize: 11, color: 'var(--n400)' }}>{loading ? '' : docs.length}</span>
      </div>

      {loading ? (
        <div style={{ padding: 18, fontSize: 12, color: 'var(--n400)' }}>Loading…</div>
      ) : docs.length === 0 ? (
        <div style={{ padding: 18, fontSize: 12, color: 'var(--n400)' }}>
          No manuals, warranties or certificates attached yet.
        </div>
      ) : (
        <div>
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: 'var(--bdr)' }}>
              {isImage(d.content_type) ? (
                <AuthImage relPath={d.storage_path} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--n200)', flexShrink: 0 }} />
              ) : (
                <span style={{ color: 'var(--n400)', display: 'flex' }}><FileIcon /></span>
              )}
              <button
                onClick={() => open(d)}
                title={`Open ${d.file_name}`}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
              >
                <div style={{ fontSize: 12.5, color: 'var(--n900)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</div>
                <div style={{ fontSize: 11, color: 'var(--n500)' }}>
                  {KIND_LABEL[d.kind] || d.kind} · {formatSize(d.size_bytes)}
                  {d.uploader ? ` · ${d.uploader.full_name}` : ''}
                </div>
              </button>
              {canEdit && (
                <button onClick={() => remove(d)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 4, display: 'flex' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} style={{ height: 30, fontSize: 12, width: compact ? '100%' : 130 }}>
            {DOCUMENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input ref={fileRef} type="file" onChange={handlePick} disabled={busy} style={{ fontSize: 11, flex: 1, minWidth: 0 }} />
          {busy && <span style={{ fontSize: 11, color: 'var(--n500)' }}>Uploading…</span>}
        </div>
      )}

      {error && <p style={{ fontSize: 11.5, color: 'var(--srt)', padding: '0 14px 10px' }}>{error}</p>}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, cursor: 'zoom-out' }}
        >
          <AuthImage relPath={lightbox.storage_path} alt={lightbox.file_name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 12, fontFamily: 'var(--ff-m)' }}>
            {lightbox.file_name}
          </div>
        </div>
      )}
    </div>
  )
}
