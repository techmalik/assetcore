import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../../components/Sidebar.jsx'
import Topbar from '../../components/Topbar.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { listWorkOrders, transitionWorkOrder, WO_TRANSITIONS, WO_STATUS_LABEL, woStatusStyle } from '../../lib/db/workOrders'
import { listSites } from '../../lib/db/sites'
import { listAssets } from '../../lib/db/assets'
import { listOrgUsers } from '../../lib/db/orgMembers'
import { useAuth, useCan } from '../../lib/AuthContext.jsx'
import { useToast } from '../../lib/ToastContext'
import { useMoney } from '../../lib/money'
import { useLocationFilter } from '../../lib/LocationFilterContext'
import { errorText } from '../../lib/errors'
import { STATUS_COL_ORDER, PriorityBadge, TypeBadge, SlaDue } from './badges.jsx'
import { WorkOrderForm } from './WorkOrderForm.jsx'
import { WODetail } from './WorkOrderDetail.jsx'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkOrders({ dark, toggleDark }) {
  const { money } = useMoney()
  const can = useCan()
  const { user } = useAuth()
  const toast = useToast()
  // extraCaps matters: an admin can grant these per-user in Admin -> Access
  // settings and the API honours them (middleware/rbac.ts), but every
  // can() call here used to omit the third argument, so a granted
  // capability produced a button that never appeared.
  const canCreate     = can('wo:create')
  const canTransition = can('wo:transition')
  const canEdit       = can('wo:update')
  const canAssign     = can('wo:assign')
  const { locationId: globalLocationId, setLocationId: setGlobalLocationId, locations: myLocations } = useLocationFilter()
  const globalLocation = myLocations.find((l) => l.id === globalLocationId)

  const [searchParams] = useSearchParams()
  const [wos, setWos] = useState([])
  const [sites, setSites] = useState([])
  const [assets, setAssets] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // 'open' is a client-side pseudo-status (not closed) — no single status
  // value on the backend means "open", so it fetches everything and filters
  // here, same as the dashboard's "Open Work Orders" KPI counts it.
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'all')
  // Supports the Dashboard's "My Open Work" card linking in as ?assignee=me.
  const [mineOnly, setMineOnly] = useState(searchParams.get('assignee') === 'me')
  // ?id=<uuid> — deep link from a notification or from the asset sidebar's
  // work-order list, which used to dump you on an unfiltered page.
  const deepLinkId = searchParams.get('id')
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  // Board drag state: which card is in the air, and which column it is over.
  const [dragging, setDragging] = useState(null) // { id, from }
  const [dropCol, setDropCol] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [w, s, a, u] = await Promise.all([
        listWorkOrders({ status: (filterStatus === 'all' || filterStatus === 'open') ? undefined : filterStatus, locationId: globalLocationId }),
        listSites(), listAssets(), listOrgUsers().catch(() => []),
      ])
      setWos(filterStatus === 'open' ? w.filter(x => x.status !== 'closed') : w)
      setSites(s); setAssets(a); setUsers(u)
    } catch (e) { setError(errorText(e, 'Failed to load work orders.')) }
    finally { setLoading(false) }
  }, [filterStatus, globalLocationId])

  useEffect(() => { load() }, [load])

  // Open the deep-linked WO once the list has arrived. Also clears the status
  // filter, so linking to a draft or closed WO doesn't land on a page that
  // filters it straight back out.
  useEffect(() => {
    if (!deepLinkId || !wos.length) return
    if (!wos.some(w => w.id === deepLinkId)) return
    setFilterStatus('all')
    setMineOnly(false)
    setSelectedId(deepLinkId)
  }, [deepLinkId, wos])

  // Dropping a card on a column is the same transition the detail panel's
  // status control performs, so it obeys the same WO_TRANSITIONS table and the
  // same wo:transition capability — the board just makes the legal moves
  // visible. Applied optimistically and rolled back on failure, since the API
  // can still refuse (closing a job whose parts aren't in stock, most often).
  async function moveWo(id, to) {
    const wo = wos.find(w => w.id === id)
    if (!wo || wo.status === to) return
    const from = wo.status
    setWos(cur => cur.map(w => (w.id === id ? { ...w, status: to } : w)))
    try {
      const updated = await transitionWorkOrder(id, to)
      // The response carries the fields the transition itself wrote
      // (actual_start, actual_end, and any defects it resolved), so take it
      // whole rather than re-fetching the board and blanking it mid-drag.
      setWos(cur => cur.map(w => (w.id === id ? { ...w, ...updated } : w)))
      toast.success(`${wo.ref} moved to ${WO_STATUS_LABEL[to]}.`)
    } catch (e) {
      setWos(cur => cur.map(w => (w.id === id ? { ...w, status: from } : w)))
      toast.error(errorText(e, 'Could not move this work order.'))
    }
  }

  const visibleWos = mineOnly ? wos.filter(w => w.assignee_id === user?.id) : wos
  const byStatus = STATUS_COL_ORDER.reduce((acc, s) => { acc[s] = visibleWos.filter(w => w.status === s); return acc }, {})

  return (
    <div className="app-shell">
      <Sidebar active="work-orders" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Work Orders" dark={dark} toggleDark={toggleDark} />

        <div style={{ padding: '14px 24px', borderBottom: 'var(--bdr)', background: 'var(--n0)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Work Orders</h1>
            <p style={{ fontSize: 12, color: 'var(--n500)' }}>{loading ? 'Loading…' : `${visibleWos.length} orders`}</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setMineOnly(m => !m)}
            style={{ height: 28, padding: '0 10px', border: `1px solid ${mineOnly ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 99, background: mineOnly ? 'var(--b50)' : 'var(--n0)', fontSize: 11, fontWeight: mineOnly ? 600 : 400, color: mineOnly ? 'var(--b700)' : 'var(--n600)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Assigned to me
          </button>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[['all', 'All'], ['open', 'Open'], ...Object.entries(WO_STATUS_LABEL)].map(([v, l]) => (
              <button key={v} onClick={() => setFilterStatus(v)} className="filter-pill" style={{ height: 28, padding: '0 10px', border: `1px solid ${filterStatus === v ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 4, background: filterStatus === v ? 'var(--b50)' : 'var(--n0)', fontSize: 11, color: filterStatus === v ? 'var(--b700)' : 'var(--n600)', fontWeight: filterStatus === v ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', border: '1px solid var(--n200)', borderRadius: 4, overflow: 'hidden' }}>
            {[['list', 'List'], ['kanban', 'Board']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className="filter-pill" style={{ height: 28, padding: '0 12px', border: 'none', borderRight: v === 'list' ? '1px solid var(--n200)' : 'none', background: view === v ? 'var(--b50)' : 'var(--n0)', fontSize: 12, color: view === v ? 'var(--b700)' : 'var(--n600)', fontWeight: view === v ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{l}</button>
            ))}
          </div>
          {canCreate && (
            <button onClick={() => setShowNew(true)} style={{ height: 32, padding: '0 14px', background: 'var(--b500)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
              New WO
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          <div className="table-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--n400)', fontSize: 13 }}>Loading work orders…</div>
            ) : error ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
              </div>
            ) : visibleWos.length === 0 ? (
              <div style={{ padding: 64, textAlign: 'center' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--n600)', marginBottom: 6 }}>
                  {mineOnly ? 'No work orders assigned to you' : globalLocation ? `No work orders in ${globalLocation.name}` : 'No work orders'}
                </p>
                {globalLocation ? (
                  <button onClick={() => setGlobalLocationId(null)} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Show all locations</button>
                ) : mineOnly ? (
                  <button onClick={() => setMineOnly(false)} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Show all</button>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: 'var(--n400)', marginBottom: 20 }}>Create a work order to start tracking maintenance activities.</p>
                    {canCreate && <button onClick={() => setShowNew(true)} className="btn btn-primary" style={{ height: 36, padding: '0 18px', fontSize: 13 }}>Create work order</button>}
                  </>
                )}
              </div>
            ) : view === 'kanban' ? (
              <div style={{ display: 'flex', gap: 0, height: '100%', overflowX: 'auto' }}>
                {STATUS_COL_ORDER.map(s => {
                  // While a card is in the air, only the columns its current
                  // status may legally move to accept it; the rest dim, so the
                  // board shows the transition rules instead of letting you
                  // drop somewhere the API would refuse.
                  const legalTarget = dragging && dragging.from !== s && (WO_TRANSITIONS[dragging.from] || []).includes(s)
                  const dimmed = dragging && dragging.from !== s && !legalTarget
                  return (
                  <div key={s}
                    onDragOver={e => { if (!legalTarget) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropCol !== s) setDropCol(s) }}
                    onDragLeave={() => setDropCol(c => (c === s ? null : c))}
                    onDrop={e => {
                      e.preventDefault()
                      const id = e.dataTransfer.getData('text/plain') || dragging?.id
                      if (legalTarget && id) moveWo(id, s)
                      setDragging(null); setDropCol(null)
                    }}
                    style={{ minWidth: 240, width: 240, flexShrink: 0, borderRight: 'var(--bdr)', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: dropCol === s ? 'var(--b50)' : 'transparent', opacity: dimmed ? .45 : 1, transition: 'background .12s, opacity .12s' }}>
                    <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: dropCol === s ? 'var(--b100)' : 'var(--n50)', flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n600)' }}>{WO_STATUS_LABEL[s]}</span>
                      <span style={{ fontSize: 11, background: 'var(--n200)', color: 'var(--n600)', borderRadius: 99, padding: '1px 7px', fontFamily: 'var(--ff-m)' }}>{byStatus[s].length}</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
                      {byStatus[s].map(w => {
                        const movable = canTransition && (WO_TRANSITIONS[w.status] || []).length > 0
                        return (
                        <div key={w.id} onClick={() => setSelectedId(w.id)} className="row-hover"
                          draggable={movable}
                          onDragStart={e => {
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('text/plain', w.id)
                            setDragging({ id: w.id, from: w.status })
                          }}
                          onDragEnd={() => { setDragging(null); setDropCol(null) }}
                          title={movable ? 'Drag to another column to change status' : undefined}
                          style={{ background: selectedId === w.id ? 'var(--b50)' : 'var(--n0)', border: `1px solid ${selectedId === w.id ? 'var(--b300)' : 'var(--n200)'}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, cursor: movable ? 'grab' : 'pointer', opacity: dragging?.id === w.id ? .4 : 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--n900)', marginBottom: 6, lineHeight: 1.4 }}>{w.title}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                            <PriorityBadge p={w.priority} /><TypeBadge t={w.type} />
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--n500)' }}>{w.asset?.ain || w.site?.name || '—'}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                            {w.sla_due ? <SlaDue date={w.sla_due} /> : <span/>}
                            {w.cost_cents > 0 && <span style={{ fontSize: 11, fontFamily: 'var(--ff-m)', color: 'var(--n600)' }}>{money(w.cost_cents)}</span>}
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  </div>
                  )
                })}
              </div>
            ) : (
              <>
                <table className="table-view-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr style={{ background: 'var(--n50)', borderBottom: 'var(--bdr)' }}>
                      {['Ref', 'Title', 'Site', 'Asset', 'Assignee', 'Type', 'Priority', 'Status', 'SLA', ''].map(h => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', whiteSpace: 'nowrap', borderBottom: 'var(--bdr)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleWos.map(w => (
                      <tr key={w.id} className="row-hover" style={{ borderBottom: 'var(--bdr)', cursor: 'pointer', background: selectedId === w.id ? 'var(--b50)' : 'transparent' }} onClick={() => setSelectedId(w.id)}>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)', whiteSpace: 'nowrap' }}>{w.ref}</td>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--n900)', maxWidth: 260 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</div>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{w.site?.name || '—'}</td>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n700)', whiteSpace: 'nowrap' }}>{w.asset?.ain || '—'}</td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--n600)', whiteSpace: 'nowrap' }}>{w.assignee?.full_name || '—'}</td>
                        <td style={{ padding: '10px 14px' }}><TypeBadge t={w.type} /></td>
                        <td style={{ padding: '10px 14px' }}><PriorityBadge p={w.priority} /></td>
                        <td style={{ padding: '10px 14px' }}>
                          <StatusBadge tone={woStatusStyle(w.status)} label={WO_STATUS_LABEL[w.status]} size="md" style={{ borderRadius: 3 }} />
                        </td>
                        <td style={{ padding: '10px 14px' }}><SlaDue date={w.sla_due} /></td>
                        <td style={{ padding: '10px 14px' }}>
                          <button onClick={e => { e.stopPropagation(); setSelectedId(w.id) }} className="row-action" style={{ color: 'var(--n400)', padding: 4 }}>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile card list — same data, tap opens the full-screen detail panel */}
                <div className="card-list">
                  {visibleWos.map(w => (
                    <div key={w.id} className="list-card" onClick={() => setSelectedId(w.id)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{w.ref}</span>
                        <StatusBadge tone={woStatusStyle(w.status)} label={WO_STATUS_LABEL[w.status]} size="md" style={{ borderRadius: 3 }} />
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--n900)', marginBottom: 6, lineHeight: 1.4 }}>{w.title}</div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        <PriorityBadge p={w.priority} /><TypeBadge t={w.type} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--n500)' }}>{w.asset?.ain || w.site?.name || '—'}{w.assignee ? ` · ${w.assignee.full_name}` : ''}</span>
                        {w.sla_due && <SlaDue date={w.sla_due} />}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {selectedId && (
            <WODetail woId={selectedId} onClose={() => setSelectedId(null)} onUpdate={load} canTransition={canTransition} canEdit={canEdit} canAssign={canAssign} users={users} />
          )}
        </div>
      </div>

      {showNew && (
        <WorkOrderForm sites={sites} assets={assets} users={users} canAssign={canAssign} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />
      )}
    </div>
  )
}
