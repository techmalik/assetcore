import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import { listDevices, createDevice, updateDevice, softDeleteDevice } from '../lib/db/devices'
import { listSites } from '../lib/db/sites'
import { listAssets } from '../lib/db/assets'

const STATUS_META = {
  online:          { label: 'Online',         dot: 'var(--sg)',    c: 'var(--sgt)', bg: 'var(--sgb)', br: 'var(--sgbr)' },
  offline:         { label: 'Offline',         dot: 'var(--n400)',  c: 'var(--n600)', bg: 'var(--n100)', br: 'var(--n300)' },
  error:           { label: 'Error',           dot: 'var(--sr)',    c: 'var(--srt)', bg: 'var(--srb)', br: 'var(--srbr)' },
  unprovisioned:   { label: 'Unprovisioned',   dot: 'var(--sa)',    c: 'var(--sat)', bg: 'var(--sab)', br: 'var(--sabr)' },
}

const KIND_LABELS = {
  sensor: 'Sensor', gateway: 'Gateway', meter: 'Meter',
  camera: 'Camera', plc: 'PLC',
}

const PROTOCOL_LABELS = {
  mqtt: 'MQTT', modbus: 'Modbus', http: 'HTTP/REST', 'opc-ua': 'OPC-UA',
}

function fmtLastSeen(ts) {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Add/Edit Modal ────────────────────────────────────────────────────────────
function DeviceModal({ device, sites, assets, onClose, onSaved }) {
  const editing = Boolean(device)
  const [form, setForm] = useState({
    name:             device?.name             || '',
    kind:             device?.kind             || 'sensor',
    protocol:         device?.protocol         || 'mqtt',
    serial_number:    device?.serial_number    || '',
    firmware_version: device?.firmware_version || '',
    ip_address:       device?.ip_address       || '',
    site_id:          device?.site_id          || '',
    asset_id:         device?.asset_id         || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) return setErr('Device name is required.')
    setSaving(true); setErr(null)
    try {
      const payload = {
        name:             form.name.trim(),
        kind:             form.kind,
        protocol:         form.protocol,
        serial_number:    form.serial_number    || null,
        firmware_version: form.firmware_version || null,
        ip_address:       form.ip_address       || null,
        site_id:          form.site_id          || null,
        asset_id:         form.asset_id         || null,
        status:           device?.status        || 'unprovisioned',
      }
      if (editing) await updateDevice(device.id, payload)
      else         await createDevice(payload)
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const inp = { height: 34, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: 'var(--n0)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--n800)', display: 'flex', flexDirection: 'column', gap: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)' }}>
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: 24, width: 480, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', flex: 1 }}>{editing ? 'Edit Device' : 'Register Device'}</h2>
          <button onClick={onClose} style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--n500)', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        {err && <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={lbl}>Device name *
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Lagos DS-04 Flow Transmitter" style={inp} />
          </label>
          <div className="form-grid" style={{ gap: 10 }}>
            <label style={lbl}>Type
              <select value={form.kind} onChange={e => set('kind', e.target.value)} style={{ ...inp, appearance: 'none' }}>
                {Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label style={lbl}>Protocol
              <select value={form.protocol} onChange={e => set('protocol', e.target.value)} style={{ ...inp, appearance: 'none' }}>
                {Object.entries(PROTOCOL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="form-grid" style={{ gap: 10 }}>
            <label style={lbl}>Serial number
              <input value={form.serial_number} onChange={e => set('serial_number', e.target.value)} placeholder="e.g. TRM-SN-001" style={inp} />
            </label>
            <label style={lbl}>IP address
              <input value={form.ip_address} onChange={e => set('ip_address', e.target.value)} placeholder="e.g. 192.168.1.10" style={inp} />
            </label>
          </div>
          <label style={lbl}>Firmware version
            <input value={form.firmware_version} onChange={e => set('firmware_version', e.target.value)} placeholder="e.g. v2.3.1" style={inp} />
          </label>
          <label style={lbl}>Linked asset
            <select value={form.asset_id} onChange={e => set('asset_id', e.target.value)} style={{ ...inp, appearance: 'none' }}>
              <option value="">— Not linked to an asset —</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
            </select>
          </label>
          <label style={lbl}>Site
            <select value={form.site_id} onChange={e => set('site_id', e.target.value)} style={{ ...inp, appearance: 'none' }}>
              <option value="">— Not site-specific —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ height: 34, padding: '0 18px', fontSize: 13 }}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Register Device'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Status summary chips ───────────────────────────────────────────────────────
function SummaryChip({ label, count, active, onClick, color }) {
  return (
    <button onClick={onClick} className="filter-pill" style={{ height: 28, padding: '0 12px', border: `1px solid ${active ? color : 'var(--n200)'}`, borderRadius: 4, background: active ? 'var(--n50)' : 'var(--n0)', fontSize: 12, fontWeight: active ? 600 : 400, color: active ? color : 'var(--n600)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label} ({count})
    </button>
  )
}

export default function Devices({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'wo:create')
  const [devices, setDevices]   = useState([])
  const [sites, setSites]       = useState([])
  const [assets, setAssets]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState(null)
  const [modal, setModal]       = useState(null)  // null | 'add' | device-obj
  const [filter, setFilter]     = useState('all')

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [devs, siteList, assetList] = await Promise.all([listDevices(), listSites(), listAssets({})])
      setDevices(devs); setSites(siteList); setAssets(assetList)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = { all: devices.length, online: 0, offline: 0, error: 0, unprovisioned: 0 }
  for (const d of devices) if (d.status in counts) counts[d.status]++

  const shown = filter === 'all' ? devices : devices.filter(d => d.status === filter)

  return (
    <div className="app-shell">
      <Sidebar active="devices" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Devices" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{ padding: '14px 24px 12px', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Devices</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>IoT sensors, meters, gateways & telemetry endpoints</p>
              </div>
              <div style={{ flex: 1 }} />
              {canCreate && (
                <button onClick={() => setModal('add')} className="row-action" style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', borderRadius: 4, fontSize: 13, fontWeight: 500, gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Register Device
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setFilter('all')} className="filter-pill" style={{ height: 28, padding: '0 12px', border: `1px solid ${filter === 'all' ? 'var(--b400)' : 'var(--n200)'}`, borderRadius: 4, background: filter === 'all' ? 'var(--b50)' : 'var(--n0)', fontSize: 12, fontWeight: filter === 'all' ? 600 : 400, color: filter === 'all' ? 'var(--b700)' : 'var(--n600)', cursor: 'pointer' }}>
                All ({counts.all})
              </button>
              {[
                { key: 'online',        color: 'var(--sgt)' },
                { key: 'offline',       color: 'var(--n500)' },
                { key: 'error',         color: 'var(--srt)' },
                { key: 'unprovisioned', color: 'var(--sat)' },
              ].map(s => (
                <SummaryChip key={s.key} label={STATUS_META[s.key].label} count={counts[s.key]} active={filter === s.key} onClick={() => setFilter(s.key)} color={s.color} />
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading…</div>
            ) : err ? (
              <div style={{ padding: 24 }}>
                <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '10px 14px', fontSize: 12, color: 'var(--srt)' }}>
                  {err.includes('does not exist') ? 'Device data unavailable — ensure all database migrations have been applied (npm run migrate).' : err}
                </div>
              </div>
            ) : shown.length === 0 ? (
              <EmptyState canCreate={canCreate} onAdd={() => setModal('add')} />
            ) : (
              <div className="table-scroll"><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                    {['Device', 'Type', 'Protocol', 'Linked Asset', 'Site', 'Firmware', 'Last Seen', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(dev => {
                    const sm = STATUS_META[dev.status] || STATUS_META.offline
                    return (
                      <tr key={dev.id} className="row-hover" style={{ borderBottom: 'var(--bdr)' }}>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)' }}>{dev.name}</div>
                          {dev.serial_number && <div style={{ fontFamily: 'var(--ff-m)', fontSize: 10, color: 'var(--n400)' }}>{dev.serial_number}</div>}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)' }}>{KIND_LABELS[dev.kind] || dev.kind}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ fontFamily: 'var(--ff-m)', fontSize: 10, background: 'var(--n100)', color: 'var(--n700)', border: '1px solid var(--n200)', borderRadius: 2, padding: '2px 6px' }}>{PROTOCOL_LABELS[dev.protocol] || dev.protocol}</span>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>
                          {dev.asset ? <span>{dev.asset.ain}</span> : <span style={{ color: 'var(--n400)' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{dev.site?.name || '—'}</td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n500)' }}>{dev.firmware_version || '—'}</td>
                        <td style={{ padding: '11px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: dev.status === 'online' ? 'var(--sgt)' : 'var(--n500)', whiteSpace: 'nowrap' }}>
                          {fmtLastSeen(dev.last_seen_at)}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 2, border: `1px solid ${sm.br}`, fontSize: 10, fontWeight: 500, background: sm.bg, color: sm.c }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: sm.dot, display: 'inline-block' }} />
                            {sm.label}
                          </span>
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <button onClick={() => setModal(dev)} className="row-action" style={{ fontSize: 11, color: 'var(--b600)' }}>Edit</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <DeviceModal
          device={modal === 'add' ? null : modal}
          sites={sites}
          assets={assets}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

function EmptyState({ canCreate, onAdd }) {
  return (
    <div style={{ padding: 'clamp(16px, 4vw, 40px)', display: 'flex', gap: 40, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Left: empty state */}
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 14, textAlign: 'center', background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8 }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--n100)', border: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="12" rx="2" stroke="var(--n400)" strokeWidth="1.4" /><path d="M6 10h.01M6 14h.01M10 10h4M10 14h4" stroke="var(--n400)" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--n800)', marginBottom: 6 }}>No devices connected yet</div>
          <div style={{ fontSize: 13, color: 'var(--n500)', maxWidth: 340, lineHeight: 1.6 }}>
            Register IoT devices — pressure transmitters, flow meters, gateway units — and stream real-time telemetry into AssetCore. Contact your SCADA/IoT team to begin provisioning.
          </div>
        </div>
        {canCreate && (
          <button onClick={onAdd} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, marginTop: 4 }}>Register first device</button>
        )}
      </div>

      {/* Right: how it works */}
      <div style={{ flex: '1 1 300px', minWidth: 260, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n800)', marginBottom: 14 }}>How telemetry works</div>
        {[
          { step: '1', title: 'Register device', desc: 'Add the device serial and link it to an asset or site.' },
          { step: '2', title: 'Provision credentials', desc: 'Your IoT/SCADA team configures MQTT credentials or Modbus endpoint in the field device.' },
          { step: '3', title: 'Stream readings', desc: 'The ingest-telemetry Edge Function receives readings and writes to telemetry_readings.' },
          { step: '4', title: 'View live data', desc: 'Readings appear on the asset detail page and trigger alerts when outside threshold.' },
        ].map(s => (
          <div key={s.step} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--b100)', border: '1px solid var(--b200)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--b700)', flexShrink: 0 }}>{s.step}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n800)', marginBottom: 2 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: 'var(--n500)', lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 4, padding: '10px 12px', background: 'var(--b50)', border: '1px solid var(--b100)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--b700)', fontWeight: 500 }}>Supported protocols</div>
          <div style={{ fontSize: 11, color: 'var(--b600)', marginTop: 4 }}>MQTT · Modbus TCP · HTTP/REST · OPC-UA</div>
        </div>
      </div>
    </div>
  )
}
