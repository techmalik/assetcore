import { useState, useEffect } from 'react'
import { listAuditLog, auditFacets } from '../../lib/db/audit.js'
import { actionLabel, actionColor, entityTypeLabel } from '../../lib/auditLabels.js'
import { errorText } from '../../lib/errors'

// ── Audit Log Tab ─────────────────────────────────────────────────────────────


export default function AuditTab() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [offset, setOffset] = useState(0)
  // Facets come from the log itself, so the dropdowns only ever offer a value
  // that has at least one row behind it — a list of every action the app could
  // write would mostly be dead ends.
  const [facets, setFacets] = useState({ actors: [], actions: [], entity_types: [] })
  const [filters, setFilters] = useState({ actor_id: '', action: '', entity_type: '', q: '', from: '', to: '' })
  const [qInput, setQInput] = useState('')
  const [exporting, setExporting] = useState(null) // 'csv' | 'xlsx'
  const [exportErr, setExportErr] = useState('')
  const PAGE = 50

  const active = Object.values(filters).some(Boolean)

  // Exports the log exactly as filtered on screen (the server reuses the same
  // where-clause), all pages rather than the one being viewed.
  async function exportLog(format) {
    setExporting(format); setExportErr('')
    try {
      const { downloadExport } = await import('../../lib/db/exports.js')
      await downloadExport('audit_log', format, filters)
    } catch (e) {
      setExportErr(errorText(e, 'The export did not download. Try again.'))
    } finally {
      setExporting(null)
    }
  }

  function load(off, f) {
    setLoading(true)
    listAuditLog({ limit: PAGE, offset: off, filters: f })
      .then(({ rows: r, total: t }) => { setRows(r); setTotal(t); setLoading(false) })
      .catch(e => { setErr(errorText(e)); setLoading(false) })
  }

  useEffect(() => { auditFacets().then(setFacets).catch(() => {}) }, [])

  // Every filter change restarts at page 1 — staying on page 3 of a narrower
  // result set shows an empty table and looks like the filter found nothing.
  useEffect(() => { setOffset(0); load(0, filters) }, [filters])

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.q === qInput ? f : { ...f, q: qInput })), 300)
    return () => clearTimeout(t)
  }, [qInput])

  function page(dir) {
    const next = offset + dir * PAGE
    setOffset(next)
    load(next, filters)
  }

  function set(key, value) { setFilters(f => ({ ...f, [key]: value })) }
  function clearAll() { setQInput(''); setFilters({ actor_id: '', action: '', entity_type: '', q: '', from: '', to: '' }) }

  const sel = { height: 30, fontSize: 12, padding: '0 8px', border: '1px solid var(--n200)', borderRadius: 3, background: 'var(--n0)', color: 'var(--n700)', fontFamily: 'var(--ff-u)', maxWidth: 190 }

  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'12px 24px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <div style={{fontSize:13,fontWeight:500,color:'var(--n600)'}}>
          {active ? `${total} matching event${total === 1 ? '' : 's'}` : total > 0 ? `${total} total events` : 'Audit log'}
        </div>
        <div style={{flex:1}}/>
        {exportErr && <span style={{fontSize:12,color:'var(--srt)'}}>{exportErr}</span>}
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button disabled={!!exporting || total === 0} onClick={() => exportLog('csv')} className="btn btn-secondary" style={{height:28,padding:'0 10px',fontSize:12}}>
            {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
          </button>
          <button disabled={!!exporting || total === 0} onClick={() => exportLog('xlsx')} className="btn btn-secondary" style={{height:28,padding:'0 10px',fontSize:12}}>
            {exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
        {total > PAGE && (
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <button disabled={offset === 0} onClick={() => page(-1)} style={{height:28,padding:'0 10px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:12,color:'var(--n600)',cursor:'pointer',opacity:offset===0?.5:1}}>← Prev</button>
            <span style={{fontSize:12,color:'var(--n500)'}}>{Math.floor(offset/PAGE)+1} / {Math.ceil(total/PAGE)}</span>
            <button disabled={offset + PAGE >= total} onClick={() => page(1)} style={{height:28,padding:'0 10px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:12,color:'var(--n600)',cursor:'pointer',opacity:offset+PAGE>=total?.5:1}}>Next →</button>
          </div>
        )}
      </div>

      {/* Filter bar. Actions are shown with the same plain-English labels as the
          table, so the filter and the rows it produces read alike. */}
      <div style={{padding:'10px 24px',borderBottom:'var(--bdr)',display:'flex',flexWrap:'wrap',alignItems:'center',gap:8,flexShrink:0,background:'var(--n50)'}}>
        <select style={sel} value={filters.actor_id} onChange={e => set('actor_id', e.target.value)}>
          <option value="">All actors</option>
          {facets.actors.map(a => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
        </select>
        <select style={sel} value={filters.action} onChange={e => set('action', e.target.value)}>
          <option value="">All activity</option>
          {facets.actions.map(a => <option key={a} value={a}>{actionLabel(a)}</option>)}
        </select>
        <select style={sel} value={filters.entity_type} onChange={e => set('entity_type', e.target.value)}>
          <option value="">All entity types</option>
          {facets.entity_types.map(t => <option key={t} value={t} style={{textTransform:'capitalize'}}>{entityTypeLabel(t)}</option>)}
        </select>
        <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search entity…"
          style={{...sel, width:170, maxWidth:'none'}}/>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{fontSize:12,color:'var(--n500)'}}>From</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={e => set('from', e.target.value)} style={{...sel,width:140,maxWidth:'none'}}/>
          <span style={{fontSize:12,color:'var(--n500)'}}>to</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={e => set('to', e.target.value)} style={{...sel,width:140,maxWidth:'none'}}/>
        </div>
        {active && (
          <button onClick={clearAll} style={{height:30,padding:'0 10px',border:'1px solid var(--n300)',borderRadius:3,background:'var(--n0)',fontSize:12,color:'var(--n700)',cursor:'pointer'}}>Clear filters</button>
        )}
      </div>

      <div style={{flex:1,overflowY:'auto'}}>
        {loading ? (
          <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
        ) : err ? (
          <div style={{padding:16,color:'var(--srt)',fontSize:13}}>{err}</div>
        ) : rows.length === 0 ? (
          <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>
            {active ? 'No events match these filters.' : 'No audit events yet.'}
          </div>
        ) : (
          <div className="table-scroll"><table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead style={{position:'sticky',top:0,zIndex:10}}>
              <tr style={{background:'var(--n50)'}}>
                {['Time','Actor','Action','Entity'].map(h => (
                  <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',borderBottom:'var(--bdr)'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{borderBottom:'var(--bdr)'}}>
                  {/* Year and seconds included: without them two events a year
                      apart rendered identically. */}
                  <td style={{padding:'9px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>
                    {new Date(r.created_at).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                  </td>
                  <td style={{padding:'9px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>
                    {r.actor?.full_name || r.actor?.email || 'System'}
                  </td>
                  <td style={{padding:'9px 14px'}}>
                    <span style={{fontSize:12,fontWeight:500,color:actionColor(r.action)}}>
                      {actionLabel(r.action)}
                    </span>
                  </td>
                  {/* The snapshot label written with the row (0018). This cell
                      used to read `work_order 3f9a2c1b` — the entity type plus
                      the first eight characters of a UUID, not even a complete
                      one, so it couldn't be pasted into a lookup. */}
                  <td style={{padding:'9px 14px',fontSize:12,color:'var(--n800)'}}>
                    {r.entity_label
                      ? <span>{r.entity_label}</span>
                      : <span style={{color:'var(--n400)'}}>{entityTypeLabel(r.entity_type)}</span>}
                    {r.entity_label && (
                      <span style={{color:'var(--n400)',fontSize:11,marginLeft:6}}>{entityTypeLabel(r.entity_type)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  )
}
