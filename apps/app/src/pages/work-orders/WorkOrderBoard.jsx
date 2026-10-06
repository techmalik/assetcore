import { useState } from 'react'
import { WO_TRANSITIONS, WO_STATUS_LABEL } from '../../lib/db/workOrders'
import { useMoney } from '../../lib/money'
import { STATUS_COL_ORDER, PriorityBadge, TypeBadge, SlaDue } from './badges.jsx'

/**
 * The board: one column per status, a card per job. Dragging a card asks
 * onMove(id, to) for the same transition the detail panel performs, so it
 * obeys WO_TRANSITIONS and wo:transition; the board only makes the legal
 * moves visible.
 */
export function WorkOrderBoard({ wos, selectedId, canTransition, onSelect, onMove }) {
  const { money } = useMoney()
  // Which card is in the air, and which column it is over.
  const [dragging, setDragging] = useState(null) // { id, from }
  const [dropCol, setDropCol] = useState(null)
  const byStatus = STATUS_COL_ORDER.reduce((acc, s) => { acc[s] = wos.filter(w => w.status === s); return acc }, {})

  return (
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
            if (legalTarget && id) onMove(id, s)
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
              <div key={w.id} onClick={() => onSelect(w.id)} className="row-hover"
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
  )
}
