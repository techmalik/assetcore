import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../../components/Sidebar.jsx'
import Topbar from '../../components/Topbar.jsx'
import { PrintQrSheet } from '../../components/AssetQr.jsx'
import { listAssets, softDeleteAsset, restoreAsset } from '../../lib/db/assets'
import TransferAssetsModal from '../../components/TransferAssetsModal.jsx'
import { listSites } from '../../lib/db/sites'
import { listLocations } from '../../lib/db/locations'
import { listCategories } from '../../lib/db/categories'
import { listOrgUsers } from '../../lib/db/orgMembers'
import { getOrg } from '../../lib/db/org'
import { useCan } from '../../lib/AuthContext.jsx'
import { healthBand } from '../../lib/health'
import { useToast } from '../../lib/ToastContext'
import { useLocationFilter } from '../../lib/LocationFilterContext'
import { errorText } from '../../lib/errors'
import { fmtDate } from '../../lib/dates'
import { useConfirm } from '../../lib/ConfirmContext'
import { LEGACY_STATUS_KEYS, STATE_FILTERS, AssetStatusBadge, nextMaintColor } from './assetBits.jsx'
import { HealthBar, AssetDetailPanel } from './AssetDetailPanel.jsx'
import { AssetModal } from './AssetModal.jsx'
import { RaiseWOModal } from './RaiseWOModal.jsx'
import { CompleteMaintenanceModal } from './assetModals.jsx'
import { ImportModal } from './ImportModal.jsx'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Assets({ dark, toggleDark }) {
  const ask = useConfirm()
  const can = useCan()
  const toast = useToast()
  const { locationId: globalLocationId, setLocationId: setGlobalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)
  const canCreate = can('asset:create')
  const canEdit = can('asset:update')
  const canWO = can('wo:create')
  const canCompleteMaintenance = can('maintenance:complete')

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
  const [labelling, setLabelling] = useState(false)

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
    if (!(await ask('Archive this asset? It will be hidden from the registry but not deleted, and can be restored.', { danger: true, confirmLabel: 'Archive' }))) return
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

  // Bulk selection, for transfers. Held as ids and read back through
  // visibleAssets, so an asset filtered out of view is never moved by a
  // selection the user can no longer see.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [transferList, setTransferList] = useState(null) // assets the transfer modal is open for
  const canBulk = canEdit && !archivedView
  const selectedAssets = canBulk ? visibleAssets.filter((a) => selectedIds.has(a.id)) : []
  const allVisibleSelected = visibleAssets.length > 0 && selectedAssets.length === visibleAssets.length
  const toggleSelected = (id) => setSelectedIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAllVisible = () => setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleAssets.map((a) => a.id)))

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n400)', fontFamily: 'var(--ff-m)' }}>State</span>
              {STATE_FILTERS.filter(([v]) => !LEGACY_STATUS_KEYS.includes(v) || hasLegacyStatus || filter === v).map(([v, l]) => (
                <button key={v} onClick={() => setFilter(v)} className="filter-pill" style={{ height: 30, padding: '0 12px', border: `1px solid ${filter === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filter === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: filter === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filter === v ? 500 : 400, cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
                <button onClick={() => setLabelling(true)} disabled={visibleAssets.length === 0} className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 13, opacity: visibleAssets.length === 0 ? .5 : 1 }} title="Print a QR label for every asset in the list below">Labels</button>
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
                  {selectedAssets.length > 0 && (
                    <div style={{ position: 'sticky', top: 0, zIndex: 11, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'var(--b50)', borderBottom: '1px solid var(--b200)', fontSize: 12, color: 'var(--b700)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{selectedAssets.length} selected</span>
                      <span style={{ color: 'var(--b300)' }}>·</span>
                      <button type="button" onClick={() => setTransferList(selectedAssets)} className="btn btn-primary" style={{ height: 28, padding: '0 12px', fontSize: 12 }}>Transfer to site…</button>
                      <span style={{ color: 'var(--b300)' }}>·</span>
                      <button type="button" onClick={() => setSelectedIds(new Set())} style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--b700)', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Clear</button>
                    </div>
                  )}
                  <table className="table-view-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: selectedAssets.length > 0 ? 44 : 0, zIndex: 10 }}>
                      <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                        {canBulk && (
                          <th style={{ padding: '9px 0 9px 14px', width: 28, borderBottom: 'var(--bdr)' }}>
                            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible}
                              aria-label={allVisibleSelected ? 'Clear selection' : `Select all ${visibleAssets.length} assets shown`}
                              ref={(el) => { if (el) el.indeterminate = selectedAssets.length > 0 && !allVisibleSelected }} />
                          </th>
                        )}
                        {['AIN', 'Name & Model', 'Type', 'Location', 'Site', 'Status', 'Health', 'Next Maint.', 'Operator', 'Actions'].map((h) => (
                          <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAssets.map((a) => (
                        <tr key={a.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selected?.id === a.id || selectedIds.has(a.id) ? 'var(--b50)' : 'transparent' }} onClick={() => setSelected(a)}>
                          {canBulk && (
                            // stopPropagation so ticking a row selects it for a
                            // bulk action without also opening its detail panel.
                            <td style={{ padding: '11px 0 11px 14px', width: 28 }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelected(a.id)} aria-label={`Select ${a.ain}`} />
                            </td>
                          )}
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
                onTransfer={canEdit ? () => setTransferList([selected]) : undefined}
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
      {/* The sheet prints whatever the filters have narrowed the list to, so
          "labels for the Warri site" is a search away rather than a feature. */}
      {transferList && (
        <TransferAssetsModal
          assets={transferList}
          sites={sites}
          locations={locations}
          onClose={() => setTransferList(null)}
          // Clear the selection and refetch: the moved assets now show their
          // new site, and a revived one its restored status.
          onDone={() => { setSelectedIds(new Set()); setDetailRefreshToken((n) => n + 1); load() }}
        />
      )}
      {labelling && (
        <PrintQrSheet
          assets={visibleAssets}
          onClose={() => setLabelling(false)}
        />
      )}
    </div>
  )
}
