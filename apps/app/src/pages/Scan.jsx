import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import jsQR from 'jsqr'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { getAssetByAin } from '../lib/db/assets'
import { errorText } from '../lib/errors'
import { useToast } from '../lib/ToastContext'

const CRITICALITY_CLASS = { critical: 'badge-r', high: 'badge-a', medium: 'badge-b', low: 'badge-n' }
const STATUS_CLASS = { critical: 'badge-r', attention: 'badge-a', operational: 'badge-g', offline: 'badge-n' }

// A label encodes {origin}/scan?ain=XXX, but a generic barcode scanner may emit
// the bare tag instead — accept either.
function tagFromScan(text) {
  try {
    const url = new URL(text)
    return url.searchParams.get('ain') || text
  } catch {
    return text.trim()
  }
}

function Field({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
      <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right', fontFamily: mono ? 'var(--ff-m)' : 'inherit' }}>{value || '—'}</span>
    </div>
  )
}

export default function Scan({ dark, toggleDark }) {
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [manual, setManual] = useState('')
  const [asset, setAsset] = useState(null)
  const [error, setError] = useState('')
  const [looking, setLooking] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef = useRef(null)

  const lookup = useCallback(async (rawTag, { fromCamera = false } = {}) => {
    const tag = tagFromScan(rawTag)
    if (!tag) return
    setLooking(true)
    setError('')
    setAsset(null)
    try {
      const found = await getAssetByAin(tag)
      setAsset(found)
      setManual(found.ain)
      // A successful camera scan closes the camera — without this the preview
      // just vanishes and the only evidence is a card further down the page,
      // which reads as the camera crashing.
      if (fromCamera) toast.success(`Scanned ${found.ain} — ${found.name}`)
    } catch (e) {
      setError(e.status === 404 ? `No asset with tag "${tag}" in this organisation.` : errorText(e, 'Lookup failed.'))
    } finally {
      setLooking(false)
    }
  }, [toast])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }, [])

  // A label scanned from the camera goes straight to lookup, then the camera
  // stops — leaving it running would re-fire on the same code every frame.
  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    // A frame can report HAVE_ENOUGH_DATA before it has dimensions; asking
    // for a 0x0 image throws inside the rAF callback and kills the loop, so
    // the camera stays on and silently stops scanning.
    if (!video.videoWidth || !video.videoHeight) {
      rafRef.current = requestAnimationFrame(tick)
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
    if (code?.data) {
      stopCamera()
      lookup(code.data, { fromCamera: true })
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [lookup, stopCamera])

  async function startCamera() {
    setCameraError('')
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      setScanning(true)
      // The <video> only exists once scanning is true, so attach on the next frame.
      requestAnimationFrame(() => {
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
        rafRef.current = requestAnimationFrame(tick)
      })
    } catch (e) {
      setCameraError(
        e.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow it in your browser settings, or type the tag below.'
          : 'No camera available on this device. Type the tag below instead.'
      )
    }
  }

  // Deep link from a phone camera: /scan?ain=NGML-MTR-0042
  useEffect(() => {
    const ain = params.get('ain')
    if (ain) { setManual(ain); lookup(ain) }
  }, [params, lookup])

  useEffect(() => stopCamera, [stopCamera])

  return (
    <div className="app-shell">
      <Sidebar active="assets" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Scan Asset" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Scan asset tag</h1>
              <p style={{ fontSize: 12.5, color: 'var(--n500)', marginTop: 2 }}>
                {asset
                  ? 'Scanned. Open it in the registry below, or scan another tag.'
                  : 'Point the camera at a label, or type the AIN if the sticker is damaged.'}
              </p>
            </div>

            {/* Result first: arriving here from a phone's camera (or from a
                scan that just closed the camera), the answer is what you came
                for — the camera and the manual field are how you ask again. */}
            {error && (
              <div style={{ background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: 'var(--srt)' }}>
                {error}
              </div>
            )}
            {asset && (
              <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', borderBottom: 'var(--bdr)' }}>
                  <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{asset.ain}</div>
                  <div style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{asset.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <span className={`badge ${STATUS_CLASS[asset.status] || 'badge-n'}`}>{asset.status}</span>
                    <span className={`badge ${CRITICALITY_CLASS[asset.criticality] || 'badge-n'}`}>{asset.criticality} criticality</span>
                    {asset.site && <span className="badge badge-n">{asset.site.name}</span>}
                  </div>
                </div>
                <Field label="Category" value={asset.category?.name} />
                {/* The asset form and the CSV importer both write these three
                    into specs, while the assets table also carries real
                    columns for them that nothing populates. Reading only the
                    columns left every scanned label showing '—' for the three
                    fields a technician standing at the asset most wants.
                    Column first so a future migration that fills them wins. */}
                <Field label="Manufacturer" value={[asset.manufacturer ?? asset.specs?.manufacturer, asset.model ?? asset.specs?.model].filter(Boolean).join(' ')} />
                <Field label="Serial number" value={asset.serial_number ?? asset.specs?.serial_number} mono />
                <Field label="Installed" value={asset.install_date} mono />
                <Field label="Warranty expires" value={asset.warranty_expiry} mono />
                <Field label="Custodian" value={asset.custodian?.full_name} />
                <div style={{ padding: 14 }}>
                  <button onClick={() => nav(`/assets?ain=${encodeURIComponent(asset.ain)}`)} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>
                    Open in registry
                  </button>
                </div>
              </div>
            )}
            {/* Camera */}
            <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, overflow: 'hidden' }}>
              {scanning ? (
                <div style={{ position: 'relative', background: '#000' }}>
                  <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block', maxHeight: 340, objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: '15% 22%', border: '2px solid rgba(255,255,255,.85)', borderRadius: 8, pointerEvents: 'none' }} />
                  <button onClick={stopCamera} className="btn btn-secondary" style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', height: 32, padding: '0 14px', fontSize: 12 }}>
                    Stop camera
                  </button>
                </div>
              ) : (
                <div style={{ padding: 24, textAlign: 'center' }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 10px', display: 'block' }}>
                    <path d="M3 8V5a2 2 0 012-2h3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M21 16v3a2 2 0 01-2 2h-3" stroke="var(--n400)" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="M3 12h18" stroke="var(--b500)" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <button onClick={startCamera} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>{asset ? 'Scan another tag' : 'Start camera'}</button>
                  {cameraError && <p style={{ fontSize: 12, color: 'var(--sat)', marginTop: 10 }}>{cameraError}</p>}
                </div>
              )}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>
            {/* Manual entry */}
            <form
              onSubmit={(e) => { e.preventDefault(); lookup(manual) }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input
                className="input"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                // Explicit rather than relying on the form's implicit submit:
                // a phone keyboard's Go key is the natural way to finish
                // typing a tag, and it is not worth it failing quietly if a
                // browser declines to submit implicitly.
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(manual) } }}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. NGML-MTR-0042"
                style={{ flex: 1, fontFamily: 'var(--ff-m)' }}
              />
              <button type="submit" disabled={looking || !manual.trim()} className="btn btn-secondary" style={{ height: 38, padding: '0 16px', fontSize: 13 }}>
                {looking ? 'Looking…' : 'Find'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
