import { useState, useMemo } from 'react'

/**
 * Where the assets are.
 *
 * Deliberately no basemap. A licensed instance may sit on a plant network with
 * no route to the internet, and a map that renders as grey squares on the
 * client's own site is worse than no map at all. What is actually needed here
 * is relative position — which assets are clustered, which one is out on its
 * own, where the failing ones are — and that survives without tiles.
 *
 * Coordinates are projected equirectangularly with a cos(latitude) correction
 * on the x axis, so at the scale of one facility or one region the shape is
 * right rather than stretched. A scale bar gives the distances.
 */

const STATUS_COLOR = {
  operational: 'var(--sg)',
  attention: 'var(--sa)',
  critical: 'var(--sr)',
  offline: 'var(--n400)',
}

/** Metres per degree of latitude — near enough constant, unlike longitude. */
const M_PER_DEG_LAT = 111_320

function niceDistance(metres) {
  if (metres >= 1000) {
    const km = metres / 1000
    const step = km >= 50 ? 50 : km >= 20 ? 20 : km >= 10 ? 10 : km >= 5 ? 5 : km >= 2 ? 2 : 1
    return { value: step * 1000, label: `${step} km` }
  }
  const step = metres >= 500 ? 500 : metres >= 200 ? 200 : metres >= 100 ? 100 : 50
  return { value: step, label: `${step} m` }
}

export default function AssetMap({ assets = [], unplaced = 0, colourBy = 'status', onSelect, height = 420 }) {
  const [hover, setHover] = useState(null)

  const layout = useMemo(() => {
    if (assets.length === 0) return null

    const lats = assets.map((a) => Number(a.lat))
    const lngs = assets.map((a) => Number(a.lng))
    const minLat = Math.min(...lats), maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const midLat = (minLat + maxLat) / 2
    // A degree of longitude shrinks towards the poles; without this correction
    // a north-south line of assets renders as a diagonal.
    const lngScale = Math.cos((midLat * Math.PI) / 180)

    // A single asset, or several on the same spot, has no span to normalise
    // against. Falling back to a minimum span would divide zero by it and pin
    // everything to a corner, so a degenerate axis is centred instead.
    const rawLat = maxLat - minLat
    const rawLng = (maxLng - minLng) * lngScale
    const FLAT = 1e-9
    const spanLat = rawLat > FLAT ? rawLat : 0.0015
    const spanLng = rawLng > FLAT ? rawLng : 0.0015
    const pad = 0.12
    const W = 100, H = 68

    const project = (lat, lng) => {
      const nx = rawLng > FLAT ? ((lng - minLng) * lngScale) / spanLng : 0.5
      const ny = rawLat > FLAT ? (lat - minLat) / spanLat : 0.5
      return [
        pad * W + nx * W * (1 - 2 * pad),
        // SVG y grows downwards; latitude grows north, so flip it.
        pad * H + (1 - ny) * H * (1 - 2 * pad),
      ]
    }

    const points = assets.map((a) => {
      const [x, y] = project(Number(a.lat), Number(a.lng))
      return { asset: a, x, y }
    })

    // Scale bar: how many metres one plot-width unit covers.
    const metresPerUnit = (spanLat * M_PER_DEG_LAT) / (H * (1 - 2 * pad))
    const bar = niceDistance(metresPerUnit * 25)

    return { points, W, H, bar, barUnits: bar.value / metresPerUnit, spanLat, spanLng }
  }, [assets])

  const colourOf = (a) => {
    if (colourBy === 'health') {
      if (a.health_score == null) return 'var(--n300)'
      return a.health_score < 40 ? 'var(--sr)' : a.health_score < 70 ? 'var(--sa)' : 'var(--sg)'
    }
    if (colourBy === 'work') {
      return a.open_defects > 0 ? 'var(--sr)' : a.open_work_orders > 0 ? 'var(--sa)' : 'var(--sg)'
    }
    return STATUS_COLOR[a.status] || 'var(--n400)'
  }

  if (!layout) {
    return (
      <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px dashed var(--n200)', borderRadius: 8, textAlign: 'center', padding: 24 }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11Z" stroke="var(--n300)" strokeWidth="1.4" />
          <circle cx="12" cy="10" r="2.4" stroke="var(--n300)" strokeWidth="1.4" />
        </svg>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--n600)' }}>No asset has coordinates yet</p>
        <p style={{ fontSize: 12.5, color: 'var(--n500)', maxWidth: 380, lineHeight: 1.6 }}>
          {unplaced > 0
            ? `All ${unplaced} asset${unplaced === 1 ? '' : 's'} are missing a latitude and longitude. Add them on the asset record and they will appear here.`
            : 'Add a latitude and longitude to an asset record and it will appear here.'}
        </p>
      </div>
    )
  }

  const { points, W, H, bar, barUnits } = layout

  return (
    <div>
      <div style={{ position: 'relative', border: 'var(--bdr)', borderRadius: 8, background: 'var(--n50)', overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} style={{ display: 'block' }}>
          <defs>
            <pattern id="mapgrid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0v10" fill="none" stroke="var(--n200)" strokeWidth="0.25" />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#mapgrid)" />

          {points.map(({ asset, x, y }) => {
            const isHover = hover === asset.id
            const colour = colourOf(asset)
            return (
              <g key={asset.id}
                onMouseEnter={() => setHover(asset.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect?.(asset)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}>
                {/* Critical assets get a halo so they are findable without hovering. */}
                {(asset.criticality === 'critical' || asset.open_defects > 0) && (
                  <circle cx={x} cy={y} r="3.2" fill={colour} opacity="0.18" />
                )}
                <circle cx={x} cy={y} r={isHover ? 2.2 : 1.5} fill={colour}
                  stroke="var(--n0)" strokeWidth="0.5" />
                {isHover && (
                  <text x={x} y={y - 3.4} textAnchor="middle"
                    style={{ fontSize: 2.6, fontFamily: 'var(--ff-m)', fill: 'var(--n900)', fontWeight: 600 }}>
                    {asset.ain}
                  </text>
                )}
                <title>{`${asset.ain} — ${asset.name}`}</title>
              </g>
            )
          })}

          {/* Scale bar, so "close together" means something. Bottom right,
              clear of the westernmost asset which always sits on the left. */}
          <g transform={`translate(${W - 6 - barUnits} ${H - 4})`}>
            <line x1="0" x2={barUnits} y1="0" y2="0" stroke="var(--n500)" strokeWidth="0.4" />
            <line x1="0" x2="0" y1="-1.2" y2="1.2" stroke="var(--n500)" strokeWidth="0.4" />
            <line x1={barUnits} x2={barUnits} y1="-1.2" y2="1.2" stroke="var(--n500)" strokeWidth="0.4" />
            <text x={barUnits / 2} y="-2" textAnchor="middle" style={{ fontSize: 2.4, fill: 'var(--n500)', fontFamily: 'var(--ff-m)' }}>{bar.label}</text>
          </g>
        </svg>

        {hover && (() => {
          const a = points.find((p) => p.asset.id === hover)?.asset
          if (!a) return null
          return (
            <div style={{ position: 'absolute', left: 10, top: 10, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '9px 12px', boxShadow: 'var(--sh-md)', maxWidth: 250, pointerEvents: 'none' }}>
              <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)' }}>{a.ain}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n900)', marginBottom: 3 }}>{a.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--n600)', lineHeight: 1.5 }}>
                {a.site?.name || 'No site'} · {a.status}
                {a.health_score != null && <> · score {a.health_score}</>}
              </div>
              {(a.open_work_orders > 0 || a.open_defects > 0) && (
                <div style={{ fontSize: 11.5, color: 'var(--srt)', marginTop: 3 }}>
                  {a.open_work_orders > 0 && `${a.open_work_orders} open job${a.open_work_orders === 1 ? '' : 's'}`}
                  {a.open_work_orders > 0 && a.open_defects > 0 && ' · '}
                  {a.open_defects > 0 && `${a.open_defects} open defect${a.open_defects === 1 ? '' : 's'}`}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--n500)', marginTop: 8, lineHeight: 1.6 }}>
        Positions are plotted from each asset&apos;s own coordinates — no basemap is loaded, so this works on a
        site with no internet access.
        {unplaced > 0 && (
          <> <strong style={{ color: 'var(--sat)' }}>{unplaced} asset{unplaced === 1 ? ' is' : 's are'} not shown</strong>, having no coordinates recorded.</>
        )}
      </p>
    </div>
  )
}
