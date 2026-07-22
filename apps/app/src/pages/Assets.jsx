import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import AuthImage from '../components/AuthImage.jsx'
import ImageLightbox from '../components/ImageLightbox.jsx'
import {
  listAssets, createAsset, updateAsset, softDeleteAsset, restoreAsset, importAssets,
  uploadAssetPhoto, deleteAssetPhoto, uploadAssetDocument, deleteAssetDocument, listAssetActivity, addAssetComment,
} from '../lib/db/assets'
import { listSites } from '../lib/db/sites'
import { listLocations } from '../lib/db/locations'
import { listCategories } from '../lib/db/categories'
import { listOrgUsers } from '../lib/db/orgMembers'
import { createWorkOrder, WO_TYPE_LABEL, WO_PRIORITY_LABEL } from '../lib/db/workOrders'
import { listPMTasks } from '../lib/db/pmTasks'
import { listInspections } from '../lib/db/inspections'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { healthColor, healthLabel } from '../lib/health'
import { api } from '../lib/apiClient'

const STATUS_STYLE = {
  critical:    { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', label: 'Critical' },
  attention:   { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', label: 'Attention' },
  operational: { bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', label: 'Operational' },
  offline:     { bg: 'var(--n100)', c: 'var(--n500)', br: 'var(--n300)', label: 'Offline' },
}

const MAX_PHOTOS = 5

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.offline
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 2, padding: '2px 7px', fontSize: 11, fontWeight: 500, border: '1px solid', background: s.bg, color: s.c, borderColor: s.br, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function HealthBar({ score }) {
  const color = healthColor(score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 5, background: 'var(--n200)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', width: 28 }}>{score}</span>
    </div>
  )
}

function formatNBV(cents) {
  if (!cents) return '—'
  const n = cents / 100
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`
  return `₦${n.toLocaleString()}`
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Stable module-scope field wrapper — defining it inside the modal would remount
// inputs on every keystroke and drop focus.
function Field({ label, required, full, children }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>{label}{required && ' *'}</label>
      {children}
    </div>
  )
}

// ── CSV helpers ────────────────────────────────────────────────────────────────
const CSV_HEADERS = ['ain', 'name', 'category', 'location', 'site', 'status', 'manufacturer', 'model', 'serial_number', 'install_date', 'value', 'health_score', 'tags', 'lat', 'lng']

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadTemplate() {
  const example = ['AST-001', 'Compressor Unit X-5', 'Compressor', 'Lagos', 'Lagos DS-04', 'operational', 'GE', 'GCF-700', 'SN-001', '2023-01-15', '5000000', '90', 'critical,offshore', '6.45', '3.4']
  const csv = CSV_HEADERS.join(',') + '\n' + example.map(csvCell).join(',') + '\n'
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'asset-import-template.csv'
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

function parseCSV(text) {
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

// ── Add / Edit Asset Modal ────────────────────────────────────────────────────
function AssetModal({ asset, sites, locations, categories, operators, onClose, onSave }) {
  const editing = Boolean(asset)
  const s0 = asset?.specs || {}
  // An asset stores only its site; its location is the site's location. Seed the
  // Location picker from the current site so editing shows the right zone.
  const initialSite = asset?.site_id ? sites.find((s) => s.id === asset.site_id) : null
  const [form, setForm] = useState({
    ain: asset?.ain || '', name: asset?.name || '',
    location_id: initialSite?.location_id || '',
    site_id: asset?.site_id || '', category_id: asset?.category_id || '',
    status: asset?.status || 'operational', health_score: asset?.health_score ?? 100,
    manufacturer: s0.manufacturer || '', model: s0.model || '', serial_number: s0.serial_number || '',
    install_date: s0.install_date || '',
    tags: Array.isArray(s0.tags) ? s0.tags.join(', ') : (s0.tags || ''),
    assigned_operator_id: asset?.assigned_operator_id || '',
    value: asset?.purchase_value_cents != null ? String(asset.purchase_value_cents / 100) : '',
    last_maintenance_at: asset?.last_maintenance_at || '', next_maintenance_at: asset?.next_maintenance_at || '',
    lat: asset?.lat != null ? String(asset.lat) : '', lng: asset?.lng != null ? String(asset.lng) : '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [photos, setPhotos] = useState(asset?.photos || [])
  const [documents, setDocuments] = useState(asset?.documents || [])
  const [pendingPhotos, setPendingPhotos] = useState([])
  const [pendingDocs, setPendingDocs] = useState([])
  const [busyFile, setBusyFile] = useState(false)
  const [lightbox, setLightbox] = useState(null) // { images, index } | null
  const photoRef = useRef(null)
  const docRef = useRef(null)

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  // Switching location clears the site unless the current site is in the new one.
  const setLocation = (id) => setForm((p) => ({
    ...p,
    location_id: id,
    site_id: p.site_id && sites.find((s) => s.id === p.site_id)?.location_id === id ? p.site_id : '',
  }))
  const sitesForLocation = form.location_id ? sites.filter((s) => s.location_id === form.location_id) : []
  const photoCount = photos.length + pendingPhotos.length
  const inputProps = { className: 'input', style: { width: '100%' } }

  function buildPayload() {
    const specs = { ...(asset?.specs || {}) }
    const setSpec = (k, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete specs[k]; else specs[k] = v }
    setSpec('manufacturer', form.manufacturer.trim())
    setSpec('model', form.model.trim())
    setSpec('serial_number', form.serial_number.trim())
    setSpec('install_date', form.install_date || null)
    setSpec('tags', form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : null)
    return {
      ain: form.ain.trim(), name: form.name.trim(),
      site_id: form.site_id || null, category_id: form.category_id || null,
      status: form.status,
      health_score: form.health_score === '' ? null : Number(form.health_score),
      assigned_operator_id: form.assigned_operator_id || null,
      purchase_value_cents: form.value === '' ? null : Math.round(Number(form.value) * 100),
      last_maintenance_at: form.last_maintenance_at || null,
      next_maintenance_at: form.next_maintenance_at || null,
      lat: form.lat === '' ? null : Number(form.lat),
      lng: form.lng === '' ? null : Number(form.lng),
      specs,
    }
  }

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!form.ain.trim() || !form.name.trim() || !form.category_id || !form.location_id || !form.site_id) {
      setErr('AIN, name, type, location and site are all required.'); return
    }
    if (form.value !== '' && isNaN(Number(form.value))) { setErr('Asset value must be a number.'); return }
    if (form.lat !== '' && isNaN(Number(form.lat))) { setErr('Latitude must be a number.'); return }
    if (form.lng !== '' && isNaN(Number(form.lng))) { setErr('Longitude must be a number.'); return }
    setSaving(true)
    try {
      const payload = buildPayload()
      if (editing) {
        await updateAsset(asset.id, payload)
      } else {
        const created = await createAsset(payload)
        for (const f of pendingPhotos) { try { await uploadAssetPhoto(created.id, f) } catch { /* keep going */ } }
        for (const f of pendingDocs) { try { await uploadAssetDocument(created.id, f) } catch { /* keep going */ } }
      }
      onSave()
    } catch (ex) { setErr(ex.message || 'Save failed.'); setSaving(false) }
  }

  async function pickPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return
    if (photoCount >= MAX_PHOTOS) { setErr(`Maximum of ${MAX_PHOTOS} images.`); if (photoRef.current) photoRef.current.value = ''; return }
    if (editing) {
      setBusyFile(true); setErr('')
      try { const up = await uploadAssetPhoto(asset.id, file); setPhotos(up.photos || []) }
      catch (ex) { setErr(ex.message || 'Photo upload failed.') }
      finally { setBusyFile(false); if (photoRef.current) photoRef.current.value = '' }
    } else {
      setPendingPhotos((p) => [...p, file]); if (photoRef.current) photoRef.current.value = ''
    }
  }

  async function pickDoc(e) {
    const file = e.target.files?.[0]; if (!file) return
    if (editing) {
      setBusyFile(true); setErr('')
      try { const up = await uploadAssetDocument(asset.id, file); setDocuments(up.documents || []) }
      catch (ex) { setErr(ex.message || 'Document upload failed.') }
      finally { setBusyFile(false); if (docRef.current) docRef.current.value = '' }
    } else {
      setPendingDocs((p) => [...p, file]); if (docRef.current) docRef.current.value = ''
    }
  }

  async function removeDoc(url) {
    setBusyFile(true)
    try { const up = await deleteAssetDocument(asset.id, url); setDocuments(up.documents || []) }
    catch (ex) { setErr(ex.message) }
    finally { setBusyFile(false) }
  }

  async function removePhoto(url) {
    setBusyFile(true)
    try { const up = await deleteAssetPhoto(asset.id, url); setPhotos(up.photos || []) }
    catch (ex) { setErr(ex.message) }
    finally { setBusyFile(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 620, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 28, zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{editing ? 'Edit Asset' : 'Register New Asset'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Asset name" required full>
            <input {...inputProps} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Compressor Unit X-5" />
          </Field>
          <Field label="AIN" required>
            <input {...inputProps} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} value={form.ain} onChange={(e) => set('ain', e.target.value)} placeholder="e.g. NGML-MTR-0042" />
          </Field>
          <Field label="Asset type" required>
            <select {...inputProps} value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">Select type…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Location" required>
            <select {...inputProps} value={form.location_id} onChange={(e) => setLocation(e.target.value)}>
              <option value="">Select location…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Site" required>
            <select {...inputProps} value={form.site_id} onChange={(e) => set('site_id', e.target.value)} disabled={!form.location_id}>
              <option value="">{!form.location_id ? 'Select a location first' : sitesForLocation.length ? 'Select site…' : 'No sites in this location'}</option>
              {sitesForLocation.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select {...inputProps} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Manufacturer">
            <input {...inputProps} value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} placeholder="e.g. GE" />
          </Field>
          <Field label="Model">
            <input {...inputProps} value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. GCF-700" />
          </Field>
          <Field label="Serial number">
            <input {...inputProps} value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} placeholder="e.g. SN-001" />
          </Field>
          <Field label="Install date">
            <input {...inputProps} type="date" value={form.install_date} onChange={(e) => set('install_date', e.target.value)} />
          </Field>
          <Field label="Asset value (USD)">
            <input {...inputProps} type="number" min={0} value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="e.g. 5000000" />
          </Field>
          <Field label="Assigned operator">
            <select {...inputProps} value={form.assigned_operator_id} onChange={(e) => set('assigned_operator_id', e.target.value)}>
              <option value="">Unassigned</option>
              {operators.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </Field>
          <Field label="Initial health %">
            <input {...inputProps} type="number" min={0} max={100} value={form.health_score} onChange={(e) => set('health_score', e.target.value)} placeholder="e.g. 90" />
          </Field>
          <Field label="Last maintenance date">
            <input {...inputProps} type="date" value={form.last_maintenance_at} onChange={(e) => set('last_maintenance_at', e.target.value)} />
          </Field>
          <Field label="Next maintenance date">
            <input {...inputProps} type="date" value={form.next_maintenance_at} onChange={(e) => set('next_maintenance_at', e.target.value)} />
          </Field>
          <Field label="Tags (comma separated)" full>
            <input {...inputProps} value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="e.g. critical, offshore, production" />
          </Field>
          <Field label="Latitude (optional)">
            <input {...inputProps} value={form.lat} onChange={(e) => set('lat', e.target.value)} placeholder="e.g. 6.4531" />
          </Field>
          <Field label="Longitude (optional)">
            <input {...inputProps} value={form.lng} onChange={(e) => set('lng', e.target.value)} placeholder="e.g. 3.3958" />
          </Field>
        </div>

        {/* Images */}
        <div style={{ marginTop: 18 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 6 }}>Images ({photoCount}/{MAX_PHOTOS}){photos.length > 0 && <span style={{ fontWeight: 400, color: 'var(--n400)' }}> · click to enlarge</span>}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {photos.map((p, i) => (
              <div key={`p${i}`} style={{ position: 'relative', width: 56, height: 56 }}>
                <button type="button" onClick={() => setLightbox({ images: photos, index: i })} title="Click to enlarge" style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', borderRadius: 4, lineHeight: 0 }}>
                  <AuthImage relPath={p} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--n200)', display: 'block' }} />
                </button>
                {editing && (
                  <button type="button" onClick={() => removePhoto(p)} disabled={busyFile} title="Remove image"
                    style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--n200)', background: 'var(--n0)', color: 'var(--srt)', fontSize: 11, lineHeight: '16px', cursor: 'pointer', padding: 0 }}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {pendingPhotos.map((f, i) => (
              <div key={`pp${i}`} style={{ width: 56, height: 56, borderRadius: 4, border: '1px dashed var(--n300)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--n500)', textAlign: 'center', padding: 2, overflow: 'hidden' }}>{f.name.slice(0, 14)}</div>
            ))}
          </div>
          <input ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} disabled={busyFile || photoCount >= MAX_PHOTOS} style={{ fontSize: 12 }} />
        </div>

        {/* Documents / data sheets */}
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 6 }}>Documents / data sheets</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {documents.map((d, i) => (
              <div key={`d${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--n700)' }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {d.name}</span>
                {editing && <button type="button" onClick={() => removeDoc(d.url)} disabled={busyFile} style={{ background: 'none', border: 'none', color: 'var(--srt)', cursor: 'pointer', fontSize: 11 }}>Remove</button>}
              </div>
            ))}
            {pendingDocs.map((f, i) => (
              <div key={`pd${i}`} style={{ fontSize: 12, color: 'var(--n500)' }}>📄 {f.name} <span style={{ fontSize: 10 }}>(uploads on save)</span></div>
            ))}
          </div>
          <input ref={docRef} type="file" onChange={pickDoc} disabled={busyFile} style={{ fontSize: 12 }} />
        </div>

        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 14 }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? .7 : 1 }}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Register asset'}
          </button>
        </div>
      </form>
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}

// ── Raise Work Order Modal ─────────────────────────────────────────────────────
function RaiseWOModal({ asset, onClose, onCreated }) {
  const [form, setForm] = useState({ title: `Work order — ${asset.name}`, description: '', type: 'corrective', priority: 'medium' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const inputProps = { className: 'input', style: { width: '100%' } }

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setErr('Title is required.'); return }
    setSaving(true); setErr('')
    try {
      await createWorkOrder({ title: form.title.trim(), description: form.description || null, type: form.type, priority: form.priority, asset_id: asset.id, site_id: asset.site_id || null, status: 'new' })
      onCreated()
    } catch (ex) { setErr(ex.message || 'Failed to raise work order.'); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 440, maxWidth: '92vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 4 }}>Raise Work Order</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{asset.ain} · {asset.name}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title" required>
            <input {...inputProps} value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} className="input" style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Type">
              <select {...inputProps} value={form.type} onChange={(e) => set('type', e.target.value)}>
                {Object.entries(WO_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select {...inputProps} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {Object.entries(WO_PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
        </div>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Raising…' : 'Raise work order'}</button>
        </div>
      </form>
    </div>
  )
}

// ── CSV Import Modal ───────────────────────────────────────────────────────────
function ImportModal({ onClose, onDone }) {
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
      setResult(await importAssets(rows))
    } catch (ex) { setErr(ex.message || 'Import failed.') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <div style={{ position: 'relative', width: 460, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 6 }}>Import assets from CSV</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 14, lineHeight: 1.6 }}>
          Download the template, fill it in, then upload it. Assets are matched by AIN — existing AINs are skipped. Category, Location and Site are matched by name or code; the Location column disambiguates sites that share a name across locations.
        </p>
        <button onClick={downloadTemplate} className="btn btn-secondary" style={{ height: 34, padding: '0 14px', fontSize: 13, marginBottom: 14 }}>↓ Download template</button>
        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} style={{ fontSize: 12 }} />
          {busy && <span style={{ fontSize: 12, color: 'var(--n500)', marginLeft: 8 }}>Importing…</span>}
        </div>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={() => { if (result) onDone(); onClose() }} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{result ? 'Done' : 'Close'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Asset detail panel ─────────────────────────────────────────────────────────
const PM_STATUS_C = { pending: 'var(--slt)', in_progress: 'var(--sat)', completed: 'var(--sgt)', overdue: 'var(--srt)', skipped: 'var(--n500)' }
const INSP_STATUS_C = { scheduled: 'var(--slt)', due: 'var(--sat)', in_progress: 'var(--sat)', completed: 'var(--sgt)', overdue: 'var(--srt)' }

function AssetDetailPanel({ asset, canEdit, canWO, onEdit, onArchive, onRestore, onRaiseWO, onClose }) {
  const [activity, setActivity] = useState(null)
  const [pmTasks, setPMTasks] = useState(null)
  const [inspections, setInspections] = useState(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [lightbox, setLightbox] = useState(null) // { images, index } | null
  const archived = Boolean(asset.deleted_at)
  const s = asset.specs || {}

  const loadActivity = useCallback(() => {
    listAssetActivity(asset.id).then(setActivity).catch(() => setActivity([]))
  }, [asset.id])

  useEffect(() => {
    let cancelled = false
    setActivity(null); setPMTasks(null); setInspections(null)
    listAssetActivity(asset.id).then((a) => !cancelled && setActivity(a)).catch(() => !cancelled && setActivity([]))
    listPMTasks({ asset_id: asset.id, limit: 20 }).then((t) => !cancelled && setPMTasks(t)).catch(() => !cancelled && setPMTasks([]))
    listInspections({ asset_id: asset.id, limit: 20 }).then((i) => !cancelled && setInspections(i)).catch(() => !cancelled && setInspections([]))
    return () => { cancelled = true }
  }, [asset.id])

  async function postComment() {
    if (!comment.trim()) return
    setPosting(true)
    try { await addAssetComment(asset.id, comment.trim()); setComment(''); loadActivity() }
    catch (ex) { alert(ex.message) } finally { setPosting(false) }
  }

  async function viewDoc(doc) {
    try { await api.download(`/files/${doc.url}`, doc.name) } catch (ex) { alert(ex.message) }
  }

  const section = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginBottom: 8 }

  return (
    <div style={{ width: 360, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{asset.ain}{archived && <span style={{ color: 'var(--n400)' }}> · archived</span>}</div>
          <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{asset.name}</div>
        </div>
        <button onClick={onClose} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={asset.status} />
          {asset.category && <span className="badge badge-n">{asset.category.name}</span>}
          {asset.location && <span className="badge badge-n">📍 {asset.location.name}</span>}
          {asset.site && <span className="badge badge-n">{asset.site.name}</span>}
        </div>

        {/* Health */}
        <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
            <svg viewBox="0 0 64 64" width="64" height="64">
              <circle cx="32" cy="32" r="24" fill="none" stroke="var(--n200)" strokeWidth="7" />
              <circle cx="32" cy="32" r="24" fill="none" stroke={healthColor(asset.health_score)} strokeWidth="7" strokeDasharray={`${150.8 * (asset.health_score ?? 0) / 100} ${150.8}`} strokeLinecap="round" transform="rotate(-90 32 32)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'var(--ff-m)', fontSize: 16, fontWeight: 500 }}>{asset.health_score ?? 0}</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: 'var(--n800)', marginBottom: 4 }}>{healthLabel(asset.health_score)}</div>
            NBV: {formatNBV(asset.nbv_cents)}
          </div>
        </div>

        {/* Details */}
        <div>
          <div style={section}>Details</div>
          <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
            {[
              ['Category', asset.category?.name || '—'],
              ['Location', asset.location?.name || '—'],
              ['Site', asset.site?.name || '—'],
              ['Operator', asset.operator?.full_name || '—'],
              ['Manufacturer', s.manufacturer || '—'],
              ['Model', s.model || '—'],
              ['Serial', s.serial_number || '—'],
              ['Install date', s.install_date ? fmtDate(s.install_date) : '—'],
              ['Asset value', asset.purchase_value_cents != null ? `$${(asset.purchase_value_cents / 100).toLocaleString()}` : '—'],
              ['Coordinates', asset.lat != null && asset.lng != null ? `${asset.lat}, ${asset.lng}` : '—'],
              ['Tags', Array.isArray(s.tags) && s.tags.length ? s.tags.join(', ') : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Maintenance & inspection status */}
        <div>
          <div style={section}>Maintenance status</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--n500)' }}>Last maintenance</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n800)' }}>{fmtDate(asset.last_maintenance_at)}</div>
            </div>
            <div style={{ flex: 1, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--n500)' }}>Next maintenance</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n800)' }}>{fmtDate(asset.next_maintenance_at)}</div>
            </div>
          </div>
          {pmTasks === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : pmTasks.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No PM tasks for this asset.</div>
          ) : pmTasks.slice(0, 8).map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)' }}>
              <span style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                {t.report_url && <button onClick={() => viewDoc({ url: t.report_url, name: t.report_url.split('/').pop() })} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>report</button>}
                <span style={{ color: PM_STATUS_C[t.status] || 'var(--n500)', fontWeight: 500 }}>{t.status}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Inspections */}
        <div>
          <div style={section}>Inspections</div>
          {inspections === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : inspections.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No inspections for this asset.</div>
          ) : inspections.slice(0, 8).map((i) => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)' }}>
              <span style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                {i.report_url && <button onClick={() => viewDoc({ url: i.report_url, name: i.report_url.split('/').pop() })} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>report</button>}
                <span style={{ color: INSP_STATUS_C[i.status] || 'var(--n500)', fontWeight: 500 }}>{i.status}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Documents */}
        {asset.documents?.length > 0 && (
          <div>
            <div style={section}>Documents</div>
            {asset.documents.map((d, i) => (
              <button key={i} onClick={() => viewDoc(d)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'var(--b600)', cursor: 'pointer' }}>📄 {d.name}</button>
            ))}
          </div>
        )}

        {/* Photos */}
        {asset.photos?.length > 0 && (
          <div>
            <div style={section}>Photos <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--n400)' }}>· click to enlarge</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {asset.photos.map((p, i) => (
                <button key={i} type="button" onClick={() => setLightbox({ images: asset.photos, index: i })} title="Click to enlarge" style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', borderRadius: 4, lineHeight: 0 }}>
                  <AuthImage relPath={p} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--n200)', display: 'block' }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Activity feed */}
        <div>
          <div style={section}>Activity</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} placeholder="Add a comment…" className="input" style={{ flex: 1, height: 32, fontSize: 12 }} />
            <button onClick={postComment} disabled={posting || !comment.trim()} className="btn btn-secondary" style={{ height: 32, padding: '0 10px', fontSize: 12 }}>Post</button>
          </div>
          {activity === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : activity.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No activity yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activity.map((ev) => (
                <div key={`${ev.source}-${ev.id}`} style={{ display: 'flex', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: ev.source === 'audit' ? 'var(--n300)' : 'var(--b400)', marginTop: 5, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--n800)' }}>
                      {ev.source === 'audit' ? <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n600)' }}>{ev.kind}</span> : ev.body}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--n400)' }}>{ev.actor?.full_name || 'System'} · {fmtDateTime(ev.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          {archived ? (
            canEdit && <button onClick={onRestore} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Restore asset</button>
          ) : (
            <>
              {canWO && <button onClick={onRaiseWO} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Raise Work Order</button>}
              {canEdit && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button onClick={onEdit} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit Asset</button>
                  <button onClick={onArchive} className="btn btn-danger-soft" style={{ height: 34, fontSize: 13 }}>Archive</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Assets({ dark, toggleDark }) {
  const { roleKey, extraCaps } = useAuth()
  const canCreate = can(roleKey, 'asset:create', extraCaps)
  const canEdit = can(roleKey, 'asset:update', extraCaps)
  const canWO = can(roleKey, 'wo:create', extraCaps)

  const [assets, setAssets] = useState([])
  const [sites, setSites] = useState([])
  const [locations, setLocations] = useState([])
  const [categories, setCategories] = useState([])
  const [operators, setOperators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState(searchParams.get('status') || 'all')
  const [archivedView, setArchivedView] = useState(false)
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)      // null | 'add' | asset (edit)
  const [woAsset, setWoAsset] = useState(null)  // asset for Raise WO
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [a, s, l, c, u] = await Promise.all([
        listAssets({ status: filter, archived: archivedView }), listSites(), listLocations().catch(() => []), listCategories(), listOrgUsers().catch(() => []),
      ])
      setAssets(a); setSites(s); setLocations(l); setCategories(c); setOperators(u)
      setSelected((sel) => (sel ? a.find((x) => x.id === sel.id) || null : null))
    } catch (e) { setError(e.message || 'Failed to load assets.') }
    finally { setLoading(false) }
  }, [filter, archivedView])

  useEffect(() => { load() }, [load])

  const afterSave = async () => { setModal(null); await load() }

  async function archiveAsset(id) {
    if (!confirm('Archive this asset? It will be hidden from the registry but not deleted, and can be restored.')) return
    try { await softDeleteAsset(id); setSelected(null); load() } catch (e) { alert(e.message) }
  }

  async function doRestore(id) {
    try { await restoreAsset(id); load() } catch (e) { alert(e.message) }
  }

  const linkBtn = { padding: '3px 8px', border: '1px solid var(--n200)', borderRadius: 3, background: 'var(--n0)', fontSize: 11, color: 'var(--n600)', cursor: 'pointer' }

  return (
    <div className="app-shell">
      <Sidebar active="assets" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Assets" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Toolbar */}
          <div style={{ padding: '16px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Asset Registry</h1>
              <p style={{ fontSize: 12, color: 'var(--n500)' }}>
                {loading ? 'Loading…' : `${assets.length} ${archivedView ? 'archived ' : ''}assets · ${locations.length} location${locations.length !== 1 ? 's' : ''} · ${sites.length} site${sites.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {[['all', 'All'], ['operational', 'Operational'], ['attention', 'Attention'], ['critical', 'Critical']].map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)} style={{ height: 30, padding: '0 12px', border: `1px solid ${filter === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filter === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: filter === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filter === v ? 500 : 400, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <button onClick={() => { setArchivedView((v) => !v); setSelected(null) }} style={{ height: 30, padding: '0 12px', border: `1px solid ${archivedView ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: archivedView ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: archivedView ? 'var(--b700)' : 'var(--n600)', cursor: 'pointer' }}>
              {archivedView ? '← Active' : 'Archived'}
            </button>
            {canCreate && !archivedView && (
              <>
                <button onClick={() => setImporting(true)} className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 13 }}>Import CSV</button>
                <button onClick={() => setModal('add')} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Add Asset
                </button>
              </>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading assets…</div>
              ) : error ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
                </div>
              ) : assets.length === 0 ? (
                <div style={{ padding: 64, textAlign: 'center' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>{archivedView ? 'No archived assets' : 'No assets yet'}</p>
                  {!archivedView && <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>Add your first asset to start tracking your infrastructure.</p>}
                  {canCreate && !archivedView && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Add first asset</button>}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['AIN', 'Name & Model', 'Type', 'Location', 'Site', 'Status', 'Health', 'Operator', 'Actions'].map((h) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selected?.id === a.id ? 'var(--b50)' : 'transparent' }} onClick={() => setSelected(a)}>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{a.ain}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{a.name}</div>
                          {(a.specs?.manufacturer || a.specs?.model) && <div style={{ fontSize: 11, color: 'var(--n500)' }}>{[a.specs?.manufacturer, a.specs?.model].filter(Boolean).join(' / ')}</div>}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{a.category?.name || '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.location?.name || '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.site?.name || '—'}</td>
                        <td style={{ padding: '11px 14px' }}><StatusBadge status={a.status} /></td>
                        <td style={{ padding: '11px 14px' }}><HealthBar score={a.health_score ?? 0} /></td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.operator?.full_name || '—'}</td>
                        <td style={{ padding: '11px 14px' }} onClick={(e) => e.stopPropagation()}>
                          {archivedView ? (
                            canEdit && <button onClick={() => doRestore(a.id)} style={linkBtn}>Restore</button>
                          ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setSelected(a)} style={linkBtn}>View</button>
                              {canEdit && <button onClick={() => setModal(a)} style={linkBtn}>Edit</button>}
                              {canWO && <button onClick={() => setWoAsset(a)} style={{ ...linkBtn, color: 'var(--b700)', borderColor: 'var(--b200)' }}>WO</button>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {selected && (
              <AssetDetailPanel
                asset={selected}
                canEdit={canEdit}
                canWO={canWO}
                onEdit={() => setModal(selected)}
                onArchive={() => archiveAsset(selected.id)}
                onRestore={() => doRestore(selected.id)}
                onRaiseWO={() => setWoAsset(selected)}
                onClose={() => setSelected(null)}
              />
            )}
          </div>
        </div>
      </div>

      {modal && (
        <AssetModal
          asset={modal === 'add' ? null : modal}
          sites={sites}
          locations={locations}
          categories={categories}
          operators={operators}
          onClose={() => setModal(null)}
          onSave={afterSave}
        />
      )}
      {woAsset && (
        <RaiseWOModal
          asset={woAsset}
          onClose={() => setWoAsset(null)}
          onCreated={() => { setWoAsset(null); load() }}
        />
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={() => load()}
        />
      )}
    </div>
  )
}
