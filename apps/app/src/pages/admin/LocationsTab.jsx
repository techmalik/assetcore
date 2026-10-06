import { useState } from 'react'
import { listLocations, createLocation, updateLocation, softDeleteLocation } from '../../lib/db/locations.js'
import { useToast } from '../../lib/ToastContext'
import { errorText } from '../../lib/errors'
import { useConfirm } from '../../lib/ConfirmContext'
import { useResource } from '../../lib/useResource'
import TableState from '../../components/TableState.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import NameCodeModal from './NameCodeModal.jsx'

// ── Locations Tab ─────────────────────────────────────────────────────────────

export default function LocationsTab() {
  const toast = useToast()
  const ask = useConfirm()
  const { data: locations, loading, error, reload: load } = useResource(listLocations, [], { initial: [], keepPrevious: true })
  const [modal, setModal] = useState(null)

  async function archive(id) {
    if (!(await ask('Archive this location? Its sites keep working but lose their location link.', { danger: true, confirmLabel: 'Archive' }))) return
    try { await softDeleteLocation(id); load() } catch (e) { toast.error(errorText(e)) }
  }

  return (
    <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--n800)'}}>Locations ({locations.length})</div>
        <button className="btn btn-primary" style={{height:32,padding:'0 14px',fontSize:13}} onClick={() => setModal('new')}>+ Add Location</button>
      </div>
      <TableState
        loading={loading} error={error} onRetry={load}
        isEmpty={locations.length === 0}
        empty={<EmptyState title="No locations yet" body="A location groups one or more sites; staff can be scoped to whole locations." />}
      >
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:10}}>
          {locations.map(l => (
            <div key={l.id} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'14px 16px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>📍 {l.name}</div>
                  <div style={{fontSize:11,color:'var(--n500)',marginTop:2}}>{l.site_count} site{l.site_count !== 1 ? 's' : ''}{l.code ? ` · ${l.code}` : ''}</div>
                </div>
                <div style={{display:'flex',gap:4}}>
                  <button onClick={() => setModal(l)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--n200)',borderRadius:3,background:'var(--n0)',fontSize:11,color:'var(--n600)',cursor:'pointer'}}>Edit</button>
                  <button onClick={() => archive(l.id)} className="row-action" style={{padding:'3px 8px',border:'1px solid var(--srbr)',borderRadius:3,background:'var(--srb)',fontSize:11,color:'var(--srt)',cursor:'pointer'}}>Archive</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </TableState>
      {modal && (
        <NameCodeModal
          title={modal === 'new' ? 'Add Location' : 'Edit Location'}
          record={modal === 'new' ? null : modal}
          name={{ label: 'Location Name', placeholder: 'e.g. Lagos' }}
          code={{ label: 'Short Code', placeholder: 'e.g. LG' }}
          save={(form) => (modal === 'new' ? createLocation(form) : updateLocation(modal.id, form))}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
