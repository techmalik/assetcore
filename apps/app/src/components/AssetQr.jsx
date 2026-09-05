import { useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'

// A label encodes a URL rather than a bare AIN so a phone's stock camera app
// opens the asset directly. /scan also accepts a bare AIN, for scanners that
// only emit text.
export function assetQrValue(ain) {
  return `${window.location.origin}/scan?ain=${encodeURIComponent(ain)}`
}

export function AssetQrCode({ ain, size = 128 }) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ background: '#fff', padding: 8, borderRadius: 4, border: '1px solid var(--n200)' }}>
        <QRCodeSVG value={assetQrValue(ain)} size={size} level="M" marginSize={0} />
      </div>
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n600)' }}>{ain}</span>
    </div>
  )
}

// Printable sheet of labels. The preview below is the print source: on Print we
// copy its markup into a bare window, so what you see is what comes out.
export function PrintQrSheet({ assets, onClose }) {
  const sheetRef = useRef(null)

  function print() {
    const markup = sheetRef.current?.innerHTML
    if (!markup) return
    const w = window.open('', '_blank', 'width=900,height=1000')
    if (!w) { alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return }
    w.document.write(`<!doctype html><html><head><title>Asset labels</title><style>
      @page { margin: 12mm; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
      .sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10mm 6mm; }
      .label { border: 1px solid #d5d5d5; border-radius: 4px; padding: 8px; text-align: center; page-break-inside: avoid; }
      .ain { font-family: ui-monospace, monospace; font-size: 10px; margin-top: 5px; font-weight: 600; }
      .nm { font-size: 9px; color: #555; margin-top: 2px; line-height: 1.25; }
    </style></head><body><div class="sheet">${markup}</div></body></html>`)
    w.document.close()
    w.focus()
    // Give the document a tick to lay out before the print dialog measures it.
    setTimeout(() => w.print(), 300)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.4)' }} />
      <div style={{ position: 'relative', width: 640, maxHeight: '84vh', background: 'var(--n0)', borderRadius: 10, boxShadow: 'var(--sh-lg)', zIndex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 24px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--ff-d)', fontSize: 17, fontWeight: 700, color: 'var(--n950)' }}>Print asset labels</h3>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>{assets.length} label{assets.length === 1 ? '' : 's'} · 4 per row</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: 'var(--n50)' }}>
          <div ref={sheetRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {assets.map((a) => (
              <div key={a.id} className="label" style={{ border: '1px solid #d5d5d5', borderRadius: 4, padding: 8, textAlign: 'center', background: '#fff' }}>
                <QRCodeSVG value={assetQrValue(a.ain)} size={96} level="M" marginSize={0} />
                <div className="ain" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, marginTop: 5, fontWeight: 600, color: '#111' }}>{a.ain}</div>
                <div className="nm" style={{ fontSize: 9, color: '#555', marginTop: 2, lineHeight: 1.25 }}>{a.name}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px 24px', borderTop: 'var(--bdr)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary" style={{ height: 36, padding: '0 16px', fontSize: 13 }}>Close</button>
          <button type="button" onClick={print} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Print</button>
        </div>
      </div>
    </div>
  )
}
