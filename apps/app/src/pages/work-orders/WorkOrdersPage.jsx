import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../../components/Sidebar.jsx'
import Topbar from '../../components/Topbar.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { listWorkOrders, transitionWorkOrder, WO_STATUS_LABEL, woStatusStyle } from '../../lib/db/workOrders'
import { listSites } from '../../lib/db/sites'
import { listAssets } from '../../lib/db/assets'
import { listOrgUsers } from '../../lib/db/orgMembers'
import { useAuth, useCan } from '../../lib/AuthContext.jsx'
import { useToast } from '../../lib/ToastContext'
import { useLocationFilter } from '../../lib/LocationFilterContext'
import { errorText } from '../../lib/errors'
import { PriorityBadge, TypeBadge, SlaDue } from './badges.jsx'
import { WorkOrderForm } from './WorkOrderForm.jsx'
import { WorkOrderBoard } from './WorkOrderBoard.jsx'
import { useResource } from '../../lib/useResource'
import TableState from '../../components/TableState.jsx'
import { WODetail } from './WorkOrderDetail.jsx'

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WorkOrders({ dark, toggleDark }) {
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

  // The list follows the filters; the pickers' sites, assets and people do
  // not, so they load once rather than again on every filter click.
  const list = useResource(
    () => listWorkOrders({ status: (filterStatus === 'all' || filterStatus === 'open') ? undefined : filterStatus, locationId: globalLocationId })
      .then((w) => (filterStatus === 'open' ? w.filter(x => x.status !== 'closed') : w)),
    [filterStatus, globalLocationId],
    { initial: [], errorFallback: 'Failed to load work orders.' },
  )
  const lookups = useResource(
    () => Promise.all([listSites(), listAssets(), listOrgUsers().catch(() => [])]).then(([sites, assets, users]) => ({ sites, assets, users })),
    [], { initial: { sites: [], assets: [], users: [] }, errorFallback: 'Failed to load work orders.' },
  )
  const wos = list.data
  const setWos = list.setData
  const { sites, assets, users } = lookups.data
  const loading = list.loading || lookups.loading
  const error = list.error || lookups.error
  const load = list.reload
  const retry = () => { list.reload(); if (lookups.error) lookups.reload() }

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
            {loading || error ? (
              <TableState loading={loading} loadingText="Loading work orders…" error={error} onRetry={retry} />
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
              <WorkOrderBoard wos={visibleWos} selectedId={selectedId} canTransition={canTransition} onSelect={setSelectedId} onMove={moveWo} />
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
