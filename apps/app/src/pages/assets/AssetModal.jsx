import { useState, useRef } from 'react'
import AuthImage from '../../components/AuthImage.jsx'
import ImageLightbox from '../../components/ImageLightbox.jsx'
import { createAsset, updateAsset, uploadAssetPhoto, deleteAssetPhoto, uploadAssetDocument, deleteAssetDocument } from '../../lib/db/assets'
import { useMoney } from '../../lib/money'
import { ASSET_STATUS, ASSET_DEPRECIATION_METHOD, labelOf } from '../../lib/domain'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { STATUS_PICKER_KEYS, MAX_PHOTOS, Field } from './assetBits.jsx'

// ── Add / Edit Asset Modal ────────────────────────────────────────────────────
// Picker order: the methods, then opting out.
const DEPRECIATION_PICKER = ['straight_line', 'declining_balance', 'sum_of_years_digits', 'none']

export function AssetModal({ asset, sites, locations, categories, operators, allAssets = [], orgDepreciation = null, onClose, onSave }) {
  const { symbol } = useMoney()
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
        // The asset exists now, so a failed file does not undo it; it is
        // counted and reported instead of dropped without a word.
        let failed = 0
        for (const f of pendingPhotos) { try { await uploadAssetPhoto(created.id, f) } catch { failed++ } }
        for (const f of pendingDocs) { try { await uploadAssetDocument(created.id, f) } catch { failed++ } }
        if (failed) {
          toast.error(`Asset created. ${failed} file${failed === 1 ? '' : 's'} could not be attached; open the asset to try again.`)
          onSave()
          return
        }
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
                <option key={k} value={k}>{labelOf(ASSET_STATUS, k)}</option>
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
          <Field label={`Asset value (${symbol})`}>
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
              <option value="">Organisation default{orgDepreciation ? ` (${labelOf(ASSET_DEPRECIATION_METHOD, orgDepreciation.method)})` : ''}</option>
              {DEPRECIATION_PICKER.map((k) => <option key={k} value={k}>{labelOf(ASSET_DEPRECIATION_METHOD, k)}</option>)}
            </select>
          </Field>
          <Field label="Useful life (years)">
            <input {...inputProps} type="number" min="0" step="0.5" value={form.useful_life_years}
              onChange={(e) => set('useful_life_years', e.target.value)}
              placeholder={orgDepreciation?.usefulLifeYears != null ? `Default ${orgDepreciation.usefulLifeYears}` : 'Default 10'} />
          </Field>
          <Field label={`Salvage value (${symbol})`}>
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
