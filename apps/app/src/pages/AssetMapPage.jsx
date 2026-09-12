import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import AssetMap, { MAP_COLOUR_MODES } from '../components/AssetMap.jsx'
import { getAssetMap } from '../lib/db/analytics'
import { errorText } from '../lib/errors'

const ALL = 'all'

/** The distinct values of one field across the placed assets, for a filter. */
function optionsFrom(assets, pick) {
  const seen = new Map()
  for (const a of assets) {
    const v = pick(a)
    if (v && !seen.has(v.id ?? v)) seen.set(v.id ?? v, v.name ?? v)
  }
  return [...seen.entries()]
}

export default function AssetMapPage({ dark, toggleDark }) {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [colourBy, setColourBy] = useState('status')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState({ location: ALL, site: ALL, category: ALL, status: ALL, criticality: ALL, work: ALL })

  useEffect(() => {
    getAssetMap()
      .then((d) => { setData(d); setLoading(false) })
      .catch((e) => { setError(errorText(e, 'Failed to load the map.')); setLoading(false) })
  }, [])

  const assets = data?.assets || []

  const shown = useMemo(() => assets.filter((a) => {
    if (filters.location !== ALL && a.location?.id !== filters.location) return false
    if (filters.site !== ALL && a.site?.id !== filters.site) return false
    if (filters.category !== ALL && a.category?.id !== filters.category) return false
    if (filters.status !== ALL && a.status !== filters.status) return false
    if (filters.criticality !== ALL && a.criticality !== filters.criticality) return false
    if (filters.work === 'open' && !(a.open_work_orders > 0 || a.open_defects > 0)) return false
    if (filters.work === 'clear' && (a.open_work_orders > 0 || a.open_defects > 0)) return false
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      if (!`${a.ain} ${a.name}`.toLowerCase().includes(needle)) return false
    }
    return true
  }), [assets, filters, q])

  const locations = optionsFrom(assets, (a) => a.location)
  const sites = optionsFrom(assets, (a) => a.site)
  const categories = optionsFrom(assets, (a) => a.category)
  const filtered = shown.length !== assets.length
  // Assets placed at their site rather than their own fix — worth saying, so
  // nobody reads a cluster of pins on one point as six separate surveys.
  const bySite = shown.filter((a) => a.position_source === 'site').length

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }))
  const clear = () => { setFilters({ location: ALL, site: ALL, category: ALL, status: ALL, criticality: ALL, work: ALL }); setQ('') }

  const sel = { height: 30, fontSize: 12, padding: '0 8px', border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', color: 'var(--n700)', fontFamily: 'var(--ff-u)', maxWidth: 190 }

  return (
    <div className="app-shell">
      <Sidebar active="asset-map" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Asset Map" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)' }}>
            <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Asset Map</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>
                  {loading ? 'Loading…' : `${shown.length} of ${assets.length} placed asset${assets.length === 1 ? '' : 's'}${data?.unplaced ? ` · ${data.unplaced} unplaced` : ''}`}
                </p>
              </div>
              <div style={{ flex: 1 }} />
              <select style={{ ...sel, height: 32 }} value={colourBy} onChange={(e) => setColourBy(e.target.value)}>
                {Object.entries(MAP_COLOUR_MODES).map(([k, m]) => <option key={k} value={k}>Colour by {m.label.toLowerCase()}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search AIN or name…" style={{ ...sel, width: 190, maxWidth: 'none' }} />
              <select style={sel} value={filters.location} onChange={(e) => set('location', e.target.value)}>
                <option value={ALL}>All locations</option>
                {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select style={sel} value={filters.site} onChange={(e) => set('site', e.target.value)}>
                <option value={ALL}>All sites</option>
                {sites.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select style={sel} value={filters.category} onChange={(e) => set('category', e.target.value)}>
                <option value={ALL}>All categories</option>
                {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <select style={sel} value={filters.status} onChange={(e) => set('status', e.target.value)}>
                <option value={ALL}>Any condition</option>
                {['operational', 'attention', 'critical', 'offline'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select style={sel} value={filters.criticality} onChange={(e) => set('criticality', e.target.value)}>
                <option value={ALL}>Any criticality</option>
                {['critical', 'high', 'medium', 'low'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <select style={sel} value={filters.work} onChange={(e) => set('work', e.target.value)}>
                <option value={ALL}>Any workload</option>
                <option value="open">Has open work</option>
                <option value="clear">Nothing outstanding</option>
              </select>
              {filtered && <button onClick={clear} style={{ ...sel, cursor: 'pointer' }}>Clear filters</button>}
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading the map…</div>
            ) : error ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--srt)', fontSize: 13 }}>{error}</div>
            ) : (
              <>
                <AssetMap
                  assets={shown}
                  unplaced={data?.unplaced || 0}
                  colourBy={colourBy}
                  height={520}
                  onSelect={(a) => nav(`/assets?ain=${encodeURIComponent(a.ain)}`)}
                />
                {bySite > 0 && (
                  <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 6, lineHeight: 1.6 }}>
                    {bySite} of these {bySite === 1 ? 'is' : 'are'} shown at their site&apos;s coordinates, having none of their own —
                    accurate to the site, not to the metre.
                  </p>
                )}
                {filtered && shown.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--n500)', marginTop: 12, textAlign: 'center' }}>No asset matches these filters.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
