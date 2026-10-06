import { useState, useEffect } from 'react'
import { listCategories, createCategory, updateCategory, deleteCategory } from '../../lib/db/categories.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'

// ── Categories Tab ────────────────────────────────────────────────────────────

function CatModal({ cat, onClose, onSave }) {
  const [form, setForm] = useState({ name: cat?.name || '', code: cat?.code || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.code.trim()) { setErr('Name and code are required.'); return }
    setSaving(true)
    try {
      if (cat) await updateCategory(cat.id, form)
      else await createCategory(form)
      onSave()
    } catch (ex) { setErr(errorText(ex)) } finally { setSaving(false) }
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:8,width:380,maxWidth:'92vw',maxHeight:'90vh',overflowY:'auto',padding:24,boxShadow:'var(--sh-lg)'}}>
        <div style={{fontSize:15,fontWeight:600,color:'var(--n900)',marginBottom:18}}>{cat ? 'Edit Category' : 'Add Category'}</div>
        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
          {[['name','Category Name','e.g. Metering Station'],['code','Short Code','e.g. MTR']].map(([k,l,ph]) => (
            <label key={k} style={{display:'flex',flexDirection:'column',gap:4,fontSize:12,color:'var(--n600)'}}>
              {l}
              <input value={form[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} placeholder={ph}
                className="input"/>
            </label>
          ))}
          {err && <div style={{fontSize:12,color:'var(--srt)'}}>{err}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:6}}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function CategoriesTab() {
  const toast = useToast()
  const ask = useConfirm()
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [modal, setModal] = useState(null)

  function load() {
    setLoading(true)
    listCategories().then(c => { setCats(c); setLoading(false) }).catch(e => { setErr(errorText(e)); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    if (!(await ask('Delete this category? This cannot be undone.', { danger: true, confirmLabel: 'Delete' }))) return
    try { await deleteCategory(id); load() } catch (e) { toast.error(errorText(e)) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Asset Categories ({cats.length})</div>
        <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setModal('new')}>+ Add Category</button>
      </div>
      {loading ? (
        <div style={{padding:32,textAlign:'center',color:'var(--n400)',fontSize:13}}>Loading…</div>
      ) : err ? (
        <div style={{padding:12,background:'var(--srb)',border:'1px solid var(--srbr)',borderRadius:6,fontSize:13,color:'var(--srt)'}}>{err}</div>
      ) : cats.length === 0 ? (
        <div style={{padding:48,textAlign:'center',color:'var(--n400)',fontSize:13}}>No categories yet.</div>
      ) : (
        <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden',maxWidth:640}}>
          {cats.map((c, i) => (
            <div key={c.id} style={{display:'flex',alignItems:'center',padding:'11px 14px',borderBottom:i<cats.length-1?'var(--bdr)':'none'}}>
              <span style={{fontFamily:'var(--ff-m)',fontSize:11,fontWeight:600,color:'var(--b600)',background:'var(--b50)',border:'1px solid var(--b200)',borderRadius:3,padding:'1px 7px',marginRight:12,flexShrink:0}}>{c.code}</span>
              <span style={{flex:1,fontSize:13,color:'var(--n900)'}}>{c.name}</span>
              <div style={{display:'flex',gap:6}}>
                <button onClick={() => setModal(c)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                <button onClick={() => remove(c.id)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <CatModal
          cat={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
