import { useState, useEffect, useCallback } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import { listIntegrations, upsertIntegration, triggerSync } from '../lib/db/integrations'

// ── Integration card configs ──────────────────────────────────────────────────
const INTEGRATION_DEFS = [
  {
    kind: 'sap',
    name: 'SAP S/4HANA',
    category: 'ERP',
    logo: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="6" fill="#0070F2" />
        <text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="sans-serif">SAP</text>
      </svg>
    ),
    desc: 'Sync asset master data from SAP Plant Maintenance. Push work orders and equipment status back to SAP PM.',
    dataFlows: [
      { dir: '←', label: 'Asset master data (Equipment Master)', from: 'SAP PM' },
      { dir: '→', label: 'Work order status updates',            from: 'AssetCore' },
      { dir: '←', label: 'Material catalogue / spare parts',     from: 'SAP MM' },
    ],
    fields: [
      { key: 'system_url',  label: 'System URL',      placeholder: 'https://s4hana.company.com', type: 'text' },
      { key: 'client',      label: 'Client number',   placeholder: '100', type: 'text' },
      { key: 'username',    label: 'RFC username',     placeholder: 'ASSETCORE_RFC', type: 'text' },
    ],
    secretNote: 'RFC password is stored in this database and never displayed after entry.',
    syncLabel: 'Sync asset master',
  },
  {
    kind: 'termii',
    name: 'Termii SMS',
    category: 'Notifications',
    logo: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="6" fill="#6C47FF" />
        <path d="M8 10h16M8 16h10M8 22l4-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    desc: 'Send SMS alerts for critical work orders, overdue inspections, and compliance expiry to field technicians in Nigeria.',
    dataFlows: [
      { dir: '→', label: 'Critical WO assignments & escalations', from: 'AssetCore' },
      { dir: '→', label: 'Compliance expiry warnings',             from: 'AssetCore' },
      { dir: '→', label: 'PM due reminders',                       from: 'AssetCore' },
    ],
    fields: [
      { key: 'sender_id', label: 'Sender ID', placeholder: 'ASSETCORE', type: 'text' },
    ],
    secretNote: 'API key is stored in this database and never displayed after entry.',
    syncLabel: 'Send test SMS',
    hasToggle: true,
  },
  {
    kind: 'scada',
    name: 'SCADA / Historian',
    category: 'Telemetry',
    logo: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="6" fill="var(--n700)" />
        <path d="M6 22l5-7 5 3 5-8 5 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    desc: 'Connect to your SCADA historian (OSIsoft PI, Wonderware, or custom OPC-UA endpoint) to stream process data into asset telemetry.',
    comingSoon: true,
  },
]

function StatusBadge({ row }) {
  if (!row) return <span style={{ fontSize: 11, color: 'var(--n400)' }}>Not configured</span>
  if (!row.enabled) return <span style={{ fontSize: 11, color: 'var(--n500)' }}>Disabled</span>
  if (row.last_sync_status === 'error') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--srt)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sr)' }} />
      Error — {row.last_sync_error?.slice(0, 40) || 'Unknown'}
    </span>
  )
  if (row.last_synced_at) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--sgt)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sg)' }} />
      Last synced {new Date(row.last_synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--sgt)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sg)' }} />
      Configured
    </span>
  )
}

// ── Single integration card ────────────────────────────────────────────────────
function IntegrationCard({ def, row, canEdit, onSaved }) {
  const [expanded, setExpanded] = useState(false)
  const [form, setForm]         = useState(() => {
    const cfg = row?.config || {}
    const out = { enabled: row?.enabled || false }
    for (const f of (def.fields || [])) out[f.key] = cfg[f.key] || ''
    return out
  })
  const [saving, setSaving]   = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [saved, setSaved]     = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      const config = {}
      for (const f of (def.fields || [])) config[f.key] = form[f.key] || null
      await upsertIntegration(def.kind, { label: def.name, config, enabled: form.enabled })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      onSaved()
    } catch { /* non-fatal */ }
    finally { setSaving(false) }
  }

  const sync = async () => {
    setSyncing(true)
    try { await triggerSync(def.kind); onSaved() }
    catch { /* non-fatal */ }
    finally { setSyncing(false) }
  }

  const inp = { height: 34, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: 'var(--n0)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }

  return (
    <div style={{ background: 'var(--n0)', border: `var(--bdr)`, borderRadius: 8, overflow: 'hidden' }}>
      {/* Card header */}
      <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ flexShrink: 0 }}>{def.logo}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--n900)' }}>{def.name}</span>
            <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--n500)', background: 'var(--n100)', border: '1px solid var(--n200)', borderRadius: 2, padding: '1px 6px' }}>{def.category}</span>
            {def.comingSoon && <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--b600)', background: 'var(--b50)', border: '1px solid var(--b100)', borderRadius: 2, padding: '1px 6px' }}>Coming soon</span>}
          </div>
          <p style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.6, marginBottom: 8 }}>{def.desc}</p>
          <StatusBadge row={row} />
        </div>
        {!def.comingSoon && canEdit && (
          <button onClick={() => setExpanded(e => !e)} style={{ height: 30, padding: '0 12px', border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', fontSize: 12, color: 'var(--n700)', cursor: 'pointer', flexShrink: 0 }}>
            {expanded ? 'Close' : row ? 'Edit' : 'Configure'}
          </button>
        )}
      </div>

      {/* Data flow pills */}
      {def.dataFlows && (
        <div style={{ padding: '0 20px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {def.dataFlows.map((f, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4, background: 'var(--n50)', border: 'var(--bdr)', fontSize: 11, color: 'var(--n700)' }}>
              <span style={{ fontWeight: 700, color: f.dir === '←' ? 'var(--b600)' : 'var(--sgt)', fontFamily: 'var(--ff-m)' }}>{f.dir}</span>
              {f.label}
              <span style={{ color: 'var(--n400)' }}>from {f.from}</span>
            </div>
          ))}
        </div>
      )}

      {/* Config form */}
      {expanded && !def.comingSoon && (
        <div style={{ borderTop: 'var(--bdr)', padding: '18px 20px', background: 'var(--n50)' }}>
          {def.hasToggle && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
              <div
                onClick={() => set('enabled', !form.enabled)}
                style={{ width: 36, height: 20, borderRadius: 10, background: form.enabled ? 'var(--b500)' : 'var(--n300)', transition: 'background .2s', position: 'relative', flexShrink: 0, cursor: 'pointer' }}
              >
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: form.enabled ? 18 : 2, transition: 'left .2s' }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--n800)' }}>{form.enabled ? 'Enabled' : 'Disabled'}</span>
              <span style={{ fontSize: 11, color: 'var(--n500)' }}>— SMS notifications will {form.enabled ? 'be sent' : 'not be sent'}</span>
            </label>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            {(def.fields || []).map(f => (
              <label key={f.key} style={{ fontSize: 12, fontWeight: 500, color: 'var(--n800)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {f.label}
                <input type={f.type} value={form[f.key]} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} style={{ ...inp, maxWidth: 360 }} />
              </label>
            ))}
          </div>
          {def.secretNote && (
            <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--n400)" strokeWidth="1.2" /><path d="M7 6v4M7 4.5v.5" stroke="var(--n400)" strokeWidth="1.2" strokeLinecap="round" /></svg>
              {def.secretNote}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} className="btn btn-primary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>
              {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Configuration'}
            </button>
            {row?.enabled && (
              <button onClick={sync} disabled={syncing} className="btn btn-secondary" style={{ height: 34, padding: '0 14px', fontSize: 13 }}>
                {syncing ? 'Running…' : def.syncLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Integrations({ dark, toggleDark }) {
  const { roleKey } = useAuth()
  const canEdit = can(roleKey, 'integration:manage')
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await listIntegrations()) }
    catch { /* non-fatal — table may not exist yet */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const rowByKind = Object.fromEntries(rows.map(r => [r.kind, r]))

  return (
    <div className="app-shell">
      <Sidebar active="integrations" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Integrations" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '20px 24px', maxWidth: 860 }}>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Integrations</h1>
              <p style={{ fontSize: 12, color: 'var(--n500)', marginTop: 2 }}>Connect AssetCore to your ERP, SMS, and SCADA systems. Secrets are stored in this database and never displayed after entry.</p>
            </div>

            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {INTEGRATION_DEFS.map(def => (
                  <IntegrationCard
                    key={def.kind}
                    def={def}
                    row={rowByKind[def.kind] || null}
                    canEdit={canEdit}
                    onSaved={load}
                  />
                ))}
              </div>
            )}

            {/* Dev note */}
            <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', marginBottom: 4 }}>Connector wiring</div>
              <div style={{ fontSize: 11, color: 'var(--n500)', lineHeight: 1.7 }}>
                SAP sync, Termii SMS, and telemetry ingest are commissioned per client engagement — contact AssetCore support to enable them for this instance.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
