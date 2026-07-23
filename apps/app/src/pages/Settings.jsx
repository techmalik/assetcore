import { useState, useEffect } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import { api } from '../lib/apiClient'
import { SUPPORT_EMAIL } from '../lib/instance'
import { getLicence, licenceDaysRemaining } from '../lib/db/licence'

function SuccessBanner({ msg }) {
  if (!msg) return null
  return (
    <div style={{ background: 'var(--sgb)', border: '1px solid var(--sgbr)', borderRadius: 4, padding: '8px 14px', fontSize: 13, color: 'var(--sgt)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7l3 3 6-6" stroke="var(--sgt)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {msg}
    </div>
  )
}

function ErrorBanner({ msg }) {
  if (!msg) return null
  return (
    <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 14px', fontSize: 13, color: 'var(--srt)', marginBottom: 16 }}>{msg}</div>
  )
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab() {
  const { fullName, initials } = useAuth()
  const [form, setForm] = useState({ full_name: '', phone: '' })
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving]   = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [ok, setOk]     = useState(null)
  const [err, setErr]   = useState(null)
  const [pwOk, setPwOk] = useState(null)
  const [pwErr, setPwErr] = useState(null)

  useEffect(() => {
    api.get('/profile')
      .then(data => { if (data) setForm({ full_name: data.full_name || '', phone: data.phone || '' }) })
      .catch(() => {})
  }, [])

  const saveProfile = async () => {
    setSaving(true); setErr(null); setOk(null)
    try {
      await api.patch('/profile', { full_name: form.full_name, phone: form.phone || null })
      setOk('Profile updated.')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const changePassword = async () => {
    if (!pwForm.current) return setPwErr('Enter your current password.')
    if (pwForm.next !== pwForm.confirm) return setPwErr('Passwords do not match.')
    if (pwForm.next.length < 8) return setPwErr('Password must be at least 8 characters.')
    setPwSaving(true); setPwErr(null); setPwOk(null)
    try {
      await api.post('/auth/change-password', { currentPassword: pwForm.current, newPassword: pwForm.next })
      setPwOk('Password changed successfully.')
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (e) { setPwErr(e.message) }
    finally { setPwSaving(false) }
  }

  const inp = { height: 36, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: 'var(--n0)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--n700)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Avatar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--b700)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 600, color: '#fff' }}>{initials}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--n900)' }}>{fullName || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--n500)' }}>Profile photo coming soon</div>
        </div>
      </div>

      {/* Profile form */}
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Personal details</div>
        <SuccessBanner msg={ok} />
        <ErrorBanner msg={err} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={lbl}>Full name</span>
            <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} style={inp} placeholder="e.g. Adaeze Okeke" />
          </label>
          <label>
            <span style={lbl}>Phone number</span>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inp} placeholder="+234 803 xxx xxxx" />
          </label>
        </div>
        <button onClick={saveProfile} disabled={saving} className="btn btn-primary" style={{ marginTop: 16, height: 36, padding: '0 20px', fontSize: 13 }}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>

      {/* Password */}
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Change password</div>
        <SuccessBanner msg={pwOk} />
        <ErrorBanner msg={pwErr} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={lbl}>Current password</span>
            <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} style={inp} autoComplete="current-password" />
          </label>
          <label>
            <span style={lbl}>New password</span>
            <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} style={inp} placeholder="Min 8 characters" autoComplete="new-password" />
          </label>
          <label>
            <span style={lbl}>Confirm new password</span>
            <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} style={inp} autoComplete="new-password" />
          </label>
        </div>
        <button onClick={changePassword} disabled={pwSaving || !pwForm.next} className="btn btn-secondary" style={{ marginTop: 16, height: 36, padding: '0 20px', fontSize: 13 }}>
          {pwSaving ? 'Updating…' : 'Change password'}
        </button>
      </div>
    </div>
  )
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

function LicenceCard() {
  const [licence, setLicence] = useState(undefined) // undefined = loading, null = none configured
  useEffect(() => {
    getLicence().then(setLicence).catch(() => setLicence(null))
  }, [])

  const daysLeft = licence ? licenceDaysRemaining(licence.expires_at) : null
  const expired = daysLeft !== null && daysLeft < 0

  return (
    <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Licence</div>
      {licence === undefined ? (
        <div style={{ fontSize: 12, color: 'var(--n500)' }}>Loading…</div>
      ) : licence ? (
        <>
          <div className="form-grid" style={{ gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Licensed to</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)' }}>{licence.licensed_to}</div>
            </div>
            {licence.contract_ref && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Contract ref</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)', fontFamily: 'var(--ff-m)' }}>{licence.contract_ref}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Expires</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: expired ? 'var(--srt)' : 'var(--n900)' }}>{fmtDate(licence.expires_at)}</div>
            </div>
            {licence.seats != null && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--n500)', marginBottom: 2 }}>Seats</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)' }}>{licence.seats}</div>
              </div>
            )}
          </div>
          {expired && (
            <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 14px', fontSize: 12, color: 'var(--srt)', marginBottom: 12 }}>
              This licence has expired.
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 12 }}>Licence details are not yet configured for this instance.</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.6 }}>
        For licence terms, renewal, or support, contact <span style={{ color: 'var(--b600)', fontWeight: 500 }}>{SUPPORT_EMAIL}</span>.
      </div>
    </div>
  )
}

// ── Organisation Tab ──────────────────────────────────────────────────────────
function OrgTab() {
  const { org, roleKey } = useAuth()
  const canEdit = can(roleKey, 'org:manage')
  const [form, setForm] = useState({ name: '', short_name: '', region: '' })
  const [saving, setSaving] = useState(false)
  const [ok, setOk]   = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (org) setForm({ name: org.name || '', short_name: org.short_name || '', region: org.region || '' })
  }, [org])

  const save = async () => {
    setSaving(true); setErr(null); setOk(null)
    try {
      await api.patch('/org', { name: form.name, short_name: form.short_name, region: form.region || null })
      setOk('Organisation details saved.')
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const inp = { height: 36, border: '1px solid var(--n200)', borderRadius: 4, padding: '0 10px', fontSize: 13, outline: 'none', background: canEdit ? 'var(--n0)' : 'var(--n50)', color: 'var(--n900)', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--ff-u)' }
  const lbl = { fontSize: 12, fontWeight: 500, color: 'var(--n700)', display: 'block', marginBottom: 4 }

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--n800)', marginBottom: 16 }}>Organisation details</div>
        {!canEdit && (
          <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 4, padding: '8px 14px', fontSize: 12, color: 'var(--n500)', marginBottom: 12 }}>
            Only the Org Owner can edit organisation details.
          </div>
        )}
        <SuccessBanner msg={ok} />
        <ErrorBanner msg={err} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            <span style={lbl}>Organisation name</span>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} disabled={!canEdit} />
          </label>
          <label>
            <span style={lbl}>Short name / trading name</span>
            <input value={form.short_name} onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))} style={inp} disabled={!canEdit} placeholder="e.g. NGML" />
          </label>
          <label>
            <span style={lbl}>Region</span>
            <input value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value }))} style={inp} disabled={!canEdit} placeholder="e.g. South-South" />
          </label>
        </div>
        {canEdit && (
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ marginTop: 16, height: 36, padding: '0 20px', fontSize: 13 }}>
            {saving ? 'Saving…' : 'Save organisation'}
          </button>
        )}
      </div>

      <LicenceCard />
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Settings({ dark, toggleDark }) {
  const [tab, setTab] = useState('profile')

  return (
    <div className="app-shell">
      <Sidebar active="settings" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Settings" dark={dark} toggleDark={toggleDark} />
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '14px 24px 0', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ marginBottom: 12 }}>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Settings</h1>
            </div>
            <div style={{ display: 'flex' }}>
              {[{ k: 'profile', l: 'Profile' }, { k: 'org', l: 'Organisation' }].map(t => (
                <button key={t.k} className={`tab-btn${tab === t.k ? ' active' : ''}`} onClick={() => setTab(t.k)}>{t.l}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'org' && <OrgTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
