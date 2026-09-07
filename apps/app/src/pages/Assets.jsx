import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import AuthImage from '../components/AuthImage.jsx'
import ImageLightbox from '../components/ImageLightbox.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import {
  listAssets, createAsset, updateAsset, softDeleteAsset, restoreAsset, importAssets,
  uploadAssetPhoto, deleteAssetPhoto, uploadAssetDocument, deleteAssetDocument, listAssetActivity, addAssetComment,
  getAssetHealth,
} from '../lib/db/assets'
import { listSites } from '../lib/db/sites'
import { listLocations } from '../lib/db/locations'
import { listCategories } from '../lib/db/categories'
import { listOrgUsers } from '../lib/db/orgMembers'
import { getOrg } from '../lib/db/org'
import { Money } from '../lib/money'
import { actionLabel } from '../lib/auditLabels.js'
import { createWorkOrder, listWorkOrders, WO_STATUS_LABEL, WO_TYPE_LABEL, WO_PRIORITY_LABEL } from '../lib/db/workOrders'
import { listPMTasks, updatePMTask, uploadMaintenanceReport } from '../lib/db/pmTasks'
import { listInspections, updateInspection } from '../lib/db/inspections'
import { completeMaintenance } from '../lib/db/maintenanceEvents'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { healthColor, healthLabel, healthBand } from '../lib/health'
import { api } from '../lib/apiClient'
import { useToast } from '../lib/ToastContext'
import { useLocationFilter } from '../lib/LocationFilterContext'
import { errorText } from '../lib/errors'

// operational/maintenance/standby/offline describe WHAT the asset is doing
// right now (the new, David-demo-adopted model — TASK-4.2); attention/critical
// are the legacy severity-as-status values kept here ONLY so existing rows
// still render a real badge instead of falling through to the offline
// default. New/edited assets are steered toward the 4-value model by
// STATUS_PICKER_OPTIONS below, not this map.
const STATUS_STYLE = {
  operational: { bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', label: 'Operational' },
  maintenance: { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', label: 'Maintenance' },
  standby:     { bg: 'var(--slb)', c: 'var(--slt)', br: 'var(--slbr)', label: 'Standby' },
  offline:     { bg: 'var(--n100)', c: 'var(--n500)', br: 'var(--n300)', label: 'Offline' },
  // Legacy values (pre-TASK-4.2) — still valid on existing rows.
  critical:    { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', label: 'Critical' },
  attention:   { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', label: 'Attention' },
}

// The set offered on the Add/Edit picker going forward. An asset already
// carrying a legacy status (attention/critical) still shows that as its
// current option too, so opening Edit and saving unrelated fields doesn't
// silently reassign its status.
// `maintenance` is deliberately absent. It's an operational state the system
// derives: a work order moving to in_progress puts its asset under maintenance
// and closing the last one takes it back out (syncAssetStatusForWorkOrder in
// apps/api/src/routes/workOrders.ts). Hand-picking it on a form produced a
// status that immediately disagreed with the work. Still a legal value — the
// spread below keeps it selectable on a row that already has it.
const STATUS_PICKER_KEYS = ['operational', 'standby', 'offline']

// Status values kept legal by 0012 for backwards compatibility but no longer
// written by anything — they described health, which now has its own filter.
const LEGACY_STATUS_KEYS = ['attention', 'critical']
const STATE_FILTERS = [
  ['all', 'All'], ['operational', 'Operational'], ['maintenance', 'Maintenance'],
  ['standby', 'Standby'], ['offline', 'Offline'],
  ['attention', 'Attention'], ['critical', 'Critical'],
]

const MAX_PHOTOS = 5

function AssetStatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.offline
  return <StatusBadge tone={s} size="md" />
}

/**
 * The condition score, with its working shown.
 *
 * The score used to be a linear decay between the maintenance dates, and this
 * panel used to say so. It is now five weighted signals, so showing only the
 * total would swap one unexplained figure for another — every component is
 * listed with its own sub-score and the sentence saying where it came from,
 * including the ones that had no evidence and were left out of the average.
 *
 * There is no manual override to offer: health is derived, and the form that
 * used to accept a typed score was removed on purpose.
 */
function ConditionPanel({ asset }) {
  const [health, setHealth] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHealth(null)
    setErr('')
    getAssetHealth(asset.id)
      .then((h) => { if (!cancelled) setHealth(h) })
      .catch((ex) => { if (!cancelled) setErr(errorText(ex, 'Could not read the score.')) })
    return () => { cancelled = true }
  }, [asset.id])

  const score = asset.health_score
  const scored = health ? health.components.filter((c) => c.score != null).length : null

  return (
    <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle cx="32" cy="32" r="24" fill="none" stroke="var(--n200)" strokeWidth="7" />
            <circle cx="32" cy="32" r="24" fill="none" stroke={healthColor(score)} strokeWidth="7"
              strokeDasharray={`${150.8 * (score ?? 0) / 100} ${150.8}`} strokeLinecap="round" transform="rotate(-90 32 32)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--ff-m)', fontSize: 16, fontWeight: 500 }}>{score ?? '—'}</span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--n800)', marginBottom: 4 }}>{healthLabel(score)}</div>
          <div style={{ fontSize: 11, color: 'var(--n500)' }}>
            {health
              ? `Calculated from ${scored} of ${health.components.length} signals${asset.health_score_computed_at ? `, last on ${fmtDate(asset.health_score_computed_at)}` : ''}.`
              : err || 'Reading the signals…'}
          </div>
        </div>
      </div>

      {health && (
        <>
          <button onClick={() => setOpen((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, cursor: 'pointer', font: 'inherit', fontSize: 11.5, color: 'var(--b600)' }}>
            {open ? 'Hide the working' : 'Show the working'}
          </button>

          {open && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {health.components.map((c) => (
                <div key={c.key} style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 5, padding: '8px 10px', opacity: c.score == null ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--n800)' }}>{c.label}</span>
                    <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11.5, fontWeight: 500, color: c.score == null ? 'var(--n400)' : healthColor(c.score) }}>
                      {c.score == null ? 'no data' : `${c.score}/100`}
                    </span>
                    <span style={{ fontFamily: 'var(--ff-m)', fontSize: 10.5, color: 'var(--n400)', width: 32, textAlign: 'right' }}>{c.weight}%</span>
                  </div>
                  {c.score != null && (
                    <div style={{ height: 4, background: 'var(--n200)', borderRadius: 99, overflow: 'hidden', margin: '6px 0 5px' }}>
                      <div style={{ width: `${c.score}%`, height: '100%', borderRadius: 99, background: healthColor(c.score) }} />
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.5, marginTop: c.score != null ? 0 : 4 }}>{c.detail}</div>
                </div>
              ))}

              {health.weight_applied < 100 && (
                <p style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.5 }}>
                  Scored out of the {health.weight_applied}% of the weighting that had evidence behind it. A signal
                  with nothing to read is left out rather than counted as zero — never inspected is not the same as
                  in poor condition.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
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

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Next-maintenance cell color: red once past due, amber inside the next 14
// days, default text color otherwise — mirrors the overdue/expiring color
// convention already used on Maintenance and Compliance (var(--srt)/var(--sat)).
function nextMaintColor(d) {
  if (!d) return 'var(--n500)'
  const days = Math.floor((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  if (days < 0) return 'var(--srt)'
  if (days < 14) return 'var(--sat)'
  return 'var(--n700)'
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
// health_score is deliberately absent: it's derived from the two maintenance
// dates by recompute_asset_health_for(), so an imported value would be
// overwritten on the very next write. Importers who supplied one were being
// quietly ignored.
const CSV_HEADERS = ['ain', 'name', 'category', 'location', 'site', 'status', 'manufacturer', 'model', 'serial_number', 'install_date', 'purchase_date', 'runtime_hours', 'value', 'last_maintenance_date', 'next_maintenance_date', 'tags', 'lat', 'lng']

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadTemplate() {
  const example = ['AST-001', 'Compressor Unit X-5', 'Compressor', 'Lagos', 'Lagos DS-04', 'operational', 'GE', 'GCF-700', 'SN-001', '2023-01-15', '2022-11-01', '18240', '5000000', '90', '2025-06-01', '2025-12-01', 'critical,offshore', '6.45', '3.4']
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
const DEPRECIATION_LABEL = {
  straight_line: 'Straight-line',
  declining_balance: 'Declining balance',
  none: 'Not depreciated',
}

function AssetModal({ asset, sites, locations, categories, operators, allAssets = [], orgDepreciation = null, onClose, onSave }) {
  const toast = useToast()
  const editing = Boolean(asset)
  const s0 = asset?.specs || {}
  // An asset stores only its site; its location is the site's location. Seed the
  // Location picker from the current site so editing shows the right zone.
  const initialSite = asset?.site_id ? sites.find((s) => s.id === asset.site_id) : null
  const [form, setForm] = useState({
    ain: asset?.ain || '', name: asset?.name || '',
    location_id: initialSite?.location_id || '',
    site_id: asset?.site_id || '', category_id: asset?.category_id || '',
    status: asset?.status || 'operational',
    manufacturer: s0.manufacturer || '', model: s0.model || '', serial_number: s0.serial_number || '',
    install_date: asset?.install_date ? String(asset.install_date).slice(0, 10) : (s0.install_date || ''),
    runtime_hours: s0.runtime_hours != null ? String(s0.runtime_hours) : '',
    purchase_date: asset?.purchase_date ? String(asset.purchase_date).slice(0, 10) : (s0.purchase_date || ''),
    tags: Array.isArray(s0.tags) ? s0.tags.join(', ') : (s0.tags || ''),
    assigned_operator_id: asset?.assigned_operator_id || '',
    value: asset?.purchase_value_cents != null ? String(asset.purchase_value_cents / 100) : '',
    // Depreciation overrides — empty string means "inherit the org default",
    // which is what the API stores as null.
    depreciation_method: asset?.depreciation_method || '',
    useful_life_years: asset?.useful_life_years != null ? String(asset.useful_life_years) : '',
    salvage_value: asset?.salvage_value_cents != null ? String(asset.salvage_value_cents / 100) : '',
    declining_rate_pct: asset?.declining_rate_pct != null ? String(asset.declining_rate_pct) : '',
    parent_asset_id: asset?.parent_asset_id || '',
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
  // Which method is actually in force, so the rate field only appears when it
  // means something.
  const effectiveMethod = form.depreciation_method || orgDepreciation?.method || 'straight_line'
  // An asset can't be its own parent. Deeper cycles are rejected server-side by
  // the FK graph rather than guessed at here.
  const parentOptions = allAssets.filter((a) => a.id !== asset?.id)
  const photoCount = photos.length + pendingPhotos.length
  const inputProps = { className: 'input', style: { width: '100%' } }

  function buildPayload() {
    const specs = { ...(asset?.specs || {}) }
    const setSpec = (k, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete specs[k]; else specs[k] = v }
    setSpec('manufacturer', form.manufacturer.trim())
    setSpec('model', form.model.trim())
    setSpec('serial_number', form.serial_number.trim())
    setSpec('runtime_hours', form.runtime_hours === '' ? null : Math.max(0, Math.round(Number(form.runtime_hours))))
    // install_date/purchase_date were `specs` jsonb keys until 0015 promoted
    // them to real date columns — depreciation can't be computed off untyped
    // free text. Clear the legacy keys so the column is the only source.
    setSpec('install_date', null)
    setSpec('purchase_date', null)
    setSpec('tags', form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : null)
    return {
      ain: form.ain.trim(), name: form.name.trim(),
      site_id: form.site_id || null, category_id: form.category_id || null,
      install_date: form.install_date || null,
      purchase_date: form.purchase_date || null,
      status: form.status,
      assigned_operator_id: form.assigned_operator_id || null,
      purchase_value_cents: form.value === '' ? null : Math.round(Number(form.value) * 100),
      parent_asset_id: form.parent_asset_id || null,
      depreciation_method: form.depreciation_method || null,
      useful_life_years: form.useful_life_years === '' ? null : Number(form.useful_life_years),
      salvage_value_cents: form.salvage_value === '' ? null : Math.round(Number(form.salvage_value) * 100),
      declining_rate_pct: form.declining_rate_pct === '' ? null : Number(form.declining_rate_pct),
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
    // Maintenance dates are mandatory — without both, the asset is excluded
    // from the daily health-decay job and would never decay or alert.
    if (!form.last_maintenance_at || !form.next_maintenance_at) {
      setErr('Last and next maintenance dates are required — they drive the health decay schedule.'); return
    }
    if (form.next_maintenance_at <= form.last_maintenance_at) {
      setErr('Next maintenance date must be after the last maintenance date.'); return
    }
    if (form.value !== '' && isNaN(Number(form.value))) { setErr('Asset value must be a number.'); return }
    if (form.lat !== '' && isNaN(Number(form.lat))) { setErr('Latitude must be a number.'); return }
    if (form.lng !== '' && isNaN(Number(form.lng))) { setErr('Longitude must be a number.'); return }
    if (form.runtime_hours !== '' && (isNaN(Number(form.runtime_hours)) || Number(form.runtime_hours) < 0)) { setErr('Runtime hours must be a non-negative number.'); return }
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
      toast.success(editing ? 'Asset updated.' : 'Asset created.')
      onSave()
    } catch (ex) { setErr(errorText(ex, 'Save failed.')); setSaving(false) }
  }

  async function pickPhoto(e) {
    const file = e.target.files?.[0]; if (!file) return
    if (photoCount >= MAX_PHOTOS) { setErr(`Maximum of ${MAX_PHOTOS} images.`); if (photoRef.current) photoRef.current.value = ''; return }
    if (editing) {
      setBusyFile(true); setErr('')
      try { const up = await uploadAssetPhoto(asset.id, file); setPhotos(up.photos || []) }
      catch (ex) { setErr(errorText(ex, 'Photo upload failed.')) }
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
      catch (ex) { setErr(errorText(ex, 'Document upload failed.')) }
      finally { setBusyFile(false); if (docRef.current) docRef.current.value = '' }
    } else {
      setPendingDocs((p) => [...p, file]); if (docRef.current) docRef.current.value = ''
    }
  }

  async function removeDoc(url) {
    setBusyFile(true)
    try { const up = await deleteAssetDocument(asset.id, url); setDocuments(up.documents || []) }
    catch (ex) { setErr(errorText(ex)) }
    finally { setBusyFile(false) }
  }

  async function removePhoto(url) {
    setBusyFile(true)
    try { const up = await deleteAssetPhoto(asset.id, url); setPhotos(up.photos || []) }
    catch (ex) { setErr(errorText(ex)) }
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

        <div className="form-grid" style={{ gap: 12 }}>
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
              {[...new Set([...STATUS_PICKER_KEYS, form.status])].map((k) => (
                <option key={k} value={k}>{STATUS_STYLE[k]?.label || k}</option>
              ))}
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
          <Field label="Purchase date">
            <input {...inputProps} type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
          </Field>
          <Field label="Runtime (hours)">
            <input {...inputProps} type="number" min="0" step="1" value={form.runtime_hours} onChange={(e) => set('runtime_hours', e.target.value)} placeholder="e.g. 18240" />
          </Field>
          <Field label="Asset value (₦)">
            <input {...inputProps} type="number" min={0} value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="e.g. 5000000" />
          </Field>
          <Field label="Assigned operator">
            <select {...inputProps} value={form.assigned_operator_id} onChange={(e) => set('assigned_operator_id', e.target.value)}>
              <option value="">Unassigned</option>
              {operators.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          </Field>
          <Field label="Last maintenance date" required>
            <input {...inputProps} type="date" value={form.last_maintenance_at} onChange={(e) => set('last_maintenance_at', e.target.value)} />
          </Field>
          <Field label="Next maintenance date" required>
            <input {...inputProps} type="date" value={form.next_maintenance_at} onChange={(e) => set('next_maintenance_at', e.target.value)} />
          </Field>
          <Field label="Depreciation method" full>
            <select {...inputProps} value={form.depreciation_method} onChange={(e) => set('depreciation_method', e.target.value)}>
              <option value="">Organisation default{orgDepreciation ? ` (${DEPRECIATION_LABEL[orgDepreciation.method] || 'Straight-line'})` : ''}</option>
              {Object.entries(DEPRECIATION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Useful life (years)">
            <input {...inputProps} type="number" min="0" step="0.5" value={form.useful_life_years}
              onChange={(e) => set('useful_life_years', e.target.value)}
              placeholder={orgDepreciation?.usefulLifeYears != null ? `Default ${orgDepreciation.usefulLifeYears}` : 'Default 10'} />
          </Field>
          <Field label="Salvage value (₦)">
            <input {...inputProps} type="number" min="0" value={form.salvage_value}
              onChange={(e) => set('salvage_value', e.target.value)}
              placeholder={orgDepreciation?.salvageRatePct ? `Default ${orgDepreciation.salvageRatePct}% of value` : 'Default 0'} />
          </Field>
          {effectiveMethod === 'declining_balance' && (
            <Field label="Declining rate (% per year)">
              <input {...inputProps} type="number" min="0.1" max="99.9" step="0.1" value={form.declining_rate_pct}
                onChange={(e) => set('declining_rate_pct', e.target.value)}
                placeholder={orgDepreciation?.decliningRatePct != null ? `Default ${orgDepreciation.decliningRatePct}` : 'Default 20'} />
            </Field>
          )}
          <Field label="Parent asset" full>
            <select {...inputProps} value={form.parent_asset_id} onChange={(e) => set('parent_asset_id', e.target.value)}>
              <option value="">None — top-level asset</option>
              {parentOptions.map((a) => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
            </select>
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
                    style={{ position: 'absolute', top: -8, right: -8, width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--n200)', background: 'var(--n0)', color: 'var(--srt)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
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
function RaiseWOModal({ asset, users = [], onClose, onCreated }) {
  const toast = useToast()
  const { roleKey, extraCaps } = useAuth()
  // The Work Orders page has always been able to assign at creation; this
  // asset-context path couldn't, so a WO raised from the asset it concerns
  // always landed unassigned and needed a second trip to route it.
  const canAssign = can(roleKey, 'wo:assign', extraCaps)
  const [form, setForm] = useState({ title: `Work order — ${asset.name}`, description: '', type: 'corrective', priority: 'medium', assignee_id: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const inputProps = { className: 'input', style: { width: '100%' } }

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setErr('Title is required.'); return }
    setSaving(true); setErr('')
    try {
      const assigneeId = canAssign ? (form.assignee_id || null) : null
      const wo = await createWorkOrder({
        title: form.title.trim(), description: form.description || null,
        type: form.type, priority: form.priority,
        asset_id: asset.id, site_id: asset.site_id || null,
        assignee_id: assigneeId,
        // Mirrors NewWOModal: assigning at creation means it's already assigned.
        status: assigneeId ? 'assigned' : 'new',
      })
      toast.success(`Work order ${wo.ref} created.`)
      onCreated()
    } catch (ex) { setErr(errorText(ex, 'Failed to raise work order.')); setSaving(false) }
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
          <div className="form-grid" style={{ gap: 12 }}>
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
          {canAssign && (
            <Field label="Assign to">
              <select {...inputProps} value={form.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </Field>
          )}
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

// ── Complete Maintenance Modal ───────────────────────────────────────────────────
function localDateStr(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD in the browser's local timezone
}

function CompleteMaintenanceModal({ asset, onClose, onCompleted }) {
  const toast = useToast()
  const [pmTasks, setPMTasks] = useState([])
  const [workOrders, setWorkOrders] = useState([])
  const [form, setForm] = useState({
    link: '', // '' | `pm:<id>` | `wo:<id>`
    completed_at: localDateStr(0),
    next_maintenance_at: localDateStr(90),
    notes: '',
  })
  const [report, setReport] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))
  const inputProps = { className: 'input', style: { width: '100%' } }

  useEffect(() => {
    let cancelled = false
    listPMTasks({ asset_id: asset.id, statuses: ['pending', 'in_progress'], limit: 20 }).then((t) => !cancelled && setPMTasks(t)).catch(() => {})
    listWorkOrders({}).then((w) => !cancelled && setWorkOrders(w.filter((x) => x.asset_id === asset.id && x.status !== 'closed'))).catch(() => {})
    return () => { cancelled = true }
  }, [asset.id])

  async function submit(e) {
    e.preventDefault()
    if (form.next_maintenance_at <= form.completed_at) { setErr('Next maintenance date must be after the completion date.'); return }
    setSaving(true); setErr('')
    try {
      const [linkKind, linkId] = form.link ? form.link.split(':') : [null, null]
      await completeMaintenance(asset.id, {
        source: linkKind === 'pm' ? 'pm_task' : linkKind === 'wo' ? 'work_order' : 'manual',
        pm_task_id: linkKind === 'pm' ? linkId : null,
        work_order_id: linkKind === 'wo' ? linkId : null,
        completed_at: form.completed_at,
        next_maintenance_at: form.next_maintenance_at,
        notes: form.notes.trim() || null,
        report: report || undefined,
      })
      toast.success('Maintenance completed — health reset to 100%.')
      onCompleted()
    } catch (ex) { setErr(errorText(ex, 'Failed to record maintenance completion.')); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 460, maxWidth: '92vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 4 }}>Complete Maintenance</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{asset.ain} · {asset.name} — resets health to 100% and schedules the next maintenance date.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(pmTasks.length > 0 || workOrders.length > 0) && (
            <Field label="Linked to (optional)">
              <select {...inputProps} value={form.link} onChange={(e) => set('link', e.target.value)}>
                <option value="">None — manual completion</option>
                {pmTasks.map((t) => <option key={`pm:${t.id}`} value={`pm:${t.id}`}>PM task: {t.title}</option>)}
                {workOrders.map((w) => <option key={`wo:${w.id}`} value={`wo:${w.id}`}>Work order: {w.ref} — {w.title}</option>)}
              </select>
            </Field>
          )}
          <div className="form-grid" style={{ gap: 12 }}>
            <Field label="Completed on" required>
              <input {...inputProps} type="date" max={localDateStr(0)} value={form.completed_at} onChange={(e) => set('completed_at', e.target.value)} />
            </Field>
            <Field label="Next maintenance due" required>
              <input {...inputProps} type="date" min={form.completed_at} value={form.next_maintenance_at} onChange={(e) => set('next_maintenance_at', e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="input" style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }} placeholder="What was done…" />
          </Field>
          <Field label="Report (optional)">
            <input type="file" onChange={(e) => setReport(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </Field>
        </div>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Complete maintenance'}</button>
        </div>
      </form>
    </div>
  )
}

// ── PM Task Complete Modal ──────────────────────────────────────────────────────
// Selecting "completed" from the inline status select on a PM task (asset
// detail panel) opens this instead of PATCHing status directly — otherwise
// a task could be marked completed (resetting the asset's health via
// apply_asset_health) with no record of what was done or a report attached.
function PMTaskCompleteModal({ task, onClose, onCompleted }) {
  const toast = useToast()
  const [completedAt, setCompletedAt] = useState(localDateStr(0))
  const [notes, setNotes] = useState('')
  const [report, setReport] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      await updatePMTask(task.id, { status: 'completed', completed_at: completedAt, notes: notes.trim() || null })
      if (report) await uploadMaintenanceReport(task.id, report)
      toast.success('PM task completed — health reset to 100%.')
      onCompleted()
    } catch (ex) { setErr(errorText(ex, 'Failed to complete task.')); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 420, maxWidth: '92vw', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 4 }}>Complete PM Task</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 16 }}>{task.title} — resets the asset's health to 100% and advances the maintenance schedule.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Completed on" required>
            <input className="input" style={{ width: '100%' }} type="date" max={localDateStr(0)} value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input" style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }} placeholder="What was done…" />
          </Field>
          <Field label="Report (optional)">
            <input type="file" onChange={(e) => setReport(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </Field>
        </div>
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : 'Complete task'}</button>
        </div>
      </form>
    </div>
  )
}

// ── CSV Import Modal ───────────────────────────────────────────────────────────
function ImportModal({ onClose, onDone }) {
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <div style={{ position: 'relative', width: 460, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 6 }}>Import assets from CSV</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 14, lineHeight: 1.6 }}>
          Download the template, fill it in, then upload it. Assets are matched by AIN — existing AINs are skipped. Category, Location and Site are matched by name or code; the Location column disambiguates sites that share a name across locations. Last and next maintenance dates are required per row (they drive the health decay schedule).
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
const PRIORITY_C = { low: 'var(--sgt)', medium: 'var(--n600)', high: 'var(--sat)', critical: 'var(--srt)' }
// Activity-feed dot color by asset_activity.kind — lets a maintenance
// completion or health alert read at a glance without opening every entry.
const ACTIVITY_DOT_C = { maintenance: 'var(--sgt)', alert: 'var(--srt)', inspection: 'var(--sat)', comment: 'var(--b400)', status_change: 'var(--b400)', attachment: 'var(--b400)' }

function AssetDetailPanel({ asset, canEdit, canWO, canCompleteMaintenance, onEdit, onArchive, onRestore, onRaiseWO, onCompleteMaintenance, onClose, refreshToken, allAssets = [], orgDepreciation = null }) {
  const nav = useNavigate()
  const toast = useToast()
  const { roleKey, extraCaps } = useAuth()
  const canUpdatePM = can(roleKey, 'pm:update', extraCaps)
  const canUpdateInspection = can(roleKey, 'inspection:update', extraCaps)
  const [activity, setActivity] = useState(null)
  const [pmTasks, setPMTasks] = useState(null)
  const [inspections, setInspections] = useState(null)
  const [workOrders, setWorkOrders] = useState(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [lightbox, setLightbox] = useState(null) // { images, index } | null
  const [completingTask, setCompletingTask] = useState(null) // pm_task being completed via the confirm modal
  const archived = Boolean(asset.deleted_at)
  const s = asset.specs || {}

  const loadActivity = useCallback(() => {
    listAssetActivity(asset.id).then(setActivity).catch(() => setActivity([]))
  }, [asset.id])

  const loadPMTasks = useCallback(() => {
    listPMTasks({ asset_id: asset.id, limit: 20 }).then(setPMTasks).catch(() => setPMTasks([]))
  }, [asset.id])

  const loadInspections = useCallback(() => {
    listInspections({ asset_id: asset.id, limit: 20 }).then(setInspections).catch(() => setInspections([]))
  }, [asset.id])

  useEffect(() => {
    let cancelled = false
    setActivity(null); setPMTasks(null); setInspections(null); setWorkOrders(null)
    listAssetActivity(asset.id).then((a) => !cancelled && setActivity(a)).catch(() => !cancelled && setActivity([]))
    listPMTasks({ asset_id: asset.id, limit: 20 }).then((t) => !cancelled && setPMTasks(t)).catch(() => !cancelled && setPMTasks([]))
    listInspections({ asset_id: asset.id, limit: 20 }).then((i) => !cancelled && setInspections(i)).catch(() => !cancelled && setInspections([]))
    listWorkOrders({ asset_id: asset.id }).then((w) => !cancelled && setWorkOrders(w)).catch(() => !cancelled && setWorkOrders([]))
    return () => { cancelled = true }
    // refreshToken bumps after actions taken elsewhere (e.g. Complete
    // Maintenance) that change this asset's PM tasks/activity but don't
    // change asset.id, so the effect wouldn't otherwise refire.
  }, [asset.id, refreshToken])

  async function changePMStatus(task, newStatus) {
    if (newStatus === 'completed') { setCompletingTask(task); return }
    try { await updatePMTask(task.id, { status: newStatus }); loadPMTasks(); toast.success('PM task status updated.') }
    catch (ex) { toast.error(errorText(ex, 'Failed to update PM task status.')) }
  }

  async function changeInspectionStatus(inspection, newStatus) {
    try { await updateInspection(inspection.id, { status: newStatus }); loadInspections(); toast.success('Inspection status updated.') }
    catch (ex) { toast.error(errorText(ex, 'Failed to update inspection status.')) }
  }

  async function postComment() {
    if (!comment.trim()) return
    setPosting(true)
    try { await addAssetComment(asset.id, comment.trim()); setComment(''); loadActivity() }
    catch (ex) { toast.error(errorText(ex, 'Failed to post comment.')) } finally { setPosting(false) }
  }

  async function viewDoc(doc) {
    try { await api.download(`/files/${doc.url}`, doc.name) } catch (ex) { toast.error(errorText(ex, 'Failed to download file.')) }
  }

  const section = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginBottom: 8 }

  return (
    <div className="detail-panel" style={{ '--panel-w': '360px', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{asset.ain}{archived && <span style={{ color: 'var(--n400)' }}> · archived</span>}</div>
          <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{asset.name}</div>
        </div>
        <button onClick={onClose} className="row-action" style={{ width: 40, height: 40, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', color: 'var(--n500)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <AssetStatusBadge status={asset.status} />
          {asset.category && <span className="badge badge-n">{asset.category.name}</span>}
          {asset.location && <span className="badge badge-n">📍 {asset.location.name}</span>}
          {asset.site && <span className="badge badge-n">{asset.site.name}</span>}
        </div>

        <ConditionPanel asset={asset} />

        {/* Financials */}
        <div>
          <div style={section}>Financials</div>
          <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
            {[
              // <Money> rather than a bare formatter: these read the org's
              // configured currency and carry the second one beside them, the
              // same as every other figure in the app.
              ['Purchase value', <Money key="pv" cents={asset.purchase_value_cents} full />],
              ['Book value (NBV)', <Money key="nbv" cents={asset.nbv_cents} full />],
              ['Accumulated depreciation', <Money key="acc" cents={asset.accumulated_depreciation_cents} full />],
              ['Method', DEPRECIATION_LABEL[asset.depreciation_method] || `${DEPRECIATION_LABEL[orgDepreciation?.method] || 'Straight-line'} (org default)`],
              ['In service', asset.install_date || asset.purchase_date ? fmtDate(asset.install_date || asset.purchase_date) : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                {/* minWidth:0 so a long figure with its converted amount beside
                    it wraps inside the panel instead of running off the edge. */}
                <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right', minWidth: 0 }}>{v}</span>
              </div>
            ))}
          </div>
          {asset.nbv_cents == null && (
            // A null book value is "we can't work this out", not "it's worth
            // nothing" — say which, rather than rendering a confident ₦0.
            <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 6 }}>
              Add a purchase value and an install or purchase date to calculate book value.
            </div>
          )}
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
              ['Install date', asset.install_date ? fmtDate(asset.install_date) : '—'],
              ['Purchase date', asset.purchase_date ? fmtDate(asset.purchase_date) : '—'],
              ['Runtime', s.runtime_hours != null ? `${Number(s.runtime_hours).toLocaleString()} hrs` : '—'],
              ['Parent asset', asset.parent_asset_id ? (allAssets.find((a) => a.id === asset.parent_asset_id)?.ain || 'Linked') : '—'],
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
                {canUpdatePM && t.status !== 'completed' ? (
                  <select value={t.status} onChange={(e) => changePMStatus(t, e.target.value)} className="select" style={{ fontSize: 11, fontWeight: 500, color: PM_STATUS_C[t.status] || 'var(--n500)', background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 3, padding: '1px 4px' }}>
                    {Object.keys(PM_STATUS_C).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                ) : (
                  <span style={{ color: PM_STATUS_C[t.status] || 'var(--n500)', fontWeight: 500 }}>{t.status}</span>
                )}
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
            <div key={i.id} style={{ padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                <span style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                  {i.report_url && <button onClick={() => viewDoc({ url: i.report_url, name: i.report_url.split('/').pop() })} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>report</button>}
                  {canUpdateInspection ? (
                    <select value={i.status} onChange={(e) => changeInspectionStatus(i, e.target.value)} className="select" style={{ fontSize: 11, fontWeight: 500, color: INSP_STATUS_C[i.status] || 'var(--n500)', background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 3, padding: '1px 4px' }}>
                      {Object.keys(INSP_STATUS_C).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  ) : (
                    <span style={{ color: INSP_STATUS_C[i.status] || 'var(--n500)', fontWeight: 500 }}>{i.status}</span>
                  )}
                </span>
              </div>
              {i.inspector?.full_name && <div style={{ fontSize: 10, color: 'var(--n400)', marginTop: 2 }}>Inspector: {i.inspector.full_name} · {fmtDate(i.scheduled_date)}</div>}
            </div>
          ))}
        </div>

        {/* Related work orders */}
        <div>
          <div style={section}>Work Orders</div>
          {workOrders === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : workOrders.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No work orders for this asset.</div>
          ) : workOrders.slice(0, 8).map((w) => {
            // Deep link, not a bare /work-orders — landing on an unfiltered
            // list and hunting for the row you just clicked isn't navigation.
            const openWO = () => nav(`/work-orders?id=${w.id}`)
            return (
              <div key={w.id} role="button" tabIndex={0} onClick={openWO} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openWO() }}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{w.ref}</span>
                  <span style={{ color: PRIORITY_C[w.priority] || 'var(--n500)', fontWeight: 500, fontSize: 11 }}>{WO_PRIORITY_LABEL[w.priority] || w.priority}</span>
                </div>
                <div style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
                {/* Who's on it and when it was raised — the API has returned
                    both since day one; only this row left them out. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: 'var(--n400)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {WO_STATUS_LABEL[w.status] || w.status} · {w.assignee?.full_name || 'Unassigned'}
                    {w.assigner?.full_name ? ` (by ${w.assigner.full_name})` : ''}
                  </span>
                  <span style={{ flexShrink: 0 }}>
                    Raised {fmtDate(w.created_at)}{w.sla_due ? ` · Due ${fmtDate(w.sla_due)}` : ''}
                  </span>
                </div>
              </div>
            )
          })}
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
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: ev.source === 'audit' ? 'var(--n300)' : (ACTIVITY_DOT_C[ev.kind] || 'var(--b400)'), marginTop: 5, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--n800)' }}>
                      {/* Audit rows used to render the raw action string in
                          grey monospace, sitting right beside human sentences
                          from asset_activity. Same label map the Admin audit
                          tab uses. */}
                      {ev.source === 'audit' ? <span style={{ fontSize: 12, color: 'var(--n600)' }}>{actionLabel(ev.kind)}</span> : ev.body}
                    </div>
                    {ev.attachments?.length > 0 && (
                      <div style={{ marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {ev.attachments.map((a, i) => (
                          <button key={i} onClick={() => viewDoc(a)} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>📎 {a.name || 'attachment'}</button>
                        ))}
                      </div>
                    )}
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
              {canCompleteMaintenance && <button onClick={onCompleteMaintenance} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Complete Maintenance</button>}
              {canWO && <button onClick={onRaiseWO} className="btn btn-secondary" style={{ width: '100%', height: 36, fontSize: 13 }}>Raise Work Order</button>}
              {canEdit && (
                <div className="form-grid" style={{ gap: 8 }}>
                  <button onClick={onEdit} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit Asset</button>
                  <button onClick={onArchive} className="btn btn-danger-soft" style={{ height: 34, fontSize: 13 }}>Archive</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
      {completingTask && (
        <PMTaskCompleteModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onCompleted={() => { setCompletingTask(null); loadPMTasks() }}
        />
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Assets({ dark, toggleDark }) {
  const toast = useToast()
  const { locationId: globalLocationId, setLocationId: setGlobalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)
  const { roleKey, extraCaps } = useAuth()
  const canCreate = can(roleKey, 'asset:create', extraCaps)
  const canEdit = can(roleKey, 'asset:update', extraCaps)
  const canWO = can(roleKey, 'wo:create', extraCaps)
  const canCompleteMaintenance = can(roleKey, 'maintenance:complete', extraCaps)

  const [assets, setAssets] = useState([])
  const [sites, setSites] = useState([])
  const [locations, setLocations] = useState([])
  const [categories, setCategories] = useState([])
  const [operators, setOperators] = useState([])
  // Org-wide depreciation policy (Admin -> Configuration). Used to show what an
  // asset inherits when it has no override of its own.
  const [orgDepreciation, setOrgDepreciation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState(searchParams.get('status') || 'all')
  // Health-band drill-down from the dashboard donut (?health=good|attention|critical).
  // Client-side, unlike the status filter: health_score isn't indexed/filterable
  // server-side today and the asset list is small enough per-org that this is fine.
  const [healthFilter, setHealthFilter] = useState(searchParams.get('health') || '')
  const [archivedView, setArchivedView] = useState(false)
  // On-page search/Type/Location filters compose with the server-side status
  // filter above — all client-side over the already-loaded list, since a
  // single org's asset count is bounded and this avoids new API round trips.
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)      // null | 'add' | asset (edit)
  const [woAsset, setWoAsset] = useState(null)  // asset for Raise WO
  const [completingAsset, setCompletingAsset] = useState(null)  // asset for Complete Maintenance
  const [detailRefreshToken, setDetailRefreshToken] = useState(0)  // bump to force the open detail panel's activity/PM/inspection lists to refetch
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [a, s, l, c, u, org] = await Promise.all([
        listAssets({ status: filter, archived: archivedView, locationId: globalLocationId }), listSites(), listLocations().catch(() => []), listCategories(), listOrgUsers().catch(() => []),
        getOrg().catch(() => null),
      ])
      setAssets(a); setSites(s); setLocations(l); setCategories(c); setOperators(u)
      setOrgDepreciation(org?.settings?.depreciation || null)
      setSelected((sel) => (sel ? a.find((x) => x.id === sel.id) || null : null))
    } catch (e) { setError(errorText(e, 'Failed to load assets.')) }
    finally { setLoading(false) }
  }, [filter, archivedView, globalLocationId])

  useEffect(() => { load() }, [load])

  // ?id=<uuid> — a notification deep-linking to a specific asset. Opens its
  // detail panel and clears any filter that would hide the row.
  const deepLinkId = searchParams.get('id')
  useEffect(() => {
    if (!deepLinkId || !assets.length) return
    const target = assets.find((a) => a.id === deepLinkId)
    if (!target) return
    setHealthFilter(''); setTypeFilter(''); setLocationFilter(''); setSearch('')
    setSelected(target)
  }, [deepLinkId, assets])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250)
    return () => clearTimeout(t)
  }, [search])

  const afterSave = async () => { setModal(null); await load() }

  async function archiveAsset(id) {
    if (!confirm('Archive this asset? It will be hidden from the registry but not deleted, and can be restored.')) return
    try { await softDeleteAsset(id); setSelected(null); load(); toast.success('Asset archived.') }
    catch (e) { toast.error(errorText(e, 'Failed to archive asset.')) }
  }

  async function doRestore(id) {
    try { await restoreAsset(id); load(); toast.success('Asset restored.') }
    catch (e) { toast.error(errorText(e, 'Failed to restore asset.')) }
  }

  const linkBtn = { padding: '3px 8px', border: '1px solid var(--n200)', borderRadius: 3, background: 'var(--n0)', fontSize: 11, color: 'var(--n600)', cursor: 'pointer' }
  // Only render the legacy status pills while rows still carry those values.
  const hasLegacyStatus = assets.some((a) => LEGACY_STATUS_KEYS.includes(a.status))
  const visibleAssets = assets.filter((a) => {
    if (healthFilter && healthBand(a.health_score) !== healthFilter) return false
    if (typeFilter && a.category_id !== typeFilter) return false
    if (!globalLocationId && locationFilter && a.location?.id !== locationFilter) return false
    if (debouncedSearch) {
      const haystack = [a.name, a.ain, a.specs?.manufacturer, a.specs?.model].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(debouncedSearch)) return false
    }
    return true
  })

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
                {loading ? 'Loading…' : `${visibleAssets.length} ${archivedView ? 'archived ' : ''}asset${visibleAssets.length !== 1 ? 's' : ''} · ${locations.length} location${locations.length !== 1 ? 's' : ''} · ${sites.length} site${sites.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <div style={{ flex: 1 }} />
            {/* Two orthogonal axes, previously mixed into one row of seven
                pills. operational/maintenance/standby/offline describe what an
                asset is DOING; attention/critical are legacy values describing
                how HEALTHY it is — a dimension the health control beside this
                one already covers properly. The legacy two only appear while
                rows still carry them (0012 kept them valid but nothing writes
                them any more), so they disappear from a clean database instead
                of sitting there always returning nothing. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n400)', fontFamily: 'var(--ff-m)' }}>State</span>
              {STATE_FILTERS.filter(([v]) => !LEGACY_STATUS_KEYS.includes(v) || hasLegacyStatus || filter === v).map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)} className="filter-pill" style={{ height: 30, padding: '0 12px', border: `1px solid ${filter === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filter === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: filter === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filter === v ? 500 : 400, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n400)', fontFamily: 'var(--ff-m)' }}>Health</span>
              {[['', 'Any'], ['good', 'Healthy'], ['attention', 'Needs attention'], ['critical', 'Critical']].map(([v, l]) => (
                <button key={v || 'any'} onClick={() => setHealthFilter(v)} className="filter-pill" style={{ height: 30, padding: '0 12px', border: `1px solid ${healthFilter === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: healthFilter === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: healthFilter === v ? 'var(--b700)' : 'var(--n600)', fontWeight: healthFilter === v ? 500 : 400, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <button onClick={() => { setArchivedView((v) => !v); setSelected(null) }} className="filter-pill" style={{ height: 30, padding: '0 12px', border: `1px solid ${archivedView ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: archivedView ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: archivedView ? 'var(--b700)' : 'var(--n600)', cursor: 'pointer' }}>
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

          {/* Search + Type/Location filter bar */}
          <div style={{ padding: '10px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <circle cx="6" cy="6" r="5" stroke="var(--n400)" strokeWidth="1.4" />
                <path d="M9.8 9.8L13 13" stroke="var(--n400)" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, AIN, manufacturer, model…"
                style={{ height: 30, width: '100%', padding: '0 10px 0 30px', border: '1px solid var(--n200)', borderRadius: 4, fontSize: 12, background: 'var(--n0)', color: 'var(--n900)', outline: 'none' }}
              />
            </div>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="select" style={{ height: 30, padding: '0 10px', border: '1px solid var(--n200)', borderRadius: 4, fontSize: 12, background: 'var(--n0)', color: 'var(--n700)' }}>
              <option value="">All types</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {/* Subordinate to the topbar's global location switcher (EPIC-2)
                — once a global location is active, this per-page picker
                would be redundant (and could contradict it), so it's hidden
                rather than shown alongside. */}
            {!globalLocationId && (
              <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="select" style={{ height: 30, padding: '0 10px', border: '1px solid var(--n200)', borderRadius: 4, fontSize: 12, background: 'var(--n0)', color: 'var(--n700)' }}>
                <option value="">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            {(search || typeFilter || (locationFilter && !globalLocationId)) && (
              <button onClick={() => { setSearch(''); setTypeFilter(''); setLocationFilter('') }} style={{ height: 30, padding: '0 10px', border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', fontSize: 12, color: 'var(--n500)', cursor: 'pointer' }}>
                Clear
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <div className="table-scroll" style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading assets…</div>
              ) : error ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
                </div>
              ) : visibleAssets.length === 0 ? (
                <div style={{ padding: 64, textAlign: 'center' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                    {globalLocation ? `No assets in ${globalLocation.name}` : healthFilter || debouncedSearch || typeFilter || locationFilter ? 'No assets match these filters' : archivedView ? 'No archived assets' : 'No assets yet'}
                  </p>
                  {globalLocation && (
                    <button onClick={() => setGlobalLocationId(null)} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13, marginTop: 4 }}>Show all locations</button>
                  )}
                  {!archivedView && !healthFilter && !debouncedSearch && !typeFilter && !locationFilter && <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>Add your first asset to start tracking your infrastructure.</p>}
                  {canCreate && !archivedView && !healthFilter && !debouncedSearch && !typeFilter && !locationFilter && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Add first asset</button>}
                </div>
              ) : (
                <>
                  <table className="table-view-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                      <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                        {['AIN', 'Name & Model', 'Type', 'Location', 'Site', 'Status', 'Health', 'Next Maint.', 'Operator', 'Actions'].map((h) => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAssets.map((a) => (
                        <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selected?.id === a.id ? 'var(--b50)' : 'transparent' }} onClick={() => setSelected(a)}>
                          <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{a.ain}</td>
                          <td style={{ padding: '11px 14px' }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{a.name}</div>
                            {(a.specs?.manufacturer || a.specs?.model) && <div style={{ fontSize: 11, color: 'var(--n500)' }}>{[a.specs?.manufacturer, a.specs?.model].filter(Boolean).join(' / ')}</div>}
                          </td>
                          <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{a.category?.name || '—'}</td>
                          <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.location?.name || '—'}</td>
                          <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.site?.name || '—'}</td>
                          <td style={{ padding: '11px 14px' }}><AssetStatusBadge status={a.status} /></td>
                          <td style={{ padding: '11px 14px' }}><HealthBar score={a.health_score ?? 0} /></td>
                          <td style={{ padding: '11px 14px', fontSize: 12, whiteSpace: 'nowrap', color: nextMaintColor(a.next_maintenance_at) }}>{fmtDate(a.next_maintenance_at)}</td>
                          <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.operator?.full_name || '—'}</td>
                          <td style={{ padding: '11px 14px' }} onClick={(e) => e.stopPropagation()}>
                            {archivedView ? (
                              canEdit && <button onClick={() => doRestore(a.id)} className="row-action" style={linkBtn}>Restore</button>
                            ) : (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => setSelected(a)} className="row-action" style={linkBtn}>View</button>
                                {canEdit && <button onClick={() => setModal(a)} className="row-action" style={linkBtn}>Edit</button>}
                                {canWO && <button onClick={() => setWoAsset(a)} className="row-action" style={{ ...linkBtn, color: 'var(--b700)', borderColor: 'var(--b200)' }}>WO</button>}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Mobile card list — same data, tap opens the full-screen detail panel */}
                  <div className="card-list">
                    {visibleAssets.map((a) => (
                      <div key={a.id} className="list-card" onClick={() => setSelected(a)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                          <AssetStatusBadge status={a.status} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 8 }}>
                          <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--b700)' }}>{a.ain}</span>
                          {a.category?.name && <> · {a.category.name}</>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--n600)', marginBottom: 8 }}>
                          {[a.location?.name, a.site?.name].filter(Boolean).join(' · ') || '—'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <HealthBar score={a.health_score ?? 0} />
                          <span style={{ fontSize: 11, whiteSpace: 'nowrap', color: nextMaintColor(a.next_maintenance_at) }}>{fmtDate(a.next_maintenance_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {selected && (
              <AssetDetailPanel
                allAssets={assets}
                orgDepreciation={orgDepreciation}
                asset={selected}
                canEdit={canEdit}
                canWO={canWO}
                canCompleteMaintenance={canCompleteMaintenance}
                onEdit={() => setModal(selected)}
                onArchive={() => archiveAsset(selected.id)}
                onRestore={() => doRestore(selected.id)}
                onRaiseWO={() => setWoAsset(selected)}
                onCompleteMaintenance={() => setCompletingAsset(selected)}
                onClose={() => setSelected(null)}
                refreshToken={detailRefreshToken}
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
          allAssets={assets}
          orgDepreciation={orgDepreciation}
          onClose={() => setModal(null)}
          onSave={afterSave}
        />
      )}
      {woAsset && (
        <RaiseWOModal
          asset={woAsset}
          users={operators}
          onClose={() => setWoAsset(null)}
          onCreated={() => { setWoAsset(null); load() }}
        />
      )}
      {completingAsset && (
        <CompleteMaintenanceModal
          asset={completingAsset}
          onClose={() => setCompletingAsset(null)}
          onCompleted={() => { setCompletingAsset(null); setDetailRefreshToken((n) => n + 1); load() }}
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
