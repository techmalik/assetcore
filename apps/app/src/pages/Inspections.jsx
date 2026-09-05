import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import { useAuth } from '../lib/AuthContext'
import { can } from '../lib/rbac'
import {
  listInspections, getInspection, createInspection, updateInspection,
  listInspectionTemplates, createInspectionTemplate, retireInspectionTemplate,
  CHECKLIST_RESULTS, CONDITION_RATINGS, RATING_LABEL,
} from '../lib/db/inspections'
import { listSites } from '../lib/db/sites'
import { listAssets } from '../lib/db/assets'
import { createDefect, DEFECT_SEVERITIES } from '../lib/db/defects'

const STATUS_META = {
  scheduled:   { label:'Scheduled',   bg:'var(--slb)', c:'var(--slt)', br:'var(--slbr)' },
  due:         { label:'Due',          bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  in_progress: { label:'In Progress',  bg:'var(--sab)', c:'var(--sat)', br:'var(--sabr)' },
  completed:   { label:'Completed',    bg:'var(--sgb)', c:'var(--sgt)', br:'var(--sgbr)' },
  overdue:     { label:'Overdue',      bg:'var(--srb)', c:'var(--srt)', br:'var(--srbr)' },
}
const KIND_META = {
  safety:        { label:'Safety',        c:'var(--srt)' },
  condition:     { label:'Condition',     c:'var(--sat)' },
  integrity:     { label:'Integrity',     c:'var(--sl)'  },
  regulatory:    { label:'Regulatory',   c:'var(--b600)' },
  environmental: { label:'Environmental', c:'var(--sgt)' },
}
const RESULT_COLOR = { pass: 'var(--sgt)', fail: 'var(--srt)', na: 'var(--n500)', pending: 'var(--n400)' }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })
}

/** The 1-5 outcome, shown as the words people will defend rather than a bare digit. */
function RatingPill({ rating }) {
  if (rating == null) return <span style={{ fontSize:11.5, color:'var(--n400)' }}>Not rated</span>
  const c = rating >= 4 ? 'var(--sgt)' : rating === 3 ? 'var(--sat)' : 'var(--srt)'
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
      <span style={{ fontFamily:'var(--ff-m)', fontSize:12, fontWeight:600, color:c }}>{rating}/5</span>
      <span style={{ fontSize:11.5, color:'var(--n600)' }}>{RATING_LABEL[rating]}</span>
    </span>
  )
}

// ── Create ───────────────────────────────────────────────────────────────────
function InspectionModal({ onClose, onSaved, sites, assets, templates }) {
  const today = new Date().toISOString().slice(0,10)
  const [form, setForm] = useState({ title:'', kind:'condition', scheduled_date:today, site_id:'', asset_id:'', template_id:'', notes:'' })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const picked = templates.find(t => t.id === form.template_id)
  const matching = templates.filter(t => t.kind === form.kind)

  const save = async () => {
    if (!form.title.trim())     return setErr('Title is required.')
    if (!form.scheduled_date)   return setErr('Date is required.')
    setSaving(true); setErr(null)
    try {
      await createInspection({
        title:          form.title.trim(),
        kind:           form.kind,
        scheduled_date: form.scheduled_date,
        site_id:        form.site_id  || null,
        asset_id:       form.asset_id || null,
        template_id:    form.template_id || null,
        notes:          form.notes   || null,
        status:         'scheduled',
      })
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const inp = { height:34, border:'1px solid var(--n200)', borderRadius:4, padding:'0 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', width:'100%', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }
  const lbl = { fontSize:12, fontWeight:500, color:'var(--n800)', display:'flex', flexDirection:'column', gap:4 }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:'24px',width:480,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>New Inspection</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={lbl}>Title *
            <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="e.g. Lagos DS-04 Safety Inspection" style={inp}/>
          </label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={lbl}>Type
              <select value={form.kind} onChange={e=>{ set('kind', e.target.value); set('template_id','') }} style={{...inp,appearance:'none'}}>
                {Object.entries(KIND_META).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </label>
            <label style={lbl}>Scheduled date *
              <input type="date" value={form.scheduled_date} onChange={e=>set('scheduled_date',e.target.value)} style={inp}/>
            </label>
          </div>

          <label style={lbl}>Checklist
            <select value={form.template_id} onChange={e=>set('template_id',e.target.value)} style={{...inp,appearance:'none'}}>
              <option value="">— No checklist —</option>
              {matching.map(t => <option key={t.id} value={t.id}>{t.name} ({t.items.length} items)</option>)}
            </select>
          </label>
          {picked ? (
            <div style={{background:'var(--n50)',border:'var(--bdr)',borderRadius:6,padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'var(--n500)',marginBottom:6}}>The inspector will work through:</div>
              <ol style={{margin:0,paddingLeft:18,fontSize:12,color:'var(--n700)',lineHeight:1.7}}>
                {picked.items.map((it,i) => <li key={i}>{it}</li>)}
              </ol>
            </div>
          ) : (
            <p style={{fontSize:11.5,color:'var(--n500)',lineHeight:1.55,marginTop:-4}}>
              Without a checklist the inspection records findings as free text only. Templates are managed on the Checklists tab.
            </p>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={lbl}>Asset
              <select value={form.asset_id} onChange={e=>set('asset_id',e.target.value)} style={{...inp,appearance:'none'}}>
                <option value="">— Not asset-specific —</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.ain} — {a.name}</option>)}
              </select>
            </label>
            <label style={lbl}>Site
              <select value={form.site_id} onChange={e=>set('site_id',e.target.value)} style={{...inp,appearance:'none'}}>
                <option value="">— Not site-specific —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <label style={lbl}>Notes
            <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows={2} style={{...inp,height:'auto',padding:'8px 10px',resize:'vertical'}}/>
          </label>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Create Inspection'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Carry out ────────────────────────────────────────────────────────────────
/**
 * Completing an inspection is recording what was found, not flipping a status.
 * The checklist is worked item by item, the 1-5 rating is required (the server
 * refuses without it), and anything marked failed can be turned into a defect
 * on the spot — which is what connects a walk-round to the job that fixes it.
 */
function CompleteModal({ inspection, onClose, onSaved }) {
  const [items, setItems]       = useState(() => (inspection.checklist_results || []).map(i => ({ ...i })))
  const [rating, setRating]     = useState(inspection.condition_rating ?? null)
  const [findings, setFindings] = useState(inspection.findings || '')
  const [notes, setNotes]       = useState(inspection.notes    || '')
  const [raise, setRaise]       = useState({})   // item index -> severity, for the defects to raise
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState(null)

  const setItem = (i, patch) => setItems(list => list.map((it, n) => n === i ? { ...it, ...patch } : it))
  const failed = items.map((it, i) => ({ it, i })).filter(({ it }) => it.result === 'fail')

  const save = async () => {
    if (rating == null) return setErr('An overall condition rating is required — it is what the asset’s condition score reads.')
    setSaving(true); setErr(null)
    try {
      await updateInspection(inspection.id, {
        status: 'completed',
        condition_rating: rating,
        findings: findings.trim() || null,
        notes: notes.trim() || null,
        checklist_results: items.length ? items : undefined,
      })
      // Raise a defect for each failed item the inspector asked to escalate.
      for (const [idx, severity] of Object.entries(raise)) {
        const item = items[Number(idx)]
        if (!item || !severity) continue
        await createDefect({
          title: item.item,
          description: item.notes || null,
          severity,
          asset_id: inspection.asset_id,
          site_id: inspection.site_id,
          inspection_id: inspection.id,
        })
      }
      onSaved()
    } catch (e) {
      setErr(e.message === 'condition_rating_required' ? 'An overall condition rating is required.' : e.message)
      setSaving(false)
    }
  }

  const inp = { width:'100%', border:'1px solid var(--n200)', borderRadius:4, padding:'8px 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', resize:'vertical', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)',padding:24}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:620,maxWidth:'94vw',maxHeight:'90vh',display:'flex',flexDirection:'column'}}>
        <div style={{display:'flex',alignItems:'center',padding:'20px 24px 14px',borderBottom:'var(--bdr)'}}>
          <div style={{flex:1,minWidth:0}}>
            <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)'}}>Complete inspection</h2>
            <p style={{fontSize:12,color:'var(--n500)',marginTop:2}}>{inspection.title}</p>
          </div>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>

        <div style={{flex:1,overflowY:'auto',padding:24,display:'flex',flexDirection:'column',gap:18}}>
          {items.length > 0 && (
            <div>
              <div style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)',marginBottom:10}}>Checklist</div>
              <div style={{border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                {items.map((it, i) => (
                  <div key={i} style={{padding:'10px 12px',borderBottom: i < items.length-1 ? 'var(--bdr)' : 'none', background: it.result === 'fail' ? 'var(--srb)' : 'var(--n0)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{flex:1,fontSize:12.5,color:'var(--n800)'}}>{it.item}</span>
                      <div style={{display:'flex',gap:4}}>
                        {CHECKLIST_RESULTS.filter(([v]) => v !== 'pending').map(([v,l]) => (
                          <button key={v} type="button" onClick={() => setItem(i, { result: v })}
                            style={{height:26,padding:'0 10px',borderRadius:4,cursor:'pointer',fontFamily:'inherit',fontSize:11.5,
                              border:`1px solid ${it.result===v ? 'var(--b400)' : 'var(--n200)'}`,
                              background: it.result===v ? 'var(--slb)' : 'var(--n0)',
                              color: it.result===v ? 'var(--slt)' : 'var(--n600)'}}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <input value={it.notes || ''} onChange={e => setItem(i, { notes: e.target.value })}
                      placeholder={it.result === 'fail' ? 'What is wrong?' : 'Notes (optional)'}
                      style={{...inp, height:30, padding:'0 10px', fontSize:12, marginTop:8}}/>
                    {it.result === 'fail' && (
                      <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}>
                        <span style={{fontSize:11.5,color:'var(--n600)'}}>Raise as a defect:</span>
                        <select value={raise[i] || ''} onChange={e => setRaise(r => ({ ...r, [i]: e.target.value }))}
                          style={{...inp, width:180, height:28, padding:'0 8px', fontSize:12}}>
                          <option value="">Not now</option>
                          {DEFECT_SEVERITIES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {failed.length > 0 && (
                <p style={{fontSize:11.5,color:'var(--n500)',marginTop:8,lineHeight:1.55}}>
                  {failed.length} item{failed.length===1?'':'s'} failed. A defect raised here goes onto the register linked to this
                  inspection, ready for a work order.
                </p>
              )}
            </div>
          )}

          <div>
            <div style={{fontSize:11,fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--n500)',fontFamily:'var(--ff-m)',marginBottom:8}}>Overall condition *</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5, 1fr)',gap:6}}>
              {CONDITION_RATINGS.map(([v,l,hint]) => (
                <button key={v} type="button" onClick={() => setRating(v)} title={hint}
                  style={{padding:'9px 6px',borderRadius:5,cursor:'pointer',fontFamily:'inherit',textAlign:'center',
                    border:`1px solid ${rating===v ? 'var(--b400)' : 'var(--n200)'}`,
                    background: rating===v ? 'var(--slb)' : 'var(--n0)'}}>
                  <div style={{fontFamily:'var(--ff-m)',fontSize:15,fontWeight:600,color: rating===v ? 'var(--slt)' : 'var(--n700)'}}>{v}</div>
                  <div style={{fontSize:10.5,color:'var(--n500)',marginTop:2}}>{l}</div>
                </button>
              ))}
            </div>
            <p style={{fontSize:11.5,color:'var(--n500)',marginTop:8,lineHeight:1.55}}>
              This is the signal the asset&apos;s condition score reads — a quarter of it. It is required, because
              a score built on a rating nobody gave would be a guess.
            </p>
          </div>

          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:5}}>Findings
            <textarea value={findings} onChange={e=>setFindings(e.target.value)} rows={3} placeholder="What was observed, measured, or discovered…" style={inp}/>
          </label>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:5}}>Additional notes
            <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} style={inp}/>
          </label>

          {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)'}}>{err}</div>}
        </div>

        <div style={{display:'flex',gap:8,padding:'14px 24px',borderTop:'var(--bdr)',justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving || rating == null} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Mark complete'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Checklist templates ──────────────────────────────────────────────────────
function TemplateModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name:'', kind:'condition', description:'', itemsText:'' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }))
  const items = form.itemsText.split('\n').map(s => s.trim()).filter(Boolean)

  const save = async () => {
    if (!form.name.trim()) return setErr('Give the checklist a name.')
    if (items.length === 0) return setErr('A checklist needs at least one item.')
    setSaving(true); setErr(null)
    try {
      await createInspectionTemplate({
        name: form.name.trim(), kind: form.kind,
        description: form.description.trim() || null, items,
      })
      onSaved()
    } catch (e) {
      setErr(e.message === 'duplicate_name' ? 'A checklist with that name already exists.' : e.message)
      setSaving(false)
    }
  }

  const inp = { width:'100%', border:'1px solid var(--n200)', borderRadius:4, padding:'8px 10px', fontSize:13, fontFamily:'var(--ff-u)', outline:'none', boxSizing:'border-box', background:'var(--n0)', color:'var(--n900)' }

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.35)'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,padding:24,width:480,maxWidth:'92vw'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:18}}>
          <h2 style={{fontFamily:'var(--ff-d)',fontSize:17,fontWeight:700,color:'var(--n950)',flex:1}}>New checklist</h2>
          <button onClick={onClose} style={{width:28,height:28,border:'none',background:'none',cursor:'pointer',color:'var(--n500)',fontSize:20,lineHeight:1}}>×</button>
        </div>
        {err && <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'8px 12px',fontSize:12,color:'var(--srt)',marginBottom:12}}>{err}</div>}
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:5}}>Name *
            <input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Metering station monthly" style={{...inp,height:34,padding:'0 10px'}}/>
          </label>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:5}}>Type
            <select value={form.kind} onChange={e=>set('kind',e.target.value)} style={{...inp,height:34,padding:'0 10px',appearance:'none'}}>
              {Object.entries(KIND_META).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          <label style={{fontSize:12,fontWeight:500,color:'var(--n800)',display:'flex',flexDirection:'column',gap:5}}>Items, one per line *
            <textarea value={form.itemsText} onChange={e=>set('itemsText',e.target.value)} rows={7}
              placeholder={'Check gas leak detector\nVerify pressure gauge calibration\nInspect earth bonding'}
              style={{...inp,resize:'vertical',fontFamily:'var(--ff-m)',fontSize:12.5,lineHeight:1.7}}/>
          </label>
          <p style={{fontSize:11.5,color:'var(--n500)',lineHeight:1.55,marginTop:-4}}>
            {items.length} item{items.length===1?'':'s'}. The checklist is copied onto each inspection when it is
            raised, so editing it later never rewrites an inspection already carried out.
          </p>
        </div>
        <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
          <button onClick={onClose} className="btn btn-secondary" style={{height:34,padding:'0 16px',fontSize:13}}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{height:34,padding:'0 18px',fontSize:13}}>{saving?'Saving…':'Create checklist'}</button>
        </div>
      </div>
    </div>
  )
}

function TemplatesTab({ templates, canEdit, onChanged }) {
  const [modal, setModal] = useState(false)
  const retire = async (id) => { await retireInspectionTemplate(id); onChanged() }

  return (
    <div style={{padding:24}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:16,marginBottom:16}}>
        <p style={{fontSize:12.5,color:'var(--n600)',lineHeight:1.6,maxWidth:620}}>
          The checklist behind an inspection. Until now an inspection recorded a paragraph of findings with
          nothing to tick off, which made two inspections of the same asset impossible to compare.
        </p>
        <div style={{flex:1}}/>
        {canEdit && <button onClick={() => setModal(true)} className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13,whiteSpace:'nowrap'}}>New checklist</button>}
      </div>

      {templates.length === 0 ? (
        <div style={{border:'var(--bdr)',borderRadius:8,padding:40,textAlign:'center',background:'var(--n0)'}}>
          <p style={{fontSize:14,fontWeight:600,color:'var(--n600)',marginBottom:6}}>No checklists yet</p>
          <p style={{fontSize:13,color:'var(--n400)',maxWidth:420,margin:'0 auto 18px',lineHeight:1.6}}>
            Inspections can still be raised without one — they just record free text.
          </p>
          {canEdit && <button onClick={() => setModal(true)} className="btn btn-primary" style={{height:36,padding:'0 18px',fontSize:13}}>Create the first checklist</button>}
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))',gap:12}}>
          {templates.map(t => (
            <div key={t.id} style={{border:'var(--bdr)',borderRadius:8,background:'var(--n0)',overflow:'hidden'}}>
              <div style={{padding:'12px 14px',borderBottom:'var(--bdr)',display:'flex',alignItems:'flex-start',gap:8}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:600,color:'var(--n900)'}}>{t.name}</div>
                  <div style={{fontSize:11,color:(KIND_META[t.kind]||{}).c || 'var(--n500)',marginTop:2}}>{(KIND_META[t.kind]||{}).label || t.kind} · {t.items.length} items</div>
                </div>
                {canEdit && (
                  <button onClick={() => retire(t.id)} title="Retire" style={{background:'none',border:'none',cursor:'pointer',color:'var(--n400)',padding:2,display:'flex'}}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  </button>
                )}
              </div>
              <ol style={{margin:0,padding:'10px 14px 12px 30px',fontSize:12,color:'var(--n700)',lineHeight:1.7}}>
                {t.items.map((it,i) => <li key={i}>{it}</li>)}
              </ol>
            </div>
          ))}
        </div>
      )}

      {modal && <TemplateModal onClose={() => setModal(false)} onSaved={() => { setModal(false); onChanged() }}/>}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Inspections({ dark, toggleDark }) {
  const nav = useNavigate()
  const { roleKey } = useAuth()
  const canCreate = can(roleKey, 'inspection:create')
  const canEdit   = can(roleKey, 'inspection:update')

  const [inspections, setInspections] = useState([])
  const [templates, setTemplates]     = useState([])
  const [sites, setSites]             = useState([])
  const [assets, setAssets]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [err, setErr]                 = useState(null)
  const [modal, setModal]             = useState(null) // null | 'create'
  const [completing, setCompleting]   = useState(null)
  const [tab, setTab]                 = useState('open')

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [insp, siteList, assetList, tpl] = await Promise.all([
        listInspections(), listSites(), listAssets(), listInspectionTemplates(),
      ])
      setInspections(insp); setSites(siteList); setAssets(assetList); setTemplates(tpl)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // The checklist lives on the inspection, and the list endpoint returns it —
  // but the detail call also brings the defects raised from it.
  const openComplete = async (ins) => {
    try { setCompleting(await getInspection(ins.id)) } catch { setCompleting(ins) }
  }

  const open   = inspections.filter(i => i.status !== 'completed')
  const closed = inspections.filter(i => i.status === 'completed')
  const shown  = tab === 'open' ? open : closed

  return (
    <div className="app-shell">
      <Sidebar active="inspections"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Inspections" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Inspections</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Safety, condition, integrity &amp; regulatory inspections</p>
              </div>
              <div style={{flex:1}}/>
              {canCreate && tab !== 'templates' && (
                <button onClick={() => setModal('create')} style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  New Inspection
                </button>
              )}
            </div>
            <div style={{display:'flex',gap:0}}>
              {[
                { k:'open',      label:`Open (${open.length})` },
                { k:'closed',    label:`Completed (${closed.length})` },
                { k:'templates', label:`Checklists (${templates.length})` },
              ].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            {loading ? (
              <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
            ) : err ? (
              <div style={{padding:24}}>
                <div style={{background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:4,padding:'10px 14px',fontSize:12,color:'var(--srt)'}}>{err}</div>
              </div>
            ) : tab === 'templates' ? (
              <TemplatesTab templates={templates} canEdit={canEdit} onChanged={load}/>
            ) : shown.length === 0 ? (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'60px 20px',gap:12,textAlign:'center'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="var(--n300)" strokeWidth="1.4"/><path d="M8 9h8M8 13h5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/><path d="M16 16l1.5 1.5" stroke="var(--n300)" strokeWidth="1.4" strokeLinecap="round"/><circle cx="15" cy="15" r="2" stroke="var(--n300)" strokeWidth="1.4"/></svg>
                <div style={{fontSize:14,fontWeight:600,color:'var(--n700)'}}>{tab==='open' ? 'No open inspections' : 'No completed inspections'}</div>
                {tab==='open' && canCreate && <button onClick={() => setModal('create')} className="btn btn-primary" style={{marginTop:8,height:34,padding:'0 16px',fontSize:13}}>Schedule first inspection</button>}
              </div>
            ) : (
              <table style={{width:'100%',borderCollapse:'collapse'}}>
                <thead style={{position:'sticky',top:0,zIndex:10}}>
                  <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                    {['Title','Type','Asset','Date','Condition','Defects','Status',''].map(h => (
                      <th key={h} style={{padding:'8px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(ins => {
                    const sm = STATUS_META[ins.status] || STATUS_META.scheduled
                    const km = KIND_META[ins.kind] || KIND_META.condition
                    const checked = (ins.checklist_results || []).filter(i => i.result && i.result !== 'pending').length
                    const total   = (ins.checklist_results || []).length
                    return (
                      <tr key={ins.id} className="row-hover" style={{borderBottom:'var(--bdr)'}}>
                        <td style={{padding:'11px 14px'}}>
                          <div style={{fontSize:13,fontWeight:500,color:'var(--n900)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ins.title}</div>
                          {total > 0 && (
                            <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>
                              {ins.template?.name ? `${ins.template.name} · ` : ''}{checked}/{total} checked
                            </div>
                          )}
                        </td>
                        <td style={{padding:'11px 14px',whiteSpace:'nowrap'}}>
                          <span style={{fontSize:11,fontWeight:500,color:km.c}}>{km.label}</span>
                        </td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n700)',whiteSpace:'nowrap'}}>{ins.asset?.ain || '—'}</td>
                        <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n600)',whiteSpace:'nowrap'}}>
                          {fmtDate(ins.completed_date || ins.scheduled_date)}
                        </td>
                        <td style={{padding:'11px 14px'}}><RatingPill rating={ins.condition_rating}/></td>
                        <td style={{padding:'11px 14px',whiteSpace:'nowrap'}}>
                          {ins.defect_count > 0
                            ? <button onClick={() => nav('/defects')} style={{fontSize:11.5,color:'var(--srt)',background:'none',border:'none',cursor:'pointer',padding:0}}>{ins.defect_count} raised</button>
                            : <span style={{fontSize:11.5,color:'var(--n400)'}}>—</span>}
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          <span style={{display:'inline-flex',padding:'2px 7px',borderRadius:2,border:`1px solid ${sm.br}`,fontSize:10,fontWeight:500,background:sm.bg,color:sm.c}}>{sm.label}</span>
                        </td>
                        <td style={{padding:'11px 14px'}}>
                          {ins.status !== 'completed' && canEdit && (
                            <button onClick={() => openComplete(ins)} style={{fontSize:11,color:'var(--b600)',background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>Carry out</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {modal === 'create' && (
        <InspectionModal sites={sites} assets={assets} templates={templates}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }}/>
      )}
      {completing && (
        <CompleteModal inspection={completing}
          onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); load() }}/>
      )}
    </div>
  )
}
