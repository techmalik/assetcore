import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'
import { getLicence, licenceDaysRemaining } from '../lib/db/licence'
import { SUPPORT_EMAIL } from '../lib/instance'

const WARN_DAYS = 60
// Soft licence enforcement only — this banner never blocks usage, and is
// shown only to the roles who'd act on it (renewal is an owner/ops concern).
const VISIBLE_ROLES = ['owner', 'ops_manager']

export default function LicenceBanner() {
  const { authed, roleKey } = useAuth()
  const [licence, setLicence] = useState(null)
  const visible = authed && VISIBLE_ROLES.includes(roleKey)

  useEffect(() => {
    if (!visible) { setLicence(null); return }
    let cancelled = false
    getLicence().then((l) => { if (!cancelled) setLicence(l) }).catch(() => {})
    return () => { cancelled = true }
  }, [visible])

  if (!visible || !licence?.expires_at) return null
  const daysLeft = licenceDaysRemaining(licence.expires_at)
  if (daysLeft > WARN_DAYS) return null

  const expired = daysLeft < 0

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 400,
      background: expired ? 'var(--sr)' : 'var(--sa)', color: '#fff',
      fontSize: 12, fontWeight: 500, textAlign: 'center', padding: '6px 16px',
    }}>
      {expired ? 'Licence expired' : `Licence expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
      {' — contact '}
      <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#fff', textDecoration: 'underline' }}>{SUPPORT_EMAIL}</a>
      {' to renew.'}
    </div>
  )
}
