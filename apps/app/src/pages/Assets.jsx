import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import AuthImage from '../components/AuthImage.jsx'
import DocumentsPanel from '../components/DocumentsPanel.jsx'
import ImportAssetsDialog from '../components/ImportAssetsDialog.jsx'
import { AssetQrCode, PrintQrSheet } from '../components/AssetQr.jsx'
import {
  listAssets, createAsset, updateAsset, softDeleteAsset, restoreAsset, uploadAssetPhoto,
} from '../lib/db/assets'
import { listSites } from '../lib/db/sites'
import { listCategories } from '../lib/db/categories'
import { listOrgMembers } from '../lib/db/orgMembers'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'

// `status` is condition; `lifecycle_status` is where the asset is in its life.
// They are separate axes — an in-service asset can be critical.
const STATUS_STYLE = {
  critical:    { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', label: 'Critical' },
  attention:   { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', label: 'Attention' },
  operational: { bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', label: 'Operational' },
  offline:     { bg: 'var(--n100)', c: 'var(--n500)', br: 'var(--n300)', label: 'Offline' },
}

const LIFECYCLE = [
  ['planned', 'Planned'],
  ['in_service', 'In service'],
  ['standby', 'Standby'],
  ['under_maintenance', 'Under maintenance'],
  ['in_storage', 'In storage'],
  ['disposed', 'Disposed'],
]
const LIFECYCLE_LABEL = Object.fromEntries(LIFECYCLE)

const CRITICALITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']]
const CRITICALITY_CLASS = { critical: 'badge-r', high: 'badge-a', medium: 'badge-b', low: 'badge-n' }

const DEPRECIATION_METHODS = [
  ['straight_line', 'Straight line'],
  ['declining_balance', 'Declining balance'],
  ['sum_of_years_digits', "Sum of years' digits"],
  ['units_of_production', 'Units of production'],
]

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.offline
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 2, padding: '2px 7px', fontSize: 11, fontWeight: 500, border: '1px solid', background: s.bg, color: s.c, borderColor: s.br, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function HealthBar({ score }) {
  if (score == null) return <span style={{ fontSize: 11, color: 'var(--n400)' }}>Not set</span>
  const color = score < 40 ? 'var(--sr)' : score < 70 ? 'var(--sa)' : 'var(--sg)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 5, background: 'var(--n200)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', width: 28 }}>{score}</span>
    </div>
  )
}

function formatNaira(cents) {
  if (cents === null || cents === undefined || cents === '') return '—'
  const n = Number(cents) / 100
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`
  return `₦${n.toLocaleString()}`
}

function warrantyState(date) {
  if (!date) return null
  const days = Math.round((new Date(`${date}T00:00:00`) - new Date()) / 86_400_000)
  if (days < 0) return { label: 'Warranty expired', cls: 'badge-r' }
  if (days <= 60) return { label: `Warranty ends in ${days}d`, cls: 'badge-a' }
  return null
}

// ── Add / Edit Asset ──────────────────────────────────────────────────────────
function Section({ title, children, cols = 2 }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginBottom: 10, paddingBottom: 6, borderBottom: 'var(--bdr)' }}>
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>{children}</div>
    </div>
  )
}

function Field({ label, children, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="label" style={{ display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const EMPTY_FORM = {
  ain: '', name: '', site_id: '', category_id: '', status: 'operational',
  lifecycle_status: 'in_service', criticality: 'medium', health_score: '',
  manufacturer: '', model: '', serial_number: '', supplier: '',
  purchase_date: '', commission_date: '', warranty_expiry: '',
  purchase_value_naira: '', salvage_value_naira: '', useful_life_years: '',
  depreciation_method: '', custodian_id: '', tags: '', notes: '', lat: '', lng: '',
}

function toForm(asset) {
  if (!asset) return { ...EMPTY_FORM }
  return {
    ain: asset.ain ?? '',
    name: asset.name ?? '',
    site_id: asset.site_id ?? '',
    category_id: asset.category_id ?? '',
    status: asset.status ?? 'operational',
    lifecycle_status: asset.lifecycle_status ?? 'in_service',
    criticality: asset.criticality ?? 'medium',
    health_score: asset.health_score ?? '',
    manufacturer: asset.manufacturer ?? '',
    model: asset.model ?? '',
    serial_number: asset.serial_number ?? '',
    supplier: asset.supplier ?? '',
    purchase_date: asset.purchase_date ?? '',
    commission_date: asset.commission_date ?? '',
    warranty_expiry: asset.warranty_expiry ?? '',
    purchase_value_naira: asset.purchase_value_cents != null ? String(Number(asset.purchase_value_cents) / 100) : '',
    salvage_value_naira: asset.salvage_value_cents != null ? String(Number(asset.salvage_value_cents) / 100) : '',
    useful_life_years: asset.useful_life_years ?? '',
    depreciation_method: asset.depreciation_method ?? '',
    custodian_id: asset.custodian_id ?? '',
    tags: (asset.tags ?? []).join(', '),
    notes: asset.notes ?? '',
    lat: asset.lat ?? '',
    lng: asset.lng ?? '',
  }
}

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const textOrNull = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())

function AssetModal({ asset, sites, categories, members, onClose, onSave }) {
  const [form, setForm] = useState(() => toForm(asset))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  // Picking a category pulls in its depreciation defaults, but never overwrites
  // a figure the user has already typed.
  function pickCategory(id) {
    const cat = categories.find((c) => c.id === id)
    setForm((p) => ({
      ...p,
      category_id: id,
      depreciation_method: p.depreciation_method || cat?.depreciation_method || '',
      useful_life_years: p.useful_life_years !== '' ? p.useful_life_years : (cat?.useful_life_years ?? ''),
    }))
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.ain.trim() || !form.name.trim()) { setErr('AIN and asset name are required.'); return }
    setSaving(true)
    const payload = {
      ain: form.ain.trim(),
      name: form.name.trim(),
      site_id: form.site_id || null,
      category_id: form.category_id || null,
      status: form.status,
      lifecycle_status: form.lifecycle_status,
      criticality: form.criticality,
      health_score: numOrNull(form.health_score),
      manufacturer: textOrNull(form.manufacturer),
      model: textOrNull(form.model),
      serial_number: textOrNull(form.serial_number),
      supplier: textOrNull(form.supplier),
      purchase_date: form.purchase_date || null,
      commission_date: form.commission_date || null,
      warranty_expiry: form.warranty_expiry || null,
      purchase_value_cents: form.purchase_value_naira === '' ? null : Math.round(Number(form.purchase_value_naira) * 100),
      salvage_value_cents: form.salvage_value_naira === '' ? null : Math.round(Number(form.salvage_value_naira) * 100),
      useful_life_years: numOrNull(form.useful_life_years),
      depreciation_method: form.depreciation_method || null,
      custodian_id: form.custodian_id || null,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: textOrNull(form.notes),
      lat: numOrNull(form.lat),
      lng: numOrNull(form.lng),
    }
    try {
      if (asset) await updateAsset(asset.id, payload)
      else await createAsset(payload)
      onSave()
    } catch (ex) {
      setErr(ex.message || 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 640, maxHeight: '90vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{asset ? 'Edit asset' : 'Add asset'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <Section title="Identity">
            <Field label="AIN *">
              <input className="input" value={form.ain} onChange={(e) => set('ain', e.target.value)} placeholder="NGML-MTR-0042" style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </Field>
            <Field label="Serial number">
              <input className="input" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </Field>
            <Field label="Asset name *" span={2}>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Lagos DS-04 Metering Station" style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Classification">
            <Field label="Category">
              <select className="input" value={form.category_id} onChange={(e) => pickCategory(e.target.value)} style={{ width: '100%' }}>
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Site">
              <select className="input" value={form.site_id} onChange={(e) => set('site_id', e.target.value)} style={{ width: '100%' }}>
                <option value="">None</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Criticality">
              <select className="input" value={form.criticality} onChange={(e) => set('criticality', e.target.value)} style={{ width: '100%' }}>
                {CRITICALITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Lifecycle stage">
              <select className="input" value={form.lifecycle_status} onChange={(e) => set('lifecycle_status', e.target.value)} style={{ width: '100%' }}>
                {LIFECYCLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Condition">
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)} style={{ width: '100%' }}>
                {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Condition score (0–100, entered by hand)">
              <input className="input" type="number" min={0} max={100} value={form.health_score} onChange={(e) => set('health_score', e.target.value)} placeholder="Leave blank if unknown" style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Nameplate">
            <Field label="Manufacturer">
              <input className="input" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label="Model">
              <input className="input" value={form.model} onChange={(e) => set('model', e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label="Supplier" span={2}>
              <input className="input" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Lifecycle dates" cols={3}>
            <Field label="Purchased">
              <input className="input" type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label="Commissioned">
              <input className="input" type="date" value={form.commission_date} onChange={(e) => set('commission_date', e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label="Warranty expires">
              <input className="input" type="date" value={form.warranty_expiry} onChange={(e) => set('warranty_expiry', e.target.value)} style={{ width: '100%' }} />
            </Field>
          </Section>

          <Section title="Depreciation basis">
            <Field label="Purchase value (₦)">
              <input className="input" type="number" min={0} step="0.01" value={form.purchase_value_naira} onChange={(e) => set('purchase_value_naira', e.target.value)} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </Field>
            <Field label="Salvage value (₦)">
              <input className="input" type="number" min={0} step="0.01" value={form.salvage_value_naira} onChange={(e) => set('salvage_value_naira', e.target.value)} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </Field>
            <Field label="Useful life (years)">
              <input className="input" type="number" min={0} step="0.5" value={form.useful_life_years} onChange={(e) => set('useful_life_years', e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label="Method">
              <select className="input" value={form.depreciation_method} onChange={(e) => set('depreciation_method', e.target.value)} style={{ width: '100%' }}>
                <option value="">Not set</option>
                {DEPRECIATION_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <p style={{ gridColumn: 'span 2', fontSize: 11.5, color: 'var(--n500)', margin: 0 }}>
              These feed the asset&rsquo;s depreciation schedule. Once a schedule is posted, net book value comes from it
              instead of being entered by hand.
            </p>
          </Section>

          <Section title="Ownership &amp; location">
            <Field label="Custodian">
              <select className="input" value={form.custodian_id} onChange={(e) => set('custodian_id', e.target.value)} style={{ width: '100%' }}>
                <option value="">Unassigned</option>
                {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
              </select>
            </Field>
            <Field label="Tags (comma separated)">
              <input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="rotating, gas, skid-a" style={{ width: '100%' }} />
            </Field>
            <Field label="Latitude">
              <input className="input" type="number" step="any" value={form.lat} onChange={(e) => set('lat', e.target.value)} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </Field>
            <Field label="Longitude">
              <input className="input" type="number" step="any" value={form.lng} onChange={(e) => set('lng', e.target.value)} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </Field>
            <Field label="Notes" span={2}>
              <textarea className="input" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} />
            </Field>
          </Section>

          {err && <p style={{ fontSize: 12, color: 'var(--srt)' }}>{err}</p>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function DetailRow({ k, v, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
      <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
      <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right', fontFamily: mono ? 'var(--ff-m)' : 'inherit' }}>{v ?? '—'}</span>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Assets({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const canCreate = can(roleKey, 'asset:create')
  const canEdit = can(roleKey, 'asset:update')

  const [assets, setAssets] = useState([])
  const [sites, setSites] = useState([])
  const [categories, setCategories] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null)
  const [importing, setImporting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)

  const [filters, setFilters] = useState({
    status: 'all', criticality: 'all', lifecycle_status: 'all',
    site_id: 'all', category_id: 'all', q: '', archived: false,
  })
  const setFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = { ...filters }
      if (!query.archived) delete query.archived
      const [a, s, c, m] = await Promise.all([
        listAssets(query),
        listSites(),
        listCategories(),
        listOrgMembers().catch(() => []), // viewer roles may not read the member list
      ])
      setAssets(a)
      setSites(s)
      setCategories(c)
      setMembers(m)
      // Keep the open detail panel in sync with freshly loaded rows.
      setSelected((cur) => (cur ? a.find((x) => x.id === cur.id) ?? null : null))
    } catch (e) {
      setError(e.message || 'Failed to load assets.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  // Deep link from /scan — select the scanned asset once the list arrives.
  const deepAin = params.get('ain')
  useEffect(() => {
    if (!deepAin || loading) return
    const hit = assets.find((a) => a.ain.toLowerCase() === deepAin.toLowerCase())
    if (hit) {
      setSelected(hit)
      params.delete('ain')
      setParams(params, { replace: true })
    }
  }, [deepAin, loading, assets, params, setParams])

  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([k, v]) => k !== 'q' && k !== 'archived' && v !== 'all').length
      + (filters.q ? 1 : 0) + (filters.archived ? 1 : 0),
    [filters]
  )

  async function archive(id) {
    if (!confirm('Archive this asset? It stays in the database and can be restored.')) return
    try { await softDeleteAsset(id); setSelected(null); load() }
    catch (e) { alert(e.message) }
  }

  async function unarchive(id) {
    try { await restoreAsset(id); load() }
    catch (e) { alert(e.message) }
  }

  async function addPhoto(e) {
    const file = e.target.files?.[0]
    if (!file || !selected) return
    setPhotoBusy(true)
    try { await uploadAssetPhoto(selected.id, file); await load() }
    catch (ex) { alert(ex.message) }
    finally { setPhotoBusy(false); e.target.value = '' }
  }

  const warranty = selected ? warrantyState(selected.warranty_expiry) : null

  return (
    <div className="app-shell">
      <Sidebar active="assets" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Assets" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Toolbar */}
          <div style={{ padding: '16px 24px 12px', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Asset Registry</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>
                  {loading ? 'Loading…' : `${assets.length} asset${assets.length === 1 ? '' : 's'}${activeFilterCount ? ' matching filters' : ''} · ${sites.length} site${sites.length === 1 ? '' : 's'}`}
                </p>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => nav('/scan')} className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3M3 12h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                Scan
              </button>
              {assets.length > 0 && (
                <button onClick={() => setPrinting(true)} className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 12.5 }}>Print labels</button>
              )}
              {canCreate && (
                <button onClick={() => setImporting(true)} className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 12.5 }}>Import CSV</button>
              )}
              {canCreate && (
                <button onClick={() => setModal('add')} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Add Asset
                </button>
              )}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                className="input"
                value={filters.q}
                onChange={(e) => setFilter('q', e.target.value)}
                placeholder="Search AIN, name or serial…"
                style={{ height: 30, fontSize: 12, width: 230 }}
              />
              <select className="input" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} style={{ height: 30, fontSize: 12, width: 132 }}>
                <option value="all">All conditions</option>
                {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select className="input" value={filters.criticality} onChange={(e) => setFilter('criticality', e.target.value)} style={{ height: 30, fontSize: 12, width: 140 }}>
                <option value="all">All criticalities</option>
                {CRITICALITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className="input" value={filters.lifecycle_status} onChange={(e) => setFilter('lifecycle_status', e.target.value)} style={{ height: 30, fontSize: 12, width: 152 }}>
                <option value="all">All lifecycle stages</option>
                {LIFECYCLE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className="input" value={filters.site_id} onChange={(e) => setFilter('site_id', e.target.value)} style={{ height: 30, fontSize: 12, width: 130 }}>
                <option value="all">All sites</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="input" value={filters.category_id} onChange={(e) => setFilter('category_id', e.target.value)} style={{ height: 30, fontSize: 12, width: 140 }}>
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--n600)', cursor: 'pointer' }}>
                <input type="checkbox" checked={filters.archived} onChange={(e) => { setSelected(null); setFilter('archived', e.target.checked) }} />
                Archived
              </label>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setSelected(null); setFilters({ status: 'all', criticality: 'all', lifecycle_status: 'all', site_id: 'all', category_id: 'all', q: '', archived: false }) }}
                  style={{ background: 'none', border: 'none', color: 'var(--b600)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                >
                  Clear filters
                </button>
              )}
            </div>
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
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 16px' }}><rect x="6" y="8" width="28" height="26" rx="3" stroke="var(--n300)" strokeWidth="1.5" /><path d="M13 16h14M13 21h14M13 26h8" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                    {activeFilterCount ? 'No assets match these filters' : 'No assets yet'}
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>
                    {activeFilterCount ? 'Try widening the search.' : 'Add one by hand, or import your existing register from a spreadsheet.'}
                  </p>
                  {canCreate && !activeFilterCount && (
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Add first asset</button>
                      <button onClick={() => setImporting(true)} className="btn btn-secondary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Import CSV</button>
                    </div>
                  )}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['AIN', 'Asset Name', 'Category', 'Site', 'Criticality', 'Condition', 'Score', 'NBV', ''].map((h) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((a) => (
                      <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selected?.id === a.id ? 'var(--b50)' : 'transparent' }} onClick={() => { setSelected(a); setShowQr(false) }}>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{a.ain}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{a.name}</div>
                          {(a.manufacturer || a.model) && (
                            <div style={{ fontSize: 11, color: 'var(--n500)' }}>{[a.manufacturer, a.model].filter(Boolean).join(' ')}</div>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{a.category?.name || '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.site?.name || '—'}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <span className={`badge ${CRITICALITY_CLASS[a.criticality] || 'badge-n'}`} style={{ textTransform: 'capitalize' }}>{a.criticality}</span>
                        </td>
                        <td style={{ padding: '11px 14px' }}><StatusBadge status={a.status} /></td>
                        <td style={{ padding: '11px 14px' }}><HealthBar score={a.health_score} /></td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{formatNaira(a.nbv_cents)}</td>
                        <td style={{ padding: '11px 14px' }}>
                          {canEdit && !filters.archived && (
                            <button onClick={(e) => { e.stopPropagation(); setModal(a) }} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 4 }}>
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor" /><circle cx="7" cy="7" r="1" fill="currentColor" /><circle cx="7" cy="11" r="1" fill="currentColor" /></svg>
                            </button>
                          )}
                          {canEdit && filters.archived && (
                            <button onClick={(e) => { e.stopPropagation(); unarchive(a.id) }} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Restore</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Detail panel */}
            {selected && (
              <div style={{ width: 360, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{selected.ain}</div>
                    <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{selected.name}</div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge status={selected.status} />
                    <span className={`badge ${CRITICALITY_CLASS[selected.criticality] || 'badge-n'}`} style={{ textTransform: 'capitalize' }}>{selected.criticality}</span>
                    <span className="badge badge-n">{LIFECYCLE_LABEL[selected.lifecycle_status] || selected.lifecycle_status}</span>
                    {warranty && <span className={`badge ${warranty.cls}`}>{warranty.label}</span>}
                  </div>

                  {selected.tags?.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {selected.tags.map((t) => (
                        <span key={t} style={{ fontSize: 11, fontFamily: 'var(--ff-m)', color: 'var(--n600)', background: 'var(--n100)', border: '1px solid var(--n200)', borderRadius: 3, padding: '1px 6px' }}>{t}</span>
                      ))}
                    </div>
                  )}

                  {/* Condition score — stated as entered, not derived. */}
                  <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', marginBottom: 10, fontFamily: 'var(--ff-m)' }}>Condition score</div>
                    {selected.health_score == null ? (
                      <p style={{ fontSize: 12, color: 'var(--n500)' }}>Not recorded. Edit the asset to enter one.</p>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                          <svg viewBox="0 0 64 64" width="64" height="64">
                            <circle cx="32" cy="32" r="24" fill="none" stroke="var(--n200)" strokeWidth="7" />
                            <circle cx="32" cy="32" r="24" fill="none" stroke={selected.health_score < 40 ? 'var(--sr)' : selected.health_score < 70 ? 'var(--sa)' : 'var(--sg)'} strokeWidth="7" strokeDasharray={`${(150.8 * selected.health_score) / 100} ${150.8}`} strokeLinecap="round" transform="rotate(-90 32 32)" />
                          </svg>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontFamily: 'var(--ff-m)', fontSize: 16, fontWeight: 500 }}>{selected.health_score}</span>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.55 }}>
                          <div style={{ fontWeight: 600, color: 'var(--n800)', marginBottom: 3 }}>
                            {selected.health_score < 40 ? 'Poor condition' : selected.health_score < 70 ? 'Fair condition' : 'Good condition'}
                          </div>
                          Entered by hand
                          {selected.health_score_source === 'computed' ? ' — now maintained automatically' : ' — not calculated from inspections yet'}.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Asset tag */}
                  <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                    <button
                      onClick={() => setShowQr((v) => !v)}
                      style={{ width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', font: 'inherit' }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Asset tag</span>
                      <span style={{ fontSize: 11.5, color: 'var(--b600)' }}>{showQr ? 'Hide' : 'Show QR'}</span>
                    </button>
                    {showQr && (
                      <div style={{ padding: '4px 14px 14px', textAlign: 'center' }}>
                        <AssetQrCode ain={selected.ain} size={128} />
                        <button onClick={() => setPrinting(true)} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12, marginTop: 10 }}>Print labels</button>
                      </div>
                    )}
                  </div>

                  <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Details</div>
                    <DetailRow k="Category" v={selected.category?.name} />
                    <DetailRow k="Site" v={selected.site?.name} />
                    <DetailRow k="Custodian" v={selected.custodian?.full_name} />
                    <DetailRow k="Manufacturer" v={[selected.manufacturer, selected.model].filter(Boolean).join(' ') || null} />
                    <DetailRow k="Serial number" v={selected.serial_number} mono />
                    <DetailRow k="Supplier" v={selected.supplier} />
                    <DetailRow k="Purchased" v={selected.purchase_date} mono />
                    <DetailRow k="Commissioned" v={selected.commission_date} mono />
                    <DetailRow k="Warranty expires" v={selected.warranty_expiry} mono />
                    <DetailRow k="Purchase value" v={formatNaira(selected.purchase_value_cents)} mono />
                    <DetailRow
                      k={selected.nbv_source === 'schedule' ? 'NBV (from schedule)' : 'NBV (entered)'}
                      v={formatNaira(selected.nbv_cents)}
                      mono
                    />
                    <DetailRow k="Useful life" v={selected.useful_life_years ? `${selected.useful_life_years} years` : null} />
                    <DetailRow k="Parent asset" v={selected.parent_asset?.ain} mono />
                  </div>

                  {selected.notes && (
                    <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--n700)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      {selected.notes}
                    </div>
                  )}

                  {/* Photos */}
                  <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Photos</div>
                    <div style={{ padding: 14 }}>
                      {selected.photos?.length > 0 ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: canEdit ? 10 : 0 }}>
                          {selected.photos.map((p, i) => (
                            <AuthImage key={i} relPath={p} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--n200)' }} />
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 12, color: 'var(--n400)', marginBottom: canEdit ? 10 : 0 }}>No photos yet.</p>
                      )}
                      {canEdit && (
                        <>
                          <input type="file" accept="image/*" onChange={addPhoto} disabled={photoBusy} style={{ fontSize: 11 }} />
                          {photoBusy && <span style={{ fontSize: 11, color: 'var(--n500)', marginLeft: 8 }}>Uploading…</span>}
                        </>
                      )}
                    </div>
                  </div>

                  <DocumentsPanel parent={{ asset_id: selected.id }} canEdit={canEdit} compact />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
                    {selected.deleted_at ? (
                      canEdit && <button onClick={() => unarchive(selected.id)} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Restore asset</button>
                    ) : canEdit && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <button onClick={() => setModal(selected)} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit asset</button>
                        <button onClick={() => archive(selected.id)} style={{ height: 34, fontSize: 13, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Archive</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <AssetModal
          asset={modal === 'add' ? null : modal}
          sites={sites}
          categories={categories}
          members={members}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
      {importing && <ImportAssetsDialog onClose={() => setImporting(false)} onDone={load} />}
      {printing && (
        <PrintQrSheet
          assets={selected && showQr ? [selected] : assets}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  )
}
