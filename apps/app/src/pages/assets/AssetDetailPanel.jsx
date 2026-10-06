import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthImage from '../../components/AuthImage.jsx'
import ImageLightbox from '../../components/ImageLightbox.jsx'
import { PrintQrSheet, AssetQrCode } from '../../components/AssetQr.jsx'
import AssetMap from '../../components/AssetMap.jsx'
import { listAssetActivity, addAssetComment, getAssetHealth, listAssetTransfers } from '../../lib/db/assets'
import { Money } from '../../lib/money'
import { actionLabel } from '../../lib/auditLabels.js'
import { listWorkOrders, WO_STATUS_LABEL, WO_PRIORITY_LABEL } from '../../lib/db/workOrders'
import { listPMTasks, updatePMTask } from '../../lib/db/pmTasks'
import { listInspections, updateInspection } from '../../lib/db/inspections'
import { useCan } from '../../lib/AuthContext.jsx'
import { healthColor, healthLabel } from '../../lib/health'
import { ASSET_DEPRECIATION_METHOD, PM_TASK_STATUS, PM_TASK_STATUSES, INSPECTION_STATUS, INSPECTION_STATUSES, PRIORITY, toneOf, labelOf } from '../../lib/domain'
import { downloadFile } from '../../lib/db/files'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { fmtDate, fmtDateTime } from '../../lib/dates'
import { AssetStatusBadge } from './assetBits.jsx'
import { PMTaskCompleteModal } from './assetModals.jsx'

/**
 * The condition score, with its working shown.
 *
 * The score used to be a linear decay between the maintenance dates, and this
 * panel used to say so. It is now five weighted signals, so showing only the
 * total would swap one unexplained figure for another — every component is
 * listed with its own sub-score and the sentence saying where it came from,
 * including the ones that had no evidence and were left out of the average.
 *
 * There is no manual override to offer: health is derived, and the form that
 * used to accept a typed score was removed on purpose.
 */
function ConditionPanel({ asset }) {
  const [health, setHealth] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHealth(null)
    setErr('')
    getAssetHealth(asset.id)
      .then((h) => { if (!cancelled) setHealth(h) })
      .catch((ex) => { if (!cancelled) setErr(errorText(ex, 'Could not read the score.')) })
    return () => { cancelled = true }
  }, [asset.id])

  const score = asset.health_score
  const scored = health ? health.components.filter((c) => c.score != null).length : null

  return (
    <div style={{ background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
          <svg viewBox="0 0 64 64" width="64" height="64">
            <circle cx="32" cy="32" r="24" fill="none" stroke="var(--n200)" strokeWidth="7" />
            <circle cx="32" cy="32" r="24" fill="none" stroke={healthColor(score)} strokeWidth="7"
              strokeDasharray={`${150.8 * (score ?? 0) / 100} ${150.8}`} strokeLinecap="round" transform="rotate(-90 32 32)" />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: 'var(--ff-m)', fontSize: 16, fontWeight: 500 }}>{score ?? '—'}</span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.6, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--n800)', marginBottom: 4 }}>{healthLabel(score)}</div>
          <div style={{ fontSize: 11, color: 'var(--n500)' }}>
            {health
              ? `Calculated from ${scored} of ${health.components.length} signals${asset.health_score_computed_at ? `, last on ${fmtDate(asset.health_score_computed_at)}` : ''}.`
              : err || 'Reading the signals…'}
          </div>
        </div>
      </div>

      {health && (
        <>
          <button onClick={() => setOpen((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, cursor: 'pointer', font: 'inherit', fontSize: 11.5, color: 'var(--b600)' }}>
            {open ? 'Hide the working' : 'Show the working'}
          </button>

          {open && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {health.components.map((c) => (
                <div key={c.key} style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 5, padding: '8px 10px', opacity: c.score == null ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--n800)' }}>{c.label}</span>
                    <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11.5, fontWeight: 500, color: c.score == null ? 'var(--n400)' : healthColor(c.score) }}>
                      {c.score == null ? 'no data' : `${c.score}/100`}
                    </span>
                    <span style={{ fontFamily: 'var(--ff-m)', fontSize: 10.5, color: 'var(--n400)', width: 32, textAlign: 'right' }}>{c.weight}%</span>
                  </div>
                  {c.score != null && (
                    <div style={{ height: 4, background: 'var(--n200)', borderRadius: 99, overflow: 'hidden', margin: '6px 0 5px' }}>
                      <div style={{ width: `${c.score}%`, height: '100%', borderRadius: 99, background: healthColor(c.score) }} />
                    </div>
                  )}
                  <div style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.5, marginTop: c.score != null ? 0 : 4 }}>{c.detail}</div>
                </div>
              ))}

              {health.weight_applied < 100 && (
                <p style={{ fontSize: 11.5, color: 'var(--n500)', lineHeight: 1.5 }}>
                  Scored out of the {health.weight_applied}% of the weighting that had evidence behind it. A signal
                  with nothing to read is left out rather than counted as zero — never inspected is not the same as
                  in poor condition.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function HealthBar({ score }) {
  const color = healthColor(score)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 60, height: 5, background: 'var(--n200)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 99 }} />
      </div>
      <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', width: 28 }}>{score}</span>
    </div>
  )
}

// ── Asset detail panel ─────────────────────────────────────────────────────────
// Activity-feed dot color by asset_activity.kind — lets a maintenance
// completion or health alert read at a glance without opening every entry.
const ACTIVITY_DOT_C = { maintenance: 'var(--sgt)', alert: 'var(--srt)', inspection: 'var(--sat)', comment: 'var(--b400)', status_change: 'var(--b400)', attachment: 'var(--b400)' }

export function AssetDetailPanel({ asset, canEdit, canWO, canCompleteMaintenance, onEdit, onArchive, onRestore, onRaiseWO, onCompleteMaintenance, onTransfer, onClose, refreshToken, allAssets = [], orgDepreciation = null }) {
  const can = useCan()
  // Where the asset has been. Own state, loaded beside the other lists below
  // and refetched on the same refreshToken, so a transfer made from this panel
  // shows up here without closing it.
  const [transfers, setTransfers] = useState(null)
  useEffect(() => {
    let cancelled = false
    setTransfers(null)
    listAssetTransfers(asset.id).then((t) => !cancelled && setTransfers(t)).catch(() => !cancelled && setTransfers([]))
    return () => { cancelled = true }
  }, [asset.id, refreshToken])
  const nav = useNavigate()
  const toast = useToast()
  const canUpdatePM = can('pm:update')
  const canUpdateInspection = can('inspection:update')
  const [activity, setActivity] = useState(null)
  const [pmTasks, setPMTasks] = useState(null)
  const [inspections, setInspections] = useState(null)
  const [workOrders, setWorkOrders] = useState(null)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [lightbox, setLightbox] = useState(null) // { images, index } | null
  const [completingTask, setCompletingTask] = useState(null) // pm_task being completed via the confirm modal
  const [printLabel, setPrintLabel] = useState(false)
  const archived = Boolean(asset.deleted_at)
  const s = asset.specs || {}

  const loadActivity = useCallback(() => {
    listAssetActivity(asset.id).then(setActivity).catch(() => setActivity([]))
  }, [asset.id])

  const loadPMTasks = useCallback(() => {
    listPMTasks({ asset_id: asset.id, limit: 20 }).then(setPMTasks).catch(() => setPMTasks([]))
  }, [asset.id])

  const loadInspections = useCallback(() => {
    listInspections({ asset_id: asset.id, limit: 20 }).then(setInspections).catch(() => setInspections([]))
  }, [asset.id])

  useEffect(() => {
    let cancelled = false
    setActivity(null); setPMTasks(null); setInspections(null); setWorkOrders(null)
    listAssetActivity(asset.id).then((a) => !cancelled && setActivity(a)).catch(() => !cancelled && setActivity([]))
    listPMTasks({ asset_id: asset.id, limit: 20 }).then((t) => !cancelled && setPMTasks(t)).catch(() => !cancelled && setPMTasks([]))
    listInspections({ asset_id: asset.id, limit: 20 }).then((i) => !cancelled && setInspections(i)).catch(() => !cancelled && setInspections([]))
    listWorkOrders({ asset_id: asset.id }).then((w) => !cancelled && setWorkOrders(w)).catch(() => !cancelled && setWorkOrders([]))
    return () => { cancelled = true }
    // refreshToken bumps after actions taken elsewhere (e.g. Complete
    // Maintenance) that change this asset's PM tasks/activity but don't
    // change asset.id, so the effect wouldn't otherwise refire.
  }, [asset.id, refreshToken])

  async function changePMStatus(task, newStatus) {
    if (newStatus === 'completed') { setCompletingTask(task); return }
    try { await updatePMTask(task.id, { status: newStatus }); loadPMTasks(); toast.success('PM task status updated.') }
    catch (ex) { toast.error(errorText(ex, 'Failed to update PM task status.')) }
  }

  async function changeInspectionStatus(inspection, newStatus) {
    try { await updateInspection(inspection.id, { status: newStatus }); loadInspections(); toast.success('Inspection status updated.') }
    catch (ex) { toast.error(errorText(ex, 'Failed to update inspection status.')) }
  }

  async function postComment() {
    if (!comment.trim()) return
    setPosting(true)
    try { await addAssetComment(asset.id, comment.trim()); setComment(''); loadActivity() }
    catch (ex) { toast.error(errorText(ex, 'Failed to post comment.')) } finally { setPosting(false) }
  }

  async function viewDoc(doc) {
    try { await downloadFile(doc.url, doc.name) } catch (ex) { toast.error(errorText(ex, 'Failed to download file.')) }
  }

  const section = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', marginBottom: 8 }

  return (
    <div className="detail-panel" style={{ '--panel-w': '360px', background: 'var(--n0)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b600)', marginBottom: 2 }}>{asset.ain}{archived && <span style={{ color: 'var(--n400)' }}> · archived</span>}</div>
          <div style={{ fontFamily: 'var(--ff-d)', fontSize: 16, fontWeight: 700, color: 'var(--n950)', letterSpacing: '-.2px' }}>{asset.name}</div>
        </div>
        <button onClick={onClose} className="row-action" style={{ width: 40, height: 40, border: '1px solid var(--n200)', borderRadius: 4, background: 'var(--n0)', color: 'var(--n500)' }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <AssetStatusBadge status={asset.status} />
          {asset.category && <span className="badge badge-n">{asset.category.name}</span>}
          {asset.location && <span className="badge badge-n">📍 {asset.location.name}</span>}
          {asset.site && <span className="badge badge-n">{asset.site.name}</span>}
        </div>

        <ConditionPanel asset={asset} />

        {/* Financials */}
        <div>
          <div style={section}>Financials</div>
          <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
            {[
              // <Money> rather than a bare formatter: these read the org's
              // configured currency and carry the second one beside them, the
              // same as every other figure in the app.
              ['Purchase value', <Money key="pv" cents={asset.purchase_value_cents} full />],
              ['Book value (NBV)', <Money key="nbv" cents={asset.nbv_cents} full />],
              ['Accumulated depreciation', <Money key="acc" cents={asset.accumulated_depreciation_cents} full />],
              ['Method', asset.depreciation_method ? labelOf(ASSET_DEPRECIATION_METHOD, asset.depreciation_method) : `${labelOf(ASSET_DEPRECIATION_METHOD, orgDepreciation?.method || 'straight_line')} (org default)`],
              ['In service', asset.install_date || asset.purchase_date ? fmtDate(asset.install_date || asset.purchase_date) : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                {/* minWidth:0 so a long figure with its converted amount beside
                    it wraps inside the panel instead of running off the edge. */}
                <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right', minWidth: 0 }}>{v}</span>
              </div>
            ))}
          </div>
          {asset.nbv_cents == null && (
            // A null book value is "we can't work this out", not "it's worth
            // nothing" — say which, rather than rendering a confident ₦0.
            <div style={{ fontSize: 11, color: 'var(--n500)', marginTop: 6 }}>
              Add a purchase value and an install or purchase date to calculate book value.
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          <div style={section}>Details</div>
          <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, overflow: 'hidden' }}>
            {[
              ['Category', asset.category?.name || '—'],
              ['Location', asset.location?.name || '—'],
              ['Site', asset.site?.name || '—'],
              ['Operator', asset.operator?.full_name || '—'],
              ['Manufacturer', s.manufacturer || '—'],
              ['Model', s.model || '—'],
              ['Serial', s.serial_number || '—'],
              ['Install date', asset.install_date ? fmtDate(asset.install_date) : '—'],
              ['Purchase date', asset.purchase_date ? fmtDate(asset.purchase_date) : '—'],
              ['Runtime', s.runtime_hours != null ? `${Number(s.runtime_hours).toLocaleString()} hrs` : '—'],
              ['Parent asset', asset.parent_asset_id ? (allAssets.find((a) => a.id === asset.parent_asset_id)?.ain || 'Linked') : '—'],
              ['Coordinates', asset.lat != null && asset.lng != null ? `${asset.lat}, ${asset.lng}` : '—'],
              ['Tags', Array.isArray(s.tags) && s.tags.length ? s.tags.join(', ') : '—'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 14px', borderBottom: 'var(--bdr)', fontSize: 12 }}>
                <span style={{ color: 'var(--n500)', flexShrink: 0 }}>{k}</span>
                <span style={{ color: 'var(--n800)', fontWeight: 500, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Asset label. The QR only existed behind Registry → Labels, which
            is where you go to print a batch — not where you are when you have
            an asset open and need to scan it, or need one more label for a
            unit whose sticker has worn off. */}
        <div>
          <div style={section}>Asset label</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: 12 }}>
            <AssetQrCode ain={asset.ain} size={96} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--n600)', lineHeight: 1.5 }}>
                Scan with any phone camera to open this asset.
              </div>
              <button type="button" onClick={() => setPrintLabel(true)} className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12, marginTop: 10 }}>
                Print label
              </button>
            </div>
          </div>
        </div>

        {/* Maintenance & inspection status */}
        <div>
          <div style={section}>Maintenance status</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--n500)' }}>Last maintenance</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n800)' }}>{fmtDate(asset.last_maintenance_at)}</div>
            </div>
            <div style={{ flex: 1, background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--n500)' }}>Next maintenance</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--n800)' }}>{fmtDate(asset.next_maintenance_at)}</div>
            </div>
          </div>
          {pmTasks === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : pmTasks.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No PM tasks for this asset.</div>
          ) : pmTasks.slice(0, 8).map((t) => (
            <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)' }}>
              <span style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                {t.report_url && <button onClick={() => viewDoc({ url: t.report_url, name: t.report_url.split('/').pop() })} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>report</button>}
                {canUpdatePM && t.status !== 'completed' ? (
                  <select value={t.status} onChange={(e) => changePMStatus(t, e.target.value)} className="select" style={{ fontSize: 11, fontWeight: 500, color: toneOf(PM_TASK_STATUS, t.status).c, background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 3, padding: '1px 4px' }}>
                    {PM_TASK_STATUSES.map((k) => <option key={k} value={k}>{labelOf(PM_TASK_STATUS, k)}</option>)}
                  </select>
                ) : (
                  <span style={{ color: toneOf(PM_TASK_STATUS, t.status).c, fontWeight: 500 }}>{labelOf(PM_TASK_STATUS, t.status)}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Inspections */}
        <div>
          <div style={section}>Inspections</div>
          {inspections === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : inspections.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No inspections for this asset.</div>
          ) : inspections.slice(0, 8).map((i) => (
            <div key={i.id} style={{ padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</span>
                <span style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                  {i.report_url && <button onClick={() => viewDoc({ url: i.report_url, name: i.report_url.split('/').pop() })} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>report</button>}
                  {canUpdateInspection ? (
                    <select value={i.status} onChange={(e) => changeInspectionStatus(i, e.target.value)} className="select" style={{ fontSize: 11, fontWeight: 500, color: toneOf(INSPECTION_STATUS, i.status).c, background: 'var(--n0)', border: '1px solid var(--n200)', borderRadius: 3, padding: '1px 4px' }}>
                      {INSPECTION_STATUSES.map((k) => <option key={k} value={k}>{labelOf(INSPECTION_STATUS, k)}</option>)}
                    </select>
                  ) : (
                    <span style={{ color: toneOf(INSPECTION_STATUS, i.status).c, fontWeight: 500 }}>{labelOf(INSPECTION_STATUS, i.status)}</span>
                  )}
                </span>
              </div>
              {i.inspector?.full_name && <div style={{ fontSize: 10, color: 'var(--n400)', marginTop: 2 }}>Inspector: {i.inspector.full_name} · {fmtDate(i.scheduled_date)}</div>}
            </div>
          ))}
        </div>

        {/* Related work orders */}
        <div>
          <div style={section}>Work Orders</div>
          {workOrders === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : workOrders.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No work orders for this asset.</div>
          ) : workOrders.slice(0, 8).map((w) => {
            // Deep link, not a bare /work-orders — landing on an unfiltered
            // list and hunting for the row you just clicked isn't navigation.
            const openWO = () => nav(`/work-orders?id=${w.id}`)
            return (
              <div key={w.id} role="button" tabIndex={0} onClick={openWO} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openWO() }}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{w.ref}</span>
                  <span style={{ color: toneOf(PRIORITY, w.priority).c, fontWeight: 500, fontSize: 11 }}>{WO_PRIORITY_LABEL[w.priority] || w.priority}</span>
                </div>
                <div style={{ color: 'var(--n700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
                {/* Who's on it and when it was raised — the API has returned
                    both since day one; only this row left them out. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: 'var(--n400)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {WO_STATUS_LABEL[w.status] || w.status} · {w.assignee?.full_name || 'Unassigned'}
                    {w.assigner?.full_name ? ` (by ${w.assigner.full_name})` : ''}
                  </span>
                  <span style={{ flexShrink: 0 }}>
                    Raised {fmtDate(w.created_at)}{w.sla_due ? ` · Due ${fmtDate(w.sla_due)}` : ''}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Documents */}
        {asset.documents?.length > 0 && (
          <div>
            <div style={section}>Documents</div>
            {asset.documents.map((d, i) => (
              <button key={i} onClick={() => viewDoc(d)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'var(--b600)', cursor: 'pointer' }}>📄 {d.name}</button>
            ))}
          </div>
        )}

        {/* Photos */}
        {asset.photos?.length > 0 && (
          <div>
            <div style={section}>Photos <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--n400)' }}>· click to enlarge</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {asset.photos.map((p, i) => (
                <button key={i} type="button" onClick={() => setLightbox({ images: asset.photos, index: i })} title="Click to enlarge" style={{ padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', borderRadius: 4, lineHeight: 0 }}>
                  <AuthImage relPath={p} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--n200)', display: 'block' }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Activity feed */}
        <div>
          <div style={section}>Activity</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') postComment() }} placeholder="Add a comment…" className="input" style={{ flex: 1, height: 32, fontSize: 12 }} />
            <button onClick={postComment} disabled={posting || !comment.trim()} className="btn btn-secondary" style={{ height: 32, padding: '0 10px', fontSize: 12 }}>Post</button>
          </div>
          {activity === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : activity.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>No activity yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activity.map((ev) => (
                <div key={`${ev.source}-${ev.id}`} style={{ display: 'flex', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: ev.source === 'audit' ? 'var(--n300)' : (ACTIVITY_DOT_C[ev.kind] || 'var(--b400)'), marginTop: 5, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, color: 'var(--n800)' }}>
                      {/* Audit rows used to render the raw action string in
                          grey monospace, sitting right beside human sentences
                          from asset_activity. Same label map the Admin audit
                          tab uses. */}
                      {ev.source === 'audit' ? <span style={{ fontSize: 12, color: 'var(--n600)' }}>{actionLabel(ev.kind)}</span> : ev.body}
                    </div>
                    {ev.attachments?.length > 0 && (
                      <div style={{ marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {ev.attachments.map((a, i) => (
                          <button key={i} onClick={() => viewDoc(a)} style={{ background: 'none', border: 'none', color: 'var(--b600)', cursor: 'pointer', fontSize: 11, padding: 0 }}>📎 {a.name || 'attachment'}</button>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--n400)' }}>{ev.actor?.full_name || 'System'} · {fmtDateTime(ev.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Where it is. Last, because it answers "how do I get to it" rather
            than "what is wrong with it" — and an asset with no fix of its own
            still shows its site, which is where someone would drive to. */}
        <div>
          <div style={section}>Location</div>
          {(() => {
            const lat = asset.lat ?? asset.site?.lat
            const lng = asset.lng ?? asset.site?.lng
            if (lat == null || lng == null) {
              return (
                <p style={{ fontSize: 12, color: 'var(--n500)', lineHeight: 1.6 }}>
                  No coordinates on this asset{asset.site ? ' or on its site' : ''}. Add a latitude and longitude
                  {canEdit ? ' by editing the asset' : ''} and it will appear here and on the asset map.
                </p>
              )
            }
            return (
              <>
                <AssetMap
                  assets={[{ ...asset, lat, lng }]}
                  colourBy="status"
                  height={190}
                  showLegend={false}
                  note={false}
                  embedded
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n500)' }}>
                    {Number(lat).toFixed(5)}, {Number(lng).toFixed(5)}
                    {asset.lat == null && asset.site && <span style={{ color: 'var(--n400)' }}> · from {asset.site.name}</span>}
                  </span>
                  <button type="button" onClick={() => nav('/asset-map')} style={{ background: 'none', border: 'none', padding: 0, fontSize: 11.5, color: 'var(--b600)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    See it among the others →
                  </button>
                </div>
              </>
            )
          })()}
        </div>

        {/* Transfer history */}
        <div>
          <div style={section}>Transfer history</div>
          {transfers === null ? <div style={{ fontSize: 12, color: 'var(--n400)' }}>Loading…</div> : transfers.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--n400)' }}>Never moved{asset.site ? ` — at ${asset.site.name} since it was registered` : ''}.</div>
          ) : transfers.map((t) => (
            <div key={t.id} style={{ padding: '6px 0', fontSize: 12, borderBottom: 'var(--bdr)' }}>
              <div style={{ color: 'var(--n800)' }}>
                {t.from_site?.name || 'No site'} <span style={{ color: 'var(--n400)' }}>→</span> {t.to_site?.name}
              </div>
              {t.reason && <div style={{ fontSize: 11, color: 'var(--n600)', marginTop: 2 }}>{t.reason}</div>}
              <div style={{ fontSize: 10, color: 'var(--n400)', marginTop: 2 }}>
                {fmtDate(t.transferred_at)} · {t.transferred_by_user?.full_name || 'Unknown'}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          {archived ? (
            canEdit && <button onClick={onRestore} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Restore asset</button>
          ) : (
            <>
              {/* An inactive asset is at a shut-down site: completing maintenance
                  or raising a job there is refused, so the buttons are not offered.
                  Transfer is how it gets back to work. */}
              {asset.status === 'inactive' && (
                <div style={{ fontSize: 12, color: 'var(--n600)', background: 'var(--n50)', border: 'var(--bdr)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 }}>
                  {asset.site?.name || 'Its site'} is shut down, so no work can be raised on this asset. Transfer it to an active site, or reopen the site.
                </div>
              )}
              {canCompleteMaintenance && asset.status !== 'inactive' && <button onClick={onCompleteMaintenance} className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 13 }}>Complete Maintenance</button>}
              {canWO && asset.status !== 'inactive' && <button onClick={onRaiseWO} className="btn btn-secondary" style={{ width: '100%', height: 36, fontSize: 13 }}>Raise Work Order</button>}
              {canEdit && onTransfer && <button onClick={onTransfer} className="btn btn-secondary" style={{ width: '100%', height: 36, fontSize: 13 }}>Transfer to another site</button>}
              {canEdit && (
                <div className="form-grid" style={{ gap: 8 }}>
                  <button onClick={onEdit} className="btn btn-secondary" style={{ height: 34, fontSize: 13 }}>Edit Asset</button>
                  <button onClick={onArchive} className="btn btn-danger-soft" style={{ height: 34, fontSize: 13 }}>Archive</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {lightbox && <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
      {printLabel && <PrintQrSheet assets={[asset]} onClose={() => setPrintLabel(false)} />}
      {completingTask && (
        <PMTaskCompleteModal
          task={completingTask}
          onClose={() => setCompletingTask(null)}
          onCompleted={() => { setCompletingTask(null); loadPMTasks() }}
        />
      )}
    </div>
  )
}
