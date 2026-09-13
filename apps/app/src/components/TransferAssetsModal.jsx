import { useState } from 'react'
import { transferAssets } from '../lib/db/assets'
import { useToast } from '../lib/ToastContext'
import { errorText } from '../lib/errors'

// Why the API skipped an asset, in words. Anything unlisted falls back to a
// generic line rather than showing the code.
const SKIP_REASON = {
  same_site: 'Already at that site',
  not_found: 'Not found, or outside the sites you can see',
}

function todayLocal() {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in the browser's timezone
}

function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--n700)', display: 'block', marginBottom: 5 }}>{label}{required && ' *'}</label>
      {children}
    </div>
  )
}

/**
 * Move one or many assets to another site.
 *
 * The same modal serves the registry's bulk bar and a single asset's detail
 * panel, so there is one place that decides what a transfer asks for. Shut-down
 * sites are listed but disabled: hiding them would leave someone looking for a
 * site they know exists, and the API refuses them anyway.
 *
 * After submit the modal stays open on a summary, because a batch can part
 * succeed — an asset already at the destination is skipped, not failed — and
 * that is worth reading before the list refreshes underneath it.
 */
export default function TransferAssetsModal({ assets, sites, locations, onClose, onDone }) {
  const toast = useToast()
  const [locationId, setLocationId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  const inputProps = { className: 'input', style: { width: '100%' } }
  const sitesForLocation = locationId ? sites.filter((s) => s.location_id === locationId) : []
  // Sites with no location still need to be reachable as a destination.
  const unlocated = sites.filter((s) => !s.location_id)
  const siteName = (id) => sites.find((s) => s.id === id)?.name
  const byId = new Map(assets.map((a) => [a.id, a]))

  async function submit(e) {
    e.preventDefault()
    if (!siteId) { setErr('Choose the site to move to.'); return }
    if (date && date > todayLocal()) { setErr('A transfer date cannot be in the future.'); return }
    setSaving(true); setErr('')
    try {
      const res = await transferAssets({ assetIds: assets.map((a) => a.id), toSiteId: siteId, reason: reason.trim(), transferredAt: date })
      setResult(res)
      if (res.transferred > 0) toast.success(`${res.transferred} asset${res.transferred !== 1 ? 's' : ''} moved to ${siteName(siteId) || 'the new site'}.`)
      else toast.error('Nothing was moved.')
    } catch (ex) {
      setErr(errorText(ex, 'Transfer failed.'))
    } finally {
      setSaving(false)
    }
  }

  function finish() {
    if (result) onDone()
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={finish} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <form onSubmit={submit} style={{ position: 'relative', width: 500, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto', background: 'var(--n0)', borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,.2)', padding: 24, zIndex: 1 }}>
        <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', marginBottom: 4 }}>
          Transfer {assets.length === 1 ? 'asset' : `${assets.length} assets`}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--n500)', marginBottom: 14, lineHeight: 1.5 }}>
          Open work orders, PM tasks and inspections move with each asset. An asset that was Inactive because its
          old site was shut down gets its previous status back.
        </p>

        <div style={{ maxHeight: 160, overflowY: 'auto', border: 'var(--bdr)', borderRadius: 6, marginBottom: 14 }}>
          {assets.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 10px', fontSize: 12, borderBottom: i < assets.length - 1 ? 'var(--bdr)' : 'none' }}>
              <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--b700)', width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.ain}</span>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--n800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <span style={{ flexShrink: 0, color: 'var(--n500)' }}>{a.site?.name || 'No site'}</span>
            </div>
          ))}
        </div>

        {result ? (
          <div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--sgt)', fontWeight: 600 }}>{result.transferred} moved</span>
              <span style={{ fontSize: 13, color: result.skipped.length ? 'var(--sat)' : 'var(--n500)', fontWeight: 600 }}>{result.skipped.length} skipped</span>
            </div>
            {result.skipped.length > 0 && (
              <div style={{ maxHeight: 160, overflowY: 'auto', border: 'var(--bdr)', borderRadius: 6 }}>
                {result.skipped.map((s, i) => (
                  <div key={s.asset_id} style={{ display: 'flex', gap: 8, padding: '6px 10px', fontSize: 12, borderBottom: i < result.skipped.length - 1 ? 'var(--bdr)' : 'none' }}>
                    <span style={{ fontFamily: 'var(--ff-m)', color: 'var(--n700)', width: 120, flexShrink: 0 }}>{byId.get(s.asset_id)?.ain || s.asset_id.slice(0, 8)}</span>
                    <span style={{ color: 'var(--n500)', flex: 1 }}>{SKIP_REASON[s.reason] || 'Not moved'}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button type="button" onClick={finish} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-grid" style={{ gap: 12 }}>
                <Field label="Destination location" required>
                  <select {...inputProps} value={locationId} onChange={(e) => { setLocationId(e.target.value); setSiteId('') }}>
                    <option value="">Select location…</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    {unlocated.length > 0 && <option value="__none">No location</option>}
                  </select>
                </Field>
                <Field label="Destination site" required>
                  <select {...inputProps} value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={!locationId}>
                    <option value="">{!locationId ? 'Select a location first' : 'Select site…'}</option>
                    {(locationId === '__none' ? unlocated : sitesForLocation).map((s) => (
                      <option key={s.id} value={s.id} disabled={s.status === 'shutdown'}>
                        {s.name}{s.status === 'shutdown' ? ' (shut down)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Transfer date">
                <input {...inputProps} type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Reason">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="input"
                  style={{ width: '100%', height: 'auto', padding: '8px 10px', resize: 'vertical' }}
                  placeholder="e.g. Relocated to Warri after the Escravos shutdown" />
              </Field>
            </div>
            {err && <p style={{ fontSize: 12, color: 'var(--srt)', marginTop: 12 }}>{err}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Cancel</button>
              <button type="submit" disabled={saving || !siteId} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13, opacity: saving || !siteId ? 0.7 : 1 }}>
                {saving ? 'Moving…' : `Transfer ${assets.length === 1 ? 'asset' : `${assets.length} assets`}`}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
