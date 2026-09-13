import { useEffect, useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { listExports, downloadExport } from '../lib/db/exports'
import { listMyLocations } from '../lib/db/locations'
import { listSites } from '../lib/db/sites'
import { errorText } from '../lib/errors'

const humanise = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const EMPTY = { location_id: '', site_id: '', from: '', to: '', status: '', q: '' }

const fieldLabel = { display: 'block', marginBottom: 4 }
const control = { width: '100%', height: 34, fontSize: 13 }

export default function Export({ dark, toggleDark }) {
  const [datasets, setDatasets] = useState(null)
  const [err, setErr] = useState('')
  const [locations, setLocations] = useState([])
  const [sites, setSites] = useState([])

  useEffect(() => {
    listExports().then(setDatasets).catch((e) => setErr(errorText(e, 'Could not load what can be exported.')))
    // Filter choices only. Without them a card still exports; it just can't
    // narrow by place, so a failure here stays quiet.
    listMyLocations().then(setLocations).catch(() => {})
    listSites().then(setSites).catch(() => {})
  }, [])

  return (
    <div className="app-shell">
      <Sidebar active="export" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Export" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)' }}>
            <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Export</h1>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>
              Download your registers as CSV or Excel. Files only include the sites you have access to.
            </p>
          </div>

          <div style={{ padding: '20px clamp(12px, 4vw, 24px)' }}>
            {err ? (
              <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '10px 14px', fontSize: 12, color: 'var(--srt)' }}>{err}</div>
            ) : !datasets ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading…</div>
            ) : datasets.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--n500)', fontSize: 13 }}>Your role has nothing it can export.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 14, alignItems: 'start' }}>
                {datasets.map((ds) => (
                  <ExportCard key={ds.key} dataset={ds} locations={locations} sites={sites} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ExportCard({ dataset, locations, sites }) {
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(null) // 'csv' | 'xlsx' while downloading
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  const has = (k) => dataset.filters.includes(k)
  const siteOptions = f.location_id ? sites.filter((s) => s.location_id === f.location_id) : sites

  function set(key, value) {
    setDone('')
    setF((prev) => {
      const next = { ...prev, [key]: value }
      // A site from another location would make the two filters contradict
      // each other and the file come back empty.
      if (key === 'location_id' && value && prev.site_id && !sites.some((s) => s.id === prev.site_id && s.location_id === value)) {
        next.site_id = ''
      }
      return next
    })
  }

  async function run(format) {
    setBusy(format); setErr(''); setDone('')
    try {
      const applied = {}
      if (has('location')) applied.location_id = f.location_id
      if (has('site')) applied.site_id = f.site_id
      if (has('date')) { applied.from = f.from; applied.to = f.to }
      if (has('status')) applied.status = f.status
      if (has('q')) applied.q = f.q
      const r = await downloadExport(dataset.key, format, applied)
      setDone(r.truncated
        ? `Downloaded the first ${r.rowCount.toLocaleString()} rows. Narrow the filters to get the rest.`
        : `Downloaded ${r.rowCount.toLocaleString()} row${r.rowCount === 1 ? '' : 's'}.`)
    } catch (e) {
      setErr(errorText(e, 'The export did not download. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  const anyFilter = has('location') || has('site') || has('date') || has('status') || has('q')

  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, boxShadow: 'var(--sh-sm)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n900)' }}>{dataset.label}</div>
        <div style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.5, marginTop: 2 }}>{dataset.description}</div>
      </div>

      {anyFilter && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 8 }}>
          {has('location') && (
            <div>
              <label className="label" style={fieldLabel}>Location</label>
              <select className="input" style={control} value={f.location_id} onChange={(e) => set('location_id', e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          )}
          {has('site') && (
            <div>
              <label className="label" style={fieldLabel}>Site</label>
              <select className="input" style={control} value={f.site_id} onChange={(e) => set('site_id', e.target.value)}>
                <option value="">All sites</option>
                {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {has('status') && dataset.statuses?.length > 0 && (
            <div>
              <label className="label" style={fieldLabel}>Status</label>
              <select className="input" style={control} value={f.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">Any status</option>
                {dataset.statuses.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
              </select>
            </div>
          )}
          {has('q') && (
            <div>
              <label className="label" style={fieldLabel}>Entity contains</label>
              <input className="input" style={control} value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Name, AIN, ref…" />
            </div>
          )}
          {has('date') && (
            <>
              <div>
                <label className="label" style={fieldLabel}>{dataset.date_label || 'Date'} from</label>
                <input type="date" className="input" style={control} value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} />
              </div>
              <div>
                <label className="label" style={fieldLabel}>to</label>
                <input type="date" className="input" style={control} value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} />
              </div>
            </>
          )}
        </div>
      )}

      {err && <div style={{ fontSize: 12, color: 'var(--srt)' }}>{err}</div>}
      {done && !err && <div style={{ fontSize: 12, color: 'var(--sgt)' }}>{done}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => run('csv')} style={{ flex: 1, height: 36, fontSize: 13 }}>
          {busy === 'csv' ? 'Preparing…' : 'CSV'}
        </button>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => run('xlsx')} style={{ flex: 1, height: 36, fontSize: 13 }}>
          {busy === 'xlsx' ? 'Preparing…' : 'Excel'}
        </button>
      </div>
    </div>
  )
}
