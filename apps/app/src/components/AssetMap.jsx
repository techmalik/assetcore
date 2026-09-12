import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

/**
 * Where the assets are.
 *
 * Two layers, and the second is optional on purpose:
 *
 *  - Positions are always drawn from each asset's own coordinates, projected
 *    in Web Mercator. This never needs the network.
 *  - A raster basemap sits behind them when the *viewer's browser* can reach a
 *    tile server. A licensed instance may sit on a plant network with no route
 *    out, and a map that renders as grey squares is worse than no map at all —
 *    so a failed tile is not an error state: the tiles are dropped, a graticule
 *    is drawn instead, and the assets keep their true relative positions.
 *
 * The tile source is configurable per instance (VITE_MAP_TILE_URL), so a client
 * with their own tile server points at it, and VITE_MAP_TILES=off turns the
 * basemap off entirely for an air-gapped deployment that would rather not have
 * browsers reaching out at all.
 */

const TILES_ENABLED = import.meta.env.VITE_MAP_TILES !== 'off'
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '© OpenStreetMap contributors'
const TILE_SIZE = 256
const MIN_ZOOM = 2
const MAX_ZOOM = 18

const STATUS_COLOR = {
  operational: 'var(--sg)',
  attention: 'var(--sa)',
  critical: 'var(--sr)',
  offline: 'var(--n400)',
}

const CRITICALITY_COLOR = {
  critical: 'var(--sr)',
  high: 'var(--sa)',
  medium: 'var(--sl)',
  low: 'var(--sg)',
}

/** Colour scales, also used to draw the legend so the two cannot drift apart. */
export const MAP_COLOUR_MODES = {
  status: {
    label: 'Condition',
    legend: [['Operational', 'var(--sg)'], ['Needs attention', 'var(--sa)'], ['Critical', 'var(--sr)'], ['Offline', 'var(--n400)']],
    of: (a) => STATUS_COLOR[a.status] || 'var(--n400)',
  },
  health: {
    label: 'Health score',
    legend: [['70 and above', 'var(--sg)'], ['40–69', 'var(--sa)'], ['Below 40', 'var(--sr)'], ['Not scored', 'var(--n300)']],
    of: (a) => (a.health_score == null ? 'var(--n300)' : a.health_score < 40 ? 'var(--sr)' : a.health_score < 70 ? 'var(--sa)' : 'var(--sg)'),
  },
  criticality: {
    label: 'Criticality',
    legend: [['Critical', 'var(--sr)'], ['High', 'var(--sa)'], ['Medium', 'var(--sl)'], ['Low', 'var(--sg)']],
    of: (a) => CRITICALITY_COLOR[a.criticality] || 'var(--n400)',
  },
  work: {
    label: 'Open work',
    legend: [['Open defect', 'var(--sr)'], ['Open work order', 'var(--sa)'], ['Nothing outstanding', 'var(--sg)']],
    of: (a) => (a.open_defects > 0 ? 'var(--sr)' : a.open_work_orders > 0 ? 'var(--sa)' : 'var(--sg)'),
  },
}

// ── Web Mercator ─────────────────────────────────────────────────────────────
const worldSize = (zoom) => TILE_SIZE * 2 ** zoom

function project(lat, lng, zoom) {
  const size = worldSize(zoom)
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const sin = Math.sin((clampedLat * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  }
}

function unproject(x, y, zoom) {
  const size = worldSize(zoom)
  const lng = (x / size) * 360 - 180
  const n = Math.PI - 2 * Math.PI * (y / size)
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

/** Metres per pixel at this latitude and zoom — for the scale bar. */
const metresPerPixel = (lat, zoom) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom

function niceDistance(metres) {
  if (metres >= 1000) {
    const km = metres / 1000
    const step = km >= 200 ? 200 : km >= 100 ? 100 : km >= 50 ? 50 : km >= 20 ? 20 : km >= 10 ? 10 : km >= 5 ? 5 : km >= 2 ? 2 : 1
    return { metres: step * 1000, label: `${step} km` }
  }
  const step = metres >= 500 ? 500 : metres >= 200 ? 200 : metres >= 100 ? 100 : metres >= 50 ? 50 : 20
  return { metres: step, label: `${step} m` }
}

/** The view that fits every asset, with a margin so no pin sits on an edge. */
function fitView(assets, width, height) {
  const lats = assets.map((a) => Number(a.lat))
  const lngs = assets.map((a) => Number(a.lng))
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const centre = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }

  // A single asset (or several on one spot) has no span to fit — pick a
  // street-level zoom rather than dividing by zero and landing at zoom 18.
  if (maxLat - minLat < 1e-7 && maxLng - minLng < 1e-7) return { centre, zoom: 15 }

  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const a = project(minLat, minLng, z)
    const b = project(maxLat, maxLng, z)
    if (Math.abs(b.x - a.x) < width * 0.8 && Math.abs(b.y - a.y) < height * 0.8) return { centre, zoom: z }
  }
  return { centre, zoom: MIN_ZOOM }
}

function Pin({ colour, size = 26, ring }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' }}>
      <path d="M12 23s8-7.2 8-13A8 8 0 0 0 4 10c0 5.8 8 13 8 13Z" fill={colour} stroke={ring || 'var(--n0)'} strokeWidth="1.6" />
      <circle cx="12" cy="10" r="3" fill="var(--n0)" opacity=".95" />
    </svg>
  )
}

export default function AssetMap({
  assets = [],
  unplaced = 0,
  colourBy = 'status',
  onSelect,
  height = 420,
  selectedId = null,
  showLegend = true,
  note = true,
  /** Embedded in a panel rather than being the page: a vertical touch drag
   *  belongs to the page's scroll there, not to the map. */
  embedded = false,
}) {
  const boxRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: height })
  const [view, setView] = useState(null) // { centre: {lat,lng}, zoom }
  const [active, setActive] = useState(null) // asset id whose card is open
  const [tilesOk, setTilesOk] = useState(TILES_ENABLED)
  const tileErrors = useRef(0)
  const drag = useRef(null)
  const pointers = useRef(new Map())
  const pinch = useRef(null)

  const placed = useMemo(() => assets.filter((a) => a.lat != null && a.lng != null), [assets])
  // Refit when the set of assets changes, not on every render of the same set.
  const fitKey = useMemo(() => placed.map((a) => a.id).join(','), [placed])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect
      setSize((s) => (s.w === width ? s : { w: width, h: height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  useEffect(() => {
    if (!placed.length || !size.w) return
    setView(fitView(placed, size.w, size.h))
  }, [fitKey, size.w, size.h]) // eslint-disable-line react-hooks/exhaustive-deps

  const onTileError = useCallback(() => {
    tileErrors.current += 1
    // Three failures is not a slow network, it is no network. Drop the basemap
    // rather than leaving the map half-drawn.
    if (tileErrors.current >= 3) setTilesOk(false)
  }, [])

  // ── Pan and zoom ───────────────────────────────────────────────────────────
  const panBy = useCallback((dx, dy) => {
    setView((v) => {
      if (!v) return v
      const c = project(v.centre.lat, v.centre.lng, v.zoom)
      return { ...v, centre: unproject(c.x - dx, c.y - dy, v.zoom) }
    })
  }, [])

  const zoomBy = useCallback((delta) => {
    setView((v) => (v ? { ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + delta)) } : v))
  }, [])

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom, which is how anyone holding a tablet
      // expects to get closer.
      const [a, b] = [...pointers.current.values()]
      pinch.current = { start: distance(a, b), zoom: view?.zoom ?? MIN_ZOOM }
      drag.current = null
      return
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const d = distance(a, b)
      if (pinch.current.start > 0 && d > 0) {
        const next = pinch.current.zoom + Math.log2(d / pinch.current.start)
        setView((v) => (v ? { ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)) } : v))
      }
      return
    }

    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.current.moved = true
    drag.current.x = e.clientX
    drag.current.y = e.clientY
    panBy(dx, dy)
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const moved = drag.current?.moved
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    // A drag that ends over the map background should not also close the card.
    if (!moved) setActive(null)
  }

  if (!placed.length) {
    return (
      <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px dashed var(--n200)', borderRadius: 8, textAlign: 'center', padding: 24 }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11Z" stroke="var(--n300)" strokeWidth="1.4" />
          <circle cx="12" cy="10" r="2.4" stroke="var(--n300)" strokeWidth="1.4" />
        </svg>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--n600)' }}>Nothing to place on a map</p>
        <p style={{ fontSize: 12.5, color: 'var(--n500)', maxWidth: 380, lineHeight: 1.6 }}>
          {unplaced > 0
            ? `${unplaced} asset${unplaced === 1 ? ' has' : 's have'} no latitude and longitude. Add them on the asset record and they will appear here.`
            : 'Add a latitude and longitude to an asset record and it will appear here.'}
        </p>
      </div>
    )
  }

  const mode = MAP_COLOUR_MODES[colourBy] || MAP_COLOUR_MODES.status
  const centre = view ? project(view.centre.lat, view.centre.lng, view.zoom) : null
  const originX = centre ? centre.x - size.w / 2 : 0
  const originY = centre ? centre.y - size.h / 2 : 0
  const toScreen = (a) => {
    const p = project(Number(a.lat), Number(a.lng), view.zoom)
    return { left: p.x - originX, top: p.y - originY }
  }

  // Tiles covering the viewport, plus one row/column of margin so a pan does
  // not reveal blank edges before the next render.
  const tiles = []
  if (view && tilesOk && size.w) {
    const z = Math.round(view.zoom)
    const scale = 2 ** (view.zoom - z)
    const tileSpan = TILE_SIZE * scale
    const x0 = Math.floor(originX / tileSpan) - 1
    const y0 = Math.floor(originY / tileSpan) - 1
    const x1 = Math.ceil((originX + size.w) / tileSpan) + 1
    const y1 = Math.ceil((originY + size.h) / tileSpan) + 1
    const max = 2 ** z
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= max) continue
      for (let tx = x0; tx <= x1; tx++) {
        const wrapped = ((tx % max) + max) % max
        tiles.push({
          key: `${z}/${wrapped}/${ty}/${tx}`,
          url: TILE_URL.replace('{z}', z).replace('{x}', wrapped).replace('{y}', ty),
          left: tx * tileSpan - originX,
          top: ty * tileSpan - originY,
          span: tileSpan,
        })
      }
    }
  }

  const scale = view ? niceDistance(metresPerPixel(view.centre.lat, view.zoom) * 90) : null
  const scalePx = view && scale ? scale.metres / metresPerPixel(view.centre.lat, view.zoom) : 0
  const activeAsset = placed.find((a) => a.id === active)

  return (
    <div>
      {/* Ctrl/⌘ + wheel zooms, a bare wheel does not: scrolling a page that
          happens to have a map on it must scroll the page. A trackpad pinch
          arrives as ctrl+wheel, so pinching still zooms. */}
      <div ref={boxRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onWheel={(e) => { if ((e.ctrlKey || e.metaKey) && e.deltaY) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1) } }}
        style={{ position: 'relative', height, border: 'var(--bdr)', borderRadius: 8, background: tilesOk ? 'var(--n100)' : 'var(--n50)', overflow: 'hidden', cursor: 'grab', touchAction: embedded ? 'pan-y' : 'none', userSelect: 'none' }}>

        {/* Basemap, when the browser can reach one. */}
        {tiles.map((t) => (
          <img key={t.key} src={t.url} alt="" draggable={false} onError={onTileError}
            style={{ position: 'absolute', left: t.left, top: t.top, width: t.span, height: t.span, pointerEvents: 'none' }} />
        ))}

        {/* Graticule, when it cannot. Keeps "these two are close together"
            readable with no tiles behind the pins. */}
        {!tilesOk && (
          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
              <pattern id="mapgrid" width="48" height="48" patternUnits="userSpaceOnUse">
                <path d="M48 0H0v48" fill="none" stroke="var(--n200)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mapgrid)" />
          </svg>
        )}

        {view && placed.map((a) => {
          const { left, top } = toScreen(a)
          if (left < -40 || top < -40 || left > size.w + 40 || top > size.h + 40) return null
          const isActive = active === a.id || selectedId === a.id
          return (
            <button key={a.id} type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setActive(a.id === active ? null : a.id) }}
              title={`${a.ain} — ${a.name}`}
              style={{ position: 'absolute', left, top, transform: `translate(-50%, -100%) scale(${isActive ? 1.25 : 1})`, transformOrigin: 'bottom center', background: 'none', border: 'none', padding: 0, cursor: 'pointer', lineHeight: 0, zIndex: isActive ? 3 : 2 }}>
              <Pin colour={mode.of(a)} ring={isActive ? 'var(--n900)' : 'var(--n0)'} />
            </button>
          )
        })}

        {/* The card for the pin that was tapped. Positioned in the corner rather
            than floating by the pin: on a phone a popup beside a pin near the
            edge is half off-screen. */}
        {activeAsset && (
          <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, maxWidth: 320, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '10px 12px', boxShadow: 'var(--sh-md)', zIndex: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)' }}>{activeAsset.ain}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--n900)' }}>{activeAsset.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--n600)', marginTop: 2, lineHeight: 1.5 }}>
                  {activeAsset.site?.name || 'No site'} · {activeAsset.status}
                  {activeAsset.health_score != null && <> · score {activeAsset.health_score}</>}
                </div>
                {(activeAsset.open_work_orders > 0 || activeAsset.open_defects > 0) && (
                  <div style={{ fontSize: 11.5, color: 'var(--srt)', marginTop: 3 }}>
                    {activeAsset.open_work_orders > 0 && `${activeAsset.open_work_orders} open job${activeAsset.open_work_orders === 1 ? '' : 's'}`}
                    {activeAsset.open_work_orders > 0 && activeAsset.open_defects > 0 && ' · '}
                    {activeAsset.open_defects > 0 && `${activeAsset.open_defects} open defect${activeAsset.open_defects === 1 ? '' : 's'}`}
                  </div>
                )}
                <div style={{ fontFamily: 'var(--ff-m)', fontSize: 10.5, color: 'var(--n400)', marginTop: 3 }}>
                  {Number(activeAsset.lat).toFixed(5)}, {Number(activeAsset.lng).toFixed(5)}
                </div>
              </div>
              <button type="button" onClick={() => setActive(null)} style={{ width: 22, height: 22, border: 'none', background: 'none', color: 'var(--n400)', cursor: 'pointer', flexShrink: 0, padding: 0 }}>✕</button>
            </div>
            {onSelect && (
              <button type="button" onClick={() => onSelect(activeAsset)} className="btn btn-secondary" style={{ width: '100%', height: 30, fontSize: 12, marginTop: 8 }}>
                Open this asset
              </button>
            )}
          </div>
        )}

        {/* Zoom. Big enough to hit with a thumb. */}
        <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', flexDirection: 'column', borderRadius: 6, overflow: 'hidden', border: 'var(--bdr)', boxShadow: 'var(--sh-sm)', zIndex: 4 }}>
          {[['+', 1], ['−', -1]].map(([label, d]) => (
            <button key={label} type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(d)}
              style={{ width: 34, height: 34, border: 'none', borderTop: label === '−' ? 'var(--bdr)' : 'none', background: 'var(--n0)', color: 'var(--n700)', fontSize: 17, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
          ))}
        </div>

        {view && (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => setView(fitView(placed, size.w, size.h))}
            style={{ position: 'absolute', top: 10, right: 10, height: 30, padding: '0 10px', border: 'var(--bdr)', borderRadius: 6, background: 'var(--n0)', color: 'var(--n700)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--sh-sm)', zIndex: 4 }}>
            Fit all
          </button>
        )}

        {scale && (
          <div style={{ position: 'absolute', left: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.82)', borderRadius: 4, padding: '2px 6px', zIndex: 1 }}>
            <span style={{ display: 'block', width: Math.round(scalePx), height: 3, borderLeft: '2px solid var(--n700)', borderRight: '2px solid var(--n700)', borderBottom: '2px solid var(--n700)' }} />
            <span style={{ fontSize: 10.5, fontFamily: 'var(--ff-m)', color: 'var(--n700)' }}>{scale.label}</span>
          </div>
        )}

        {tilesOk && (
          <div style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 9.5, color: 'var(--n600)', background: 'rgba(255,255,255,.75)', padding: '1px 4px', borderRadius: 3, zIndex: 1 }}>
            {TILE_ATTRIBUTION}
          </div>
        )}
      </div>

      {showLegend && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--n500)' }}>Pin colour — {mode.label.toLowerCase()}:</span>
          {mode.legend.map(([label, colour]) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--n600)' }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: colour }} />
              {label}
            </span>
          ))}
        </div>
      )}

      {note && (
        <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 8, lineHeight: 1.6 }}>
          {tilesOk
            ? 'Drag to pan; pinch, or use + / −, to zoom.'
            : 'No basemap could be loaded, so positions are drawn on a plain graticule — distances and relative positions are still true.'}
          {unplaced > 0 && (
            <> <strong style={{ color: 'var(--sat)' }}>{unplaced} asset{unplaced === 1 ? ' is' : 's are'} not shown</strong>, having no coordinates recorded.</>
          )}
        </p>
      )}
    </div>
  )
}
