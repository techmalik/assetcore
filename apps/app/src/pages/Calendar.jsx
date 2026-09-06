import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { getCalendar } from '../lib/db/analytics'

/**
 * One month, with everything that has a date on it.
 *
 * Work orders, PM tasks and inspections all carry dates and until now each was
 * only visible from its own list, which made "what is happening next week?" a
 * question three pages had to answer between them.
 */

const ENTITY_META = {
  work_order: { label: 'Work order', color: 'var(--b500)', route: '/work-orders' },
  pm_task: { label: 'PM task', color: 'var(--sg)', route: '/maintenance' },
  inspection: { label: 'Inspection', color: 'var(--sl)', route: '/inspections' },
}

// Overdue and done are properties of the item, not the entity, so they colour
// over the top of the entity colour.
const DONE_STATUSES = new Set(['closed', 'completed', 'skipped'])

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const iso = (d) => d.toISOString().slice(0, 10)

/** Monday-first grid covering the whole month plus the spill either side. */
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1))
  const last = new Date(Date.UTC(year, month + 1, 0))
  // getUTCDay is Sunday-0; shift so Monday is 0.
  const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(first)
  start.setUTCDate(first.getUTCDate() - lead)

  const days = []
  const cursor = new Date(start)
  // Always six rows, so the grid does not jump height between months.
  for (let i = 0; i < 42; i++) {
    days.push({
      date: new Date(cursor),
      key: iso(cursor),
      inMonth: cursor.getUTCMonth() === month,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { days, first, last }
}

function EventChip({ event, onOpen }) {
  const meta = ENTITY_META[event.entity]
  const done = DONE_STATUSES.has(event.status)
  const overdue = !done && event.on_date < iso(new Date())

  return (
    <button
      onClick={() => onOpen(event)}
      title={`${meta.label}: ${event.title}${event.asset_ain ? ` (${event.asset_ain})` : ''} — ${event.status.replace('_', ' ')}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, width: '100%',
        padding: '2px 4px', borderRadius: 3, border: 'none', cursor: 'pointer',
        background: overdue ? 'var(--srb)' : 'transparent',
        fontFamily: 'inherit', textAlign: 'left',
        opacity: done ? 0.55 : 1,
      }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
        background: overdue ? 'var(--sr)' : meta.color,
      }} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: overdue ? 'var(--srt)' : 'var(--n700)',
        textDecoration: done ? 'line-through' : 'none',
      }}>
        {event.ref ? `${event.ref} ` : ''}{event.title}
      </span>
    </button>
  )
}

export default function Calendar({ dark, toggleDark }) {
  const nav = useNavigate()
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getUTCFullYear(), month: today.getUTCMonth() })
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [show, setShow] = useState({ work_order: true, pm_task: true, inspection: true })
  const [selectedDay, setSelectedDay] = useState(null)

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Fetch the whole visible grid, spill included, so the leading and
      // trailing days are not mysteriously empty.
      setEvents(await getCalendar(grid.days[0].key, grid.days[grid.days.length - 1].key))
    } catch (ex) {
      setError(ex.message || 'Could not load the calendar.')
    } finally {
      setLoading(false)
    }
  }, [grid])

  useEffect(() => { load() }, [load])

  const byDay = useMemo(() => {
    const map = {}
    for (const e of events) {
      if (!show[e.entity]) continue
      const key = String(e.on_date).slice(0, 10)
      map[key] = map[key] || []
      map[key].push(e)
    }
    return map
  }, [events, show])

  const step = (delta) => setCursor((c) => {
    const d = new Date(Date.UTC(c.year, c.month + delta, 1))
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
  })

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1))
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const todayKey = iso(today)
  const counts = events.reduce((acc, e) => { acc[e.entity] = (acc[e.entity] || 0) + 1; return acc }, {})

  return (
    <div className="app-shell">
      <Sidebar active="calendar" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb="Calendar" dark={dark} toggleDark={toggleDark} />

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 24px 12px', borderBottom: 'var(--bdr)', background: 'var(--n0)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div>
                <h1 style={{ fontFamily: 'var(--ff-d)', fontSize: 22, fontWeight: 700, letterSpacing: '-.3px', color: 'var(--n950)' }}>Calendar</h1>
                <p style={{ fontSize: 12, color: 'var(--n500)' }}>Jobs, scheduled maintenance and inspections on one grid</p>
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={() => step(-1)} className="btn btn-secondary" style={{ height: 30, width: 30, padding: 0, fontSize: 13 }} title="Previous month">‹</button>
                <button onClick={() => setCursor({ year: today.getUTCFullYear(), month: today.getUTCMonth() })}
                  className="btn btn-secondary" style={{ height: 30, padding: '0 12px', fontSize: 12.5 }}>Today</button>
                <button onClick={() => step(1)} className="btn btn-secondary" style={{ height: 30, width: 30, padding: 0, fontSize: 13 }} title="Next month">›</button>
                <span style={{ fontFamily: 'var(--ff-d)', fontSize: 15, fontWeight: 600, color: 'var(--n900)', marginLeft: 8, minWidth: 140 }}>{monthLabel}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {Object.entries(ENTITY_META).map(([key, meta]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--n600)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={show[key]} onChange={(e) => setShow((s) => ({ ...s, [key]: e.target.checked }))} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color }} />
                  {meta.label}s
                  <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n400)' }}>{counts[key] || 0}</span>
                </label>
              ))}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--n500)' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--sr)' }} />
                Overdue
              </span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            {error ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <p style={{ color: 'var(--srt)', fontSize: 13, marginBottom: 12 }}>{error}</p>
                <button onClick={load} className="btn btn-secondary" style={{ height: 34, padding: '0 16px', fontSize: 13 }}>Retry</button>
              </div>
            ) : (
              <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity .15s' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: 'var(--n200)', border: '1px solid var(--n200)', borderRadius: 8, overflow: 'hidden' }}>
                  {DAY_NAMES.map((d) => (
                    <div key={d} style={{ background: 'var(--n50)', padding: '7px 8px', fontSize: 10, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--n500)', fontFamily: 'var(--ff-m)', textAlign: 'center' }}>{d}</div>
                  ))}

                  {grid.days.map((day) => {
                    const items = byDay[day.key] || []
                    const isToday = day.key === todayKey
                    return (
                      <div key={day.key}
                        onClick={() => setSelectedDay(items.length ? day.key : null)}
                        style={{
                          background: day.inMonth ? 'var(--n0)' : 'var(--n50)',
                          minHeight: 96, padding: '5px 6px', minWidth: 0,
                          display: 'flex', flexDirection: 'column', gap: 2,
                          cursor: items.length ? 'pointer' : 'default',
                          outline: selectedDay === day.key ? '2px solid var(--b400)' : 'none',
                          outlineOffset: -2,
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{
                            fontFamily: 'var(--ff-m)', fontSize: 11,
                            fontWeight: isToday ? 700 : 400,
                            color: isToday ? '#fff' : day.inMonth ? 'var(--n700)' : 'var(--n400)',
                            background: isToday ? 'var(--b500)' : 'transparent',
                            borderRadius: isToday ? 10 : 0,
                            padding: isToday ? '1px 6px' : 0,
                          }}>
                            {day.date.getUTCDate()}
                          </span>
                          <div style={{ flex: 1 }} />
                          {items.length > 3 && (
                            <span style={{ fontSize: 9.5, color: 'var(--n400)', fontFamily: 'var(--ff-m)' }}>{items.length}</span>
                          )}
                        </div>
                        {items.slice(0, 3).map((e) => (
                          <EventChip key={`${e.entity}-${e.id}`} event={e} onOpen={(ev) => nav(ENTITY_META[ev.entity].route)} />
                        ))}
                        {items.length > 3 && (
                          <span style={{ fontSize: 10, color: 'var(--b600)', paddingLeft: 4 }}>+{items.length - 3} more</span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {selectedDay && (byDay[selectedDay] || []).length > 0 && (
                  <div style={{ marginTop: 16, border: 'var(--bdr)', borderRadius: 8, background: 'var(--n0)', overflow: 'hidden', maxWidth: 700 }}>
                    <div style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--n900)' }}>
                        {new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--n400)', fontSize: 16, lineHeight: 1 }}>×</button>
                    </div>
                    {byDay[selectedDay].map((e) => {
                      const meta = ENTITY_META[e.entity]
                      return (
                        <div key={`${e.entity}-${e.id}`} className="row-hover"
                          onClick={() => nav(meta.route)}
                          style={{ padding: '10px 14px', borderBottom: 'var(--bdr)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: 'var(--n500)', width: 76, flexShrink: 0 }}>{meta.label}</span>
                          {e.ref && <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--b700)' }}>{e.ref}</span>}
                          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--n800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                          {e.asset_ain && <span style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--n500)' }}>{e.asset_ain}</span>}
                          <span className="badge badge-n" style={{ textTransform: 'capitalize' }}>{String(e.status).replace('_', ' ')}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
