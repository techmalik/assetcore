import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { api } from '../lib/apiClient'
import { createSite } from '../lib/db/sites'
import { createCategory } from '../lib/db/categories'

const DEFAULT_CATEGORIES = [
  { name: 'Metering Station', code: 'MTR' },
  { name: 'Compressor', code: 'CMP' },
  { name: 'Pressure Regulator', code: 'REG' },
  { name: 'Valve', code: 'VLV' },
  { name: 'Pipeline', code: 'PIP' },
  { name: 'SCADA / RTU', code: 'SCR' },
  { name: 'ESD Valve', code: 'ESD' },
  { name: 'Metering Skid', code: 'MSK' },
  { name: 'Gas Turbine', code: 'GTU' },
]

const STEPS = ['Welcome', 'Sites', 'Categories']

function StepBar({ step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 40 }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: i < step ? 'var(--b500)' : i === step ? 'var(--b500)' : 'var(--n100)',
              border: i === step ? '2px solid var(--b500)' : 'none',
              fontSize: 12, fontWeight: 600,
              color: i <= step ? '#fff' : 'var(--n400)',
            }}>
              {i < step
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3L10 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                : i + 1}
            </div>
            <span style={{ fontSize: 13, fontWeight: i === step ? 600 : 400, color: i === step ? 'var(--n900)' : i < step ? 'var(--b600)' : 'var(--n400)' }}>{s}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: 1, background: i < step ? 'var(--b300)' : 'var(--n200)', margin: '0 16px' }} />
          )}
        </div>
      ))}
    </div>
  )
}

function SiteRow({ site, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 6, marginBottom: 8 }}>
      <div style={{ width: 32, height: 32, background: 'var(--b50)', border: '1px solid var(--b200)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="6" r="2.5" stroke="var(--b500)" strokeWidth="1.3"/><path d="M7 1C4.24 1 2 3.24 2 6c0 3.75 5 7 5 7s5-3.25 5-7c0-2.76-2.24-5-5-5z" stroke="var(--b500)" strokeWidth="1.3"/></svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)' }}>{site.name}</div>
        <div style={{ fontSize: 11, color: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{site.code}{site.region ? ` · ${site.region}` : ''}</div>
      </div>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', padding: 4 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
      </button>
    </div>
  )
}

function WaitingForAdmin({ orgName }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--n50)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 10, padding: 40, maxWidth: 440, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, background: 'var(--b50)', border: '1px solid var(--b200)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <svg width="26" height="26" viewBox="0 0 28 28" fill="none"><path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b500)" strokeWidth="1.8" fill="none"/><text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b600)">A</text></svg>
        </div>
        <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 20, fontWeight: 700, color: 'var(--n950)', marginBottom: 10 }}>Your administrator is completing setup</h1>
        <p style={{ fontSize: 14, color: 'var(--n600)', lineHeight: 1.7 }}>
          {orgName || 'Your organisation'} is still being configured. You'll get access as soon as the Org Owner finishes adding sites and asset categories.
        </p>
      </div>
    </div>
  )
}

export default function Onboarding() {
  const { org, orgId, roleKey } = useAuth()
  const nav = useNavigate()
  const [step, setStep] = useState(0)

  // Step 1 — sites
  const [sites, setSites] = useState([])
  const [siteForm, setSiteForm] = useState({ name: '', code: '', region: '' })
  const [siteErr, setSiteErr] = useState('')

  // Step 2 — categories
  const [selectedCats, setSelectedCats] = useState(
    DEFAULT_CATEGORIES.slice(0, 7).map((c) => c.code)
  )

  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Only the Org Owner runs the wizard — everyone else waits.
  if (roleKey !== 'owner') return <WaitingForAdmin orgName={org?.name} />

  function addSite() {
    setSiteErr('')
    if (!siteForm.name.trim()) { setSiteErr('Site name is required.'); return }
    if (!siteForm.code.trim()) { setSiteErr('Site code is required.'); return }
    if (sites.find(s => s.code.toLowerCase() === siteForm.code.toLowerCase())) {
      setSiteErr('That code is already used.'); return
    }
    setSites(prev => [...prev, { ...siteForm, name: siteForm.name.trim(), code: siteForm.code.trim().toUpperCase() }])
    setSiteForm({ name: '', code: '', region: '' })
  }

  async function finish() {
    setSaving(true); setErr('')
    try {
      // Create sites
      for (const s of sites) await createSite({ org_id: orgId, ...s })

      // Create selected categories
      const cats = DEFAULT_CATEGORIES.filter(c => selectedCats.includes(c.code))
      for (const c of cats) await createCategory({ org_id: orgId, ...c })

      // Mark org as onboarded
      await api.patch('/org', { settings: { onboarded: true } })

      nav('/dashboard', { replace: true })
    } catch (e) {
      setErr(e.message || 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--n50)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ height: 56, background: 'var(--n0)', borderBottom: '1px solid var(--n200)', display: 'flex', alignItems: 'center', padding: '0 32px', gap: 10 }}>
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none"><path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b500)" strokeWidth="1.8" fill="none"/><text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b600)">A</text></svg>
        <span style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n900)', letterSpacing: '-.2px' }}>AssetCore</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: 'var(--n500)' }}>Setting up <strong style={{ color: 'var(--n800)' }}>{org?.name || '…'}</strong></span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 24px' }}>
        <div style={{ width: '100%', maxWidth: 680 }}>
          <StepBar step={step} />

          {/* ── Step 0: Welcome ─────────────────────────────────── */}
          {step === 0 && (
            <div style={{ background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 10, padding: 40 }}>
              <div style={{ width: 56, height: 56, background: 'var(--b50)', border: '1px solid var(--b200)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <svg width="26" height="26" viewBox="0 0 28 28" fill="none"><path d="M14 2L25 8V20L14 26L3 20V8L14 2Z" stroke="var(--b500)" strokeWidth="1.8" fill="none"/><text x="14" y="18" textAnchor="middle" fontFamily="'Bricolage Grotesque',sans-serif" fontSize="11" fontWeight="700" fill="var(--b600)">A</text></svg>
              </div>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 26, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.4px', marginBottom: 10 }}>
                Welcome to AssetCore
              </h1>
              <p style={{ fontSize: 15, color: 'var(--n600)', lineHeight: 1.7, marginBottom: 32, maxWidth: 480 }}>
                Let's get <strong>{org?.name || 'your organisation'}</strong> set up. We'll add your operational sites, configure asset categories, and you'll be ready to start managing assets in a few minutes.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 36 }}>
                {[
                  ['Add your sites', 'Operational locations — terminals, stations, network segments'],
                  ['Configure categories', 'Asset types relevant to your operation'],
                ].map(([title, desc], i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--b500)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n900)' }}>{title}</div>
                      <div style={{ fontSize: 13, color: 'var(--n500)' }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setStep(1)} style={{ height: 44, padding: '0 28px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                Let's get started →
              </button>
            </div>
          )}

          {/* ── Step 1: Sites ───────────────────────────────────── */}
          {step === 1 && (
            <div style={{ background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 10, padding: 40 }}>
              <h2 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, color: 'var(--n950)', marginBottom: 6 }}>Add your sites</h2>
              <p style={{ fontSize: 14, color: 'var(--n500)', marginBottom: 28 }}>Add at least one operational site. You can add more later from Admin → Sites.</p>

              {/* Existing sites */}
              {sites.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  {sites.map((s, i) => <SiteRow key={i} site={s} onRemove={() => setSites(prev => prev.filter((_, j) => j !== i))} />)}
                </div>
              )}

              {/* Add site form */}
              <div style={{ background: 'var(--n50)', border: '1px solid var(--n200)', borderRadius: 8, padding: 20, marginBottom: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 6 }}>Site name *</label>
                    <input className="input" value={siteForm.name} onChange={e => setSiteForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Lagos DS-04" style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 6 }}>Code *</label>
                    <input className="input" value={siteForm.code} onChange={e => setSiteForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                      placeholder="LAG-DS04" style={{ width: '100%', fontFamily: 'var(--ff-m)' }} maxLength={10} />
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 6 }}>State / Region</label>
                  <input className="input" value={siteForm.region} onChange={e => setSiteForm(p => ({ ...p, region: e.target.value }))}
                    placeholder="e.g. Lagos, Delta, Rivers" style={{ width: '100%' }} />
                </div>
                {siteErr && <p style={{ fontSize: 12, color: 'var(--srt)', marginBottom: 10 }}>{siteErr}</p>}
                <button onClick={addSite} style={{ height: 34, padding: '0 16px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add site
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => setStep(0)} style={{ height: 38, padding: '0 16px', background: 'none', border: '1px solid var(--n200)', borderRadius: 5, fontSize: 13, color: 'var(--n600)', cursor: 'pointer', fontFamily: 'inherit' }}>Back</button>
                <button onClick={() => { if (sites.length === 0) { setSiteErr('Add at least one site to continue.'); return } setStep(2) }}
                  style={{ height: 38, padding: '0 20px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Categories ──────────────────────────────── */}
          {step === 2 && (
            <div style={{ background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 10, padding: 40 }}>
              <h2 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, color: 'var(--n950)', marginBottom: 6 }}>Asset categories</h2>
              <p style={{ fontSize: 14, color: 'var(--n500)', marginBottom: 24 }}>Select the asset types in your operation. You can add custom categories too.</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 }}>
                {DEFAULT_CATEGORIES.map(c => {
                  const on = selectedCats.includes(c.code)
                  return (
                    <button key={c.code} onClick={() => setSelectedCats(p => on ? p.filter(x => x !== c.code) : [...p, c.code])}
                      style={{ height: 44, padding: '0 12px', border: `1px solid ${on ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 6, background: on ? 'var(--b50)' : 'var(--n0)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${on ? 'var(--b500)' : 'var(--n300)'}`, background: on ? 'var(--b500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {on && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2 2L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <span style={{ fontSize: 13, color: on ? 'var(--b700)' : 'var(--n700)', fontWeight: on ? 500 : 400 }}>{c.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--n400)', fontFamily: 'var(--ff-m)', marginLeft: 'auto' }}>{c.code}</span>
                    </button>
                  )
                })}
              </div>

              {err && (
                <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 6, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: 'var(--srt)' }}>{err}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => setStep(1)} style={{ height: 38, padding: '0 16px', background: 'none', border: '1px solid var(--n200)', borderRadius: 5, fontSize: 13, color: 'var(--n600)', cursor: 'pointer', fontFamily: 'inherit' }}>Back</button>
                <button onClick={finish} disabled={saving || selectedCats.length === 0}
                  style={{ height: 44, padding: '0 28px', background: (saving || selectedCats.length === 0) ? 'var(--n200)' : 'var(--b500)', color: (saving || selectedCats.length === 0) ? 'var(--n400)' : '#fff', border: 'none', borderRadius: 6, fontSize: 15, fontWeight: 500, cursor: (saving || selectedCats.length === 0) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                  {saving ? 'Setting up…' : 'Go to dashboard →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
