import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import {
  listSpareParts, getSparePart, getPartStats, listPartCategories,
  createSparePart, updateSparePart, archiveSparePart, adjustStock,
  linkPartToAsset, unlinkPartFromAsset, MOVEMENT_KINDS, MOVEMENT_LABEL,
} from '../lib/db/spareParts'
import { listAssets } from '../lib/db/assets'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'
import { useMoney, Money } from '../lib/money'
import { errorText } from '../lib/errors'


// Stock is numeric so consumables can be issued in litres — but 13.00 reads
// worse than 13 for the common whole-unit case.
function qty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function StockCell({ part }) {
  const out = Number(part.quantity_in_stock) <= 0
  const color = out ? 'var(--srt)' : part.is_low ? 'var(--sat)' : 'var(--n800)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 12, fontWeight: 500, color }}>
        {qty(part.quantity_in_stock)} {part.unit}
      </span>
      {out ? <span className="badge badge-r">Out of stock</span>
        : part.is_low ? <span className="badge badge-a">Reorder</span> : null}
    </span>
  )
}

function Stat({ label, value, tone }) {
  const color = tone === 'warn' ? 'var(--sat)' : tone === 'bad' ? 'var(--srt)' : 'var(--n900)'
  return (
    <div style={{ padding: '12px 16px', borderRight: 'var(--bdr)', flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--ff-m)', fontSize: 20, fontWeight: 500, color }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

// ── Create / edit ─────────────────────────────────────────────────────────────
const EMPTY = {
  part_number: '', name: '', description: '', category: '', unit: 'each',
  unit_cost_naira: '', reorder_level: '', reorder_quantity: '',
  supplier: '', storage_location: '', notes: '', opening_stock: '',
}

function PartModal({ part, onClose, onSave }) {
  const [form, setForm] = useState(() => part ? {
    part_number: part.part_number, name: part.name, description: part.description ?? '',
    category: part.category ?? '', unit: part.unit,
    unit_cost_naira: part.unit_cost_cents != null ? String(Number(part.unit_cost_cents) / 100) : '',
    reorder_level: part.reorder_level ?? '', reorder_quantity: part.reorder_quantity ?? '',
    supplier: part.supplier ?? '', storage_location: part.storage_location ?? '',
    notes: part.notes ?? '', opening_stock: '',
  } : { ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!form.part_number.trim() || !form.name.trim()) { setErr('Part number and name are required.'); return }
    setSaving(true)
    const payload = {
      part_number: form.part_number.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      category: form.category.trim() || null,
      unit: form.unit.trim() || 'each',
      unit_cost_cents: form.unit_cost_naira === '' ? 0 : Math.round(Number(form.unit_cost_naira) * 100),
      reorder_level: form.reorder_level === '' ? 0 : Number(form.reorder_level),
      reorder_quantity: form.reorder_quantity === '' ? null : Number(form.reorder_quantity),
      supplier: form.supplier.trim() || null,
      storage_location: form.storage_location.trim() || null,
      notes: form.notes.trim() || null,
    }
    // Opening stock only applies on create — afterwards stock moves through the
    // ledger so every change has a movement behind it.
    if (!part && form.opening_stock !== '') payload.opening_stock = Number(form.opening_stock)
    try {
      if (part) await updateSparePart(part.id, payload)
      else await createSparePart(payload)
      onSave()
    } catch (ex) {
      setErr(ex.message === 'duplicate_part_number' ? 'A part with that number already exists.' : errorText(ex, 'Save failed.'))
      setSaving(false)
    }
  }

  const F = ({ label, children, span }) => (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="label" style={{ display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 580, maxHeight: '90vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{part ? 'Edit part' : 'Add part'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <F label="Part number *"><input className="input" value={form.part_number} onChange={(e) => set('part_number', e.target.value)} placeholder="SP-BRG-6205" style={{ width: '100%', fontFamily: 'var(--ff-m)' }} /></F>
          <F label="Category"><input className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Bearings" style={{ width: '100%' }} /></F>
          <F label="Name *" span={2}><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Bearing 6205-2RS" style={{ width: '100%' }} /></F>
          <F label="Description" span={2}><input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} style={{ width: '100%' }} /></F>
          <F label="Unit of issue"><input className="input" value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="each / litre / metre" style={{ width: '100%' }} /></F>
          <F label="Unit cost (₦)"><input className="input" type="number" min={0} step="0.01" value={form.unit_cost_naira} onChange={(e) => set('unit_cost_naira', e.target.value)} style={{ width: '100%', fontFamily: 'var(--ff-m)' }} /></F>
          <F label="Reorder level"><input className="input" type="number" min={0} step="0.01" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} placeholder="0 = never warn" style={{ width: '100%' }} /></F>
          <F label="Reorder quantity"><input className="input" type="number" min={0} step="0.01" value={form.reorder_quantity} onChange={(e) => set('reorder_quantity', e.target.value)} style={{ width: '100%' }} /></F>
          <F label="Supplier"><input className="input" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} style={{ width: '100%' }} /></F>
          <F label="Storage location"><input className="input" value={form.storage_location} onChange={(e) => set('storage_location', e.target.value)} placeholder="Store A / Bin 12" style={{ width: '100%' }} /></F>
          {!part && (
            <F label="Opening stock" span={2}>
              <input className="input" type="number" min={0} step="0.01" value={form.opening_stock} onChange={(e) => set('opening_stock', e.target.value)} style={{ width: '100%' }} />
              <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 5 }}>Recorded as a receipt, so the first balance has a movement behind it like every later one. After this, stock only changes through Adjust stock.</p>
            </F>
          )}
          <F label="Notes" span={2}><textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} style={{ width: '100%', resize: 'vertical', paddingTop: 8 }} /></F>
          {err && <p style={{ gridColumn: 'span 2', fontSize: 12, color: 'var(--srt)' }}>{err}</p>}
        </div>
        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving…' : part ? 'Save changes' : 'Add part'}</button>
        </div>
      </form>
    </div>
  )
}

// ── Stock adjustment ──────────────────────────────────────────────────────────
function AdjustModal({ part, onClose, onSaved }) {
  const [kind, setKind] = useState('receipt')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [cost, setCost] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const n = Number(quantity)
  const valid = quantity !== '' && Number.isFinite(n) && n > 0
  const delta = kind === 'issue' ? -n : n
  const projected = valid ? Number(part.quantity_in_stock) + delta : Number(part.quantity_in_stock)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await adjustStock(part.id, {
        kind, quantity: n, reason: reason.trim() || null,
        unit_cost_cents: kind === 'receipt' && cost !== '' ? Math.round(Number(cost) * 100) : undefined,
      })
      onSaved()
    } catch (ex) {
      setErr(ex.message === 'insufficient_stock' ? 'There is not enough on hand for that issue.' : errorText(ex, 'Adjustment failed.'))
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 440, background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)' }}>Adjust stock</h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 18 }}>
          {part.name} · {qty(part.quantity_in_stock)} {part.unit} on hand
        </p>

        <label className="label" style={{ display: 'block', marginBottom: 6 }}>What happened</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {MOVEMENT_KINDS.map(([v, l, hint]) => (
            <button key={v} type="button" onClick={() => setKind(v)}
              style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                border: `1px solid ${kind === v ? 'var(--b400)' : 'var(--n200)'}`,
                background: kind === v ? 'var(--slb)' : 'var(--n0)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: kind === v ? 'var(--slt)' : 'var(--n800)' }}>{l}</div>
              <div style={{ fontSize: 11, color: 'var(--n500)' }}>{hint}</div>
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: kind === 'receipt' ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: 5 }}>Quantity ({part.unit})</label>
            <input className="input" type="number" min={0} step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
          </div>
          {kind === 'receipt' && (
            <div>
              <label className="label" style={{ display: 'block', marginBottom: 5 }}>New unit cost (₦)</label>
              <input className="input" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="optional" style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label className="label" style={{ display: 'block', marginBottom: 5 }}>Reference or reason</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="PO-4471, stock count, issued to Warri crew…" style={{ width: '100%' }} />
        </div>

        {valid && (
          <div style={{ background: projected < 0 ? 'var(--srb)' : 'var(--n50)', border: 'var(--bdr)', borderRadius: 5, padding: '10px 12px', fontSize: 12.5, color: projected < 0 ? 'var(--srt)' : 'var(--n700)', marginBottom: 14 }}>
            {projected < 0
              ? `That would take stock to ${qty(projected)} — there is only ${qty(part.quantity_in_stock)} on hand.`
              : <>Stock moves to <strong style={{ fontFamily: 'var(--ff-m)' }}>{qty(projected)} {part.unit}</strong></>}
          </div>
        )}
        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={!valid || busy || projected < 0} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: !valid || busy || projected < 0 ? 0.6 : 1 }}>
            {busy ? 'Recording…' : 'Record movement'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SpareParts({ dark, toggleDark }) {
  const { money } = useMoney()
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'parts:create')
  const canEdit = can(roleKey, 'parts:update')
  const canAdjust = can(roleKey, 'parts:adjust')

  const [parts, setParts] = useState([])
  const [stats, setStats] = useState(null)
  const [categories, setCategories] = useState([])
  const [assets, setAssets] = useState([])
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({ q: '', category: 'all', low_stock: false })
  const [modal, setModal] = useState(null)
  const [adjusting, setAdjusting] = useState(null)
  const [linking, setLinking] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [p, s, c] = await Promise.all([listSpareParts(filters), getPartStats(), listPartCategories()])
      setParts(p); setStats(s); setCategories(c)
    } catch (e) {
      setError(e.message === 'forbidden' ? 'Your role cannot see the parts store.' : errorText(e, 'Failed to load parts.'))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])
  useEffect(() => { listAssets().then(setAssets).catch(() => setAssets([])) }, [])

  const openDetail = useCallback(async (id) => {
    setDetail({ loading: true })
    try { setDetail(await getSparePart(id)) }
    catch { setDetail(null) }
  }, [])

  async function archive(id) {
    if (!confirm('Archive this part? Its movement history is kept.')) return
    try { await archiveSparePart(id); setDetail(null); load() }
    catch (e) { alert(errorText(e)) }
  }

  async function link(assetId) {
    if (!assetId || !detail?.id) return
    await linkPartToAsset(detail.id, assetId)
    setLinking('')
    openDetail(detail.id)
  }

  async function unlink(assetId) {
    await unlinkPartFromAsset(detail.id, assetId)
    openDetail(detail.id)
  }

  const setFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v }))

  return (
    <div className="app-shell">
      <Sidebar active="spare-parts" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Spare Parts" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 12px', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Spare Parts</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>{loading ? 'Loading…' : `${parts.length} part${parts.length === 1 ? '' : 's'} in the store`}</p>
              </div>
              <div style={{ flex: 1 }} />
              {canCreate && (
                <button onClick={() => setModal('add')} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Add Part
                </button>
              )}
            </div>

            {stats && (
              <div style={{ display: 'flex', border: 'var(--bdr)', borderRadius: 6, marginBottom: 12, overflow: 'hidden', background: 'var(--n0)' }}>
                <Stat label="Parts tracked" value={stats.total} />
                <Stat label="At or below reorder level" value={stats.low_stock} tone={stats.low_stock > 0 ? 'warn' : undefined} />
                <Stat label="Out of stock" value={stats.out_of_stock} tone={stats.out_of_stock > 0 ? 'bad' : undefined} />
                <Stat label="Stock value" value={<Money cents={stats.stock_value_cents} />} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Search part number, name or supplier…" style={{ height: 30, fontSize: 12, width: 260 }} />
              <select className="input" value={filters.category} onChange={(e) => setFilter('category', e.target.value)} style={{ height: 30, fontSize: 12, width: 160 }}>
                <option value="all">All categories</option>
                {categories.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.n})</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--n600)', cursor: 'pointer' }}>
                <input type="checkbox" checked={filters.low_stock} onChange={(e) => setFilter('low_stock', e.target.checked)} />
                Needs reordering
              </label>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading parts…</div>
              ) : error ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                  <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
                </div>
              ) : parts.length === 0 ? (
                <div style={{ padding: 64, textAlign: 'center' }}>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 16px' }}><path d="M20 6l13 7v14l-13 7-13-7V13l13-7Z" stroke="var(--n300)" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7 13l13 7 13-7M20 20v14" stroke="var(--n300)" strokeWidth="1.5" /></svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                    {filters.q || filters.low_stock || filters.category !== 'all' ? 'No parts match these filters' : 'No parts in the store yet'}
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>
                    Adding parts lets work orders draw from stock instead of listing them as free text.
                  </p>
                  {canCreate && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Add first part</button>}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['Part Number', 'Name', 'Category', 'On Hand', 'Unit Cost', 'Location', ''].map((h) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parts.map((p) => (
                      <tr key={p.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: detail?.id === p.id ? 'var(--b50)' : 'transparent' }} onClick={() => openDetail(p.id)}>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{p.part_number}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{p.name}</div>
                          {p.supplier && <div style={{ fontSize: 11, color: 'var(--n500)' }}>{p.supplier}</div>}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{p.category || '—'}</td>
                        <td style={{ padding: '11px 14px' }}><StockCell part={p} /></td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{money(p.unit_cost_cents)}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{p.storage_location || '—'}</td>
                        <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                          {canAdjust && (
                            <button onClick={(e) => { e.stopPropagation(); setAdjusting(p) }} className="btn btn-secondary" style={{ height: 26, padding: '0 10px', fontSize: 11.5 }}>Adjust</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {detail && (
              <div style={{ width: 380, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {detail.loading ? (
                  <div style={{ padding: 24, fontSize: 13, color: 'var(--n400)' }}>Loading…</div>
                ) : (
                  <>
                    <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{detail.part_number}</div>
                        <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{detail.name}</div>
                      </div>
                      <button onClick={() => setDetail(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)', flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      </button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '14px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontFamily: 'var(--ff-m)', fontSize: 24, fontWeight: 500, color: detail.is_low ? 'var(--sat)' : 'var(--n900)' }}>{qty(detail.quantity_in_stock)}</span>
                          <span style={{ fontSize: 13, color: 'var(--n500)' }}>{detail.unit} on hand</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--n500)', marginTop: 4 }}>
                          Reorder at {qty(detail.reorder_level)}{detail.reorder_quantity ? ` · order ${qty(detail.reorder_quantity)} at a time` : ''}
                        </div>
                        {canAdjust && (
                          <button onClick={() => setAdjusting(detail)} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12, marginTop: 10 }}>Adjust stock</button>
                        )}
                      </div>

                      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Details</div>
                        {[['Category', detail.category], ['Unit cost', <Money key="uc" cents={detail.unit_cost_cents} />], ['Supplier', detail.supplier], ['Storage', detail.storage_location], ['Description', detail.description]].map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                            <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                            <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v || '—'}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Fits these assets</div>
                        {detail.assets?.length ? detail.assets.map((a) => (
                          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                            <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{a.ain}</span>
                            <span style={{ flex: 1, color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                            {canEdit && <button onClick={() => unlink(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 2, display: 'flex' }}>
                              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                            </button>}
                          </div>
                        )) : <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--n400)' }}>Not linked to any asset yet.</div>}
                        {canEdit && (
                          <div style={{ padding: '10px 14px' }}>
                            <select className="input" value={linking} onChange={(e) => link(e.target.value)} style={{ width: '100%', height: 30, fontSize: 12 }}>
                              <option value="">Link to an asset…</option>
                              {assets.filter((a) => !detail.assets?.some((x) => x.id === a.id)).map((a) => (
                                <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Movement history</div>
                        {detail.movements?.length ? detail.movements.map((m) => {
                          const q = Number(m.quantity)
                          return (
                            <div key={m.id} style={{ padding: '9px 14px', borderBottom: 'var(--bdr)' }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                <span style={{ fontFamily: 'var(--ff-m)', fontSize: 12, fontWeight: 500, color: q < 0 ? 'var(--srt)' : 'var(--sgt)', width: 52 }}>
                                  {q > 0 ? '+' : ''}{qty(q)}
                                </span>
                                <span style={{ flex: 1, fontSize: 12, color: 'var(--n800)' }}>{MOVEMENT_LABEL[m.kind] || m.kind}</span>
                                <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n500)' }}>→ {qty(m.balance_after)}</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 2, paddingLeft: 60 }}>
                                {m.work_order ? `${m.work_order.ref} · ` : ''}{m.reason || ''}{m.actor ? `${m.reason || m.work_order ? ' · ' : ''}${m.actor.full_name}` : ''}
                              </div>
                            </div>
                          )
                        }) : <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--n400)' }}>No movements recorded.</div>}
                      </div>

                      {canEdit && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingBottom: 8 }}>
                          <button onClick={() => setModal(detail)} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit part</button>
                          <button onClick={() => archive(detail.id)} style={{ height: 34, fontSize: 13, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Archive</button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <PartModal
          part={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); if (detail?.id) openDetail(detail.id) }}
        />
      )}
      {adjusting && (
        <AdjustModal
          part={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); load(); if (detail?.id) openDetail(detail.id) }}
        />
      )}
    </div>
  )
}
