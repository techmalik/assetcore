import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listAssets, createAsset, updateAsset, softDeleteAsset } from '../lib/db/assets'
import { listSites } from '../lib/db/sites'
import { listCategories } from '../lib/db/categories'
import { useAuth } from '../lib/AuthContext.jsx'
import { can } from '../lib/rbac'

const STATUS_STYLE = {
  critical:    { bg: 'var(--srb)', c: 'var(--srt)', br: 'var(--srbr)', label: 'Critical' },
  attention:   { bg: 'var(--sab)', c: 'var(--sat)', br: 'var(--sabr)', label: 'Attention' },
  operational: { bg: 'var(--sgb)', c: 'var(--sgt)', br: 'var(--sgbr)', label: 'Operational' },
  offline:     { bg: 'var(--n100)', c: 'var(--n500)', br: 'var(--n300)', label: 'Offline' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.offline
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 2, padding: '2px 7px', fontSize: 11, fontWeight: 500, border: '1px solid', background: s.bg, color: s.c, borderColor: s.br, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function HealthBar({ score }) {
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

function formatNBV(cents) {
  if (!cents) return '—'
  const n = cents / 100
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`
  return `₦${n.toLocaleString()}`
}

// ── Add / Edit Asset Modal ────────────────────────────────────────────────────
function AssetModal({ asset, sites, categories, onClose, onSave }) {
  const [form, setForm] = useState(asset ? {
    ain: asset.ain, name: asset.name,
    site_id: asset.site_id || '', category_id: asset.category_id || '',
    status: asset.status, health_score: asset.health_score ?? 100,
  } : { ain: '', name: '', site_id: '', category_id: '', status: 'operational', health_score: 100 })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true)
    try {
      if (!form.ain.trim() || !form.name.trim() || !form.site_id || !form.category_id) {
        setErr('AIN, name, site and category are required.'); setSaving(false); return
      }
      if (asset) await updateAsset(asset.id, form)
      else await createAsset(form)
      onSave()
    } catch (ex) { setErr(ex.message || 'Save failed.'); setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 480, background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 28, zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)' }}>{asset ? 'Edit Asset' : 'Add Asset'}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>AIN *</label>
            <input className="input" value={form.ain} onChange={e => set('ain', e.target.value)} placeholder="e.g. NGML-MTR-0042" style={{ width: '100%', fontFamily: 'var(--ff-m)' }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Status</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)} style={{ width: '100%' }}>
              {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Asset name *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Lagos DS-04 Metering Station" style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Site *</label>
            <select className="input" value={form.site_id} onChange={e => set('site_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">Select site…</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Category *</label>
            <select className="input" value={form.category_id} onChange={e => set('category_id', e.target.value)} style={{ width: '100%' }}>
              <option value="">Select category…</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>Health score (0–100)</label>
          <input className="input" type="number" min={0} max={100} value={form.health_score} onChange={e => set('health_score', Number(e.target.value))} style={{ width: '100%' }} />
        </div>

        {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>{err}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving ? .7 : 1 }}>
            {saving ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Assets({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'asset:create')
  const canEdit   = can(roleKey, 'asset:update')

  const [assets, setAssets] = useState([])
  const [sites, setSites] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null) // null | 'add' | asset object for edit

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [a, s, c] = await Promise.all([listAssets({ status: filter }), listSites(), listCategories()])
      setAssets(a); setSites(s); setCategories(c)
    } catch (e) { setError(e.message || 'Failed to load assets.') }
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => { load() }, [load])

  // Re-select from fresh data after save
  const afterSave = async () => {
    setModal(null)
    await load()
  }

  async function deleteAsset(id) {
    if (!confirm('Archive this asset? It will be hidden but not permanently deleted.')) return
    try { await softDeleteAsset(id); setSelected(null); load() }
    catch (e) { alert(e.message) }
  }

  return (
    <div className="app-shell">
      <Sidebar active="assets" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Assets" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Toolbar */}
          <div style={{ padding: '16px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <div>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Asset Registry</h1>
              <p style={{ fontSize: 12, color: 'var(--n500)' }}>
                {loading ? 'Loading…' : `${assets.length} assets · ${sites.length} sites`}
              </p>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {[['all', 'All'], ['operational', 'Operational'], ['attention', 'Attention'], ['critical', 'Critical']].map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)} style={{ height: 30, padding: '0 12px', border: `1px solid ${filter === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filter === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: filter === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filter === v ? 500 : 400, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            {canCreate && (
              <button onClick={() => setModal('add')} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                Add Asset
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {/* Table / states */}
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
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto 16px' }}><rect x="6" y="8" width="28" height="26" rx="3" stroke="var(--n300)" strokeWidth="1.5"/><path d="M13 16h14M13 21h14M13 26h8" stroke="var(--n300)" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>No assets yet</p>
                  <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>Add your first asset to start tracking your infrastructure.</p>
                  {canCreate && <button onClick={() => setModal('add')} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Add first asset</button>}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['AIN', 'Asset Name', 'Category', 'Site', 'Status', 'Health', 'NBV', ''].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map(a => (
                      <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selected?.id === a.id ? 'var(--b50)' : 'transparent' }} onClick={() => setSelected(a)}>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, fontWeight: 500, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{a.ain}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{a.name}</div>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{a.category?.name || '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{a.site?.name || '—'}</td>
                        <td style={{ padding: '11px 14px' }}><StatusBadge status={a.status} /></td>
                        <td style={{ padding: '11px 14px' }}><HealthBar score={a.health_score ?? 0} /></td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{formatNBV(a.nbv_cents)}</td>
                        <td style={{ padding: '11px 14px' }}>
                          {canEdit && (
                            <button onClick={e => { e.stopPropagation(); setModal(a) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 4 }}>
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor" /><circle cx="7" cy="7" r="1" fill="currentColor" /><circle cx="7" cy="11" r="1" fill="currentColor" /></svg>
                            </button>
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
              <div style={{ width: 340, flexShrink: 0, borderLeft: 'var(--bdr)', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{selected.ain}</div>
                    <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{selected.name}</div>
                  </div>
                  <button onClick={() => setSelected(null)} style={{ width: 26, height: 26, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--n500)' }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                  </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <StatusBadge status={selected.status} />
                    {selected.category && <span className="badge badge-n">{selected.category.name}</span>}
                    {selected.site && <span className="badge badge-n">{selected.site.name}</span>}
                  </div>

                  {/* Health score */}
                  <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', marginBottom: 10, fontFamily: 'var(--ff-m)' }}>Health Score</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                        <svg viewBox="0 0 64 64" width="64" height="64">
                          <circle cx="32" cy="32" r="24" fill="none" stroke="var(--n200)" strokeWidth="7" />
                          <circle cx="32" cy="32" r="24" fill="none" stroke={selected.health_score < 40 ? 'var(--sr)' : selected.health_score < 70 ? 'var(--sa)' : 'var(--sg)'} strokeWidth="7" strokeDasharray={`${150.8 * (selected.health_score ?? 0) / 100} ${150.8}`} strokeLinecap="round" transform="rotate(-90 32 32)" />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontFamily: 'var(--ff-m)', fontSize: 16, fontWeight: 500 }}>{selected.health_score ?? 0}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.6 }}>
                        <div style={{ fontWeight: 600, color: 'var(--n800)', marginBottom: 4 }}>
                          {selected.status === 'critical' ? 'Critical condition' : selected.status === 'attention' ? 'Needs attention' : 'Healthy'}
                        </div>
                        NBV: {formatNBV(selected.nbv_cents)}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>Details</div>
                    {[
                      ['AIN', selected.ain],
                      ['Category', selected.category?.name || '—'],
                      ['Site', selected.site?.name || '—'],
                      ['NBV', formatNBV(selected.nbv_cents)],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                        <span style={{ color: 'var(--n500)' }}>{k}</span>
                        <span style={{ color: 'var(--n800)', fontWeight: 500, fontFamily: k === 'AIN' || k === 'NBV' ? 'var(--ff-m)' : 'inherit' }}>{v}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Raise Work Order</button>
                    {canEdit && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <button onClick={() => setModal(selected)} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit Asset</button>
                        <button onClick={() => deleteAsset(selected.id)} style={{ height: 34, fontSize: 13, background: 'none', border: '1px solid var(--srbr)', color: 'var(--srt)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Archive</button>
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
          onClose={() => setModal(null)}
          onSave={afterSave}
        />
      )}
    </div>
  )
}
