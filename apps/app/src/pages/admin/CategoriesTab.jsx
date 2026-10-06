import { useState } from 'react'
import { listCategories, createCategory, updateCategory, deleteCategory } from '../../lib/db/categories.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'
import { useResource } from '../../lib/useResource'
import TableState from '../../components/TableState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import NameCodeModal from './NameCodeModal.jsx'

// ── Categories Tab ────────────────────────────────────────────────────────────

export default function CategoriesTab() {
  const toast = useToast()
  const ask = useConfirm()
  const { data: cats, loading, error, reload: load } = useResource(listCategories, [], { initial: [], keepPrevious: true })
  const [modal, setModal] = useState(null)

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
      <TableState
        loading={loading} error={error} onRetry={load}
        isEmpty={cats.length === 0}
        empty={<EmptyState title="No categories yet" body="A category groups assets of one kind, and its code starts each asset's number." />}
      >
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
      </TableState>
      {modal && (
        <NameCodeModal
          title={modal === 'new' ? 'Add Category' : 'Edit Category'}
          record={modal === 'new' ? null : modal}
          name={{ label: 'Category Name', placeholder: 'e.g. Metering Station' }}
          code={{ label: 'Short Code', placeholder: 'e.g. MTR', required: true }}
          save={(form) => (modal === 'new' ? createCategory(form) : updateCategory(modal.id, form))}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
