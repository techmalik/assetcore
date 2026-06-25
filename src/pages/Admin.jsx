import { useState } from 'react'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'

const users = [
  {id:1,name:'Adaeze Okeke',email:'a.okeke@ngml.gov.ng',role:'Operations Manager',sites:['All Sites'],status:'Active',last:'14 Jan 2025 · 09:14',initials:'AO',color:'var(--b700)'},
  {id:2,name:'Tunde Fashola',email:'t.fashola@ngml.gov.ng',role:'Senior Technician',sites:['Lagos DS-04'],status:'Active',last:'14 Jan 2025 · 07:50',initials:'TF',color:'var(--b600)'},
  {id:3,name:'Emeka Obi',email:'e.obi@ngml.gov.ng',role:'Technician',sites:['Delta CS','Aba Network'],status:'Active',last:'13 Jan 2025 · 16:30',initials:'EO',color:'var(--sg)'},
  {id:4,name:'Bola Umeh',email:'b.umeh@ngml.gov.ng',role:'Technician',sites:['North Benin'],status:'Active',last:'13 Jan 2025 · 14:12',initials:'BU',color:'var(--sa)'},
  {id:5,name:'Chioma Eze',email:'c.eze@ngml.gov.ng',role:'Compliance Officer',sites:['All Sites'],status:'Active',last:'12 Jan 2025 · 11:00',initials:'CE',color:'var(--sl)'},
  {id:6,name:'Ibrahim Musa',email:'i.musa@ngml.gov.ng',role:'Reports Viewer',sites:['Warri Terminal A'],status:'Inactive',last:'5 Jan 2025 · 09:00',initials:'IM',color:'var(--n400)'},
]

const roles = [
  {name:'Operations Manager',desc:'Full access to all assets, work orders, maintenance, reports, and admin.',perms:['Assets (full)','Work Orders (full)','Maintenance (full)','Compliance (full)','Reports (full)','Admin (full)'],users:1},
  {name:'Senior Technician',desc:'Can create and complete work orders, log maintenance, view compliance.',perms:['Assets (view/edit)','Work Orders (full)','Maintenance (full)','Compliance (view)','Reports (view)'],users:1},
  {name:'Technician',desc:'Can view and update assigned work orders and maintenance tasks.',perms:['Assets (view)','Work Orders (view/update assigned)','Maintenance (view/update assigned)'],users:2},
  {name:'Compliance Officer',desc:'Full access to compliance and inspections. Read-only on assets and WOs.',perms:['Assets (view)','Work Orders (view)','Compliance (full)','Inspections (full)','Reports (view)'],users:1},
  {name:'Reports Viewer',desc:'Read-only access to reports and dashboards.',perms:['Dashboard (view)','Reports (view)'],users:1},
]

export default function Admin({ dark, toggleDark }) {
  const [tab, setTab] = useState('users')
  const [selectedUser, setSelectedUser] = useState(null)

  return (
    <div className="app-shell">
      <Sidebar active="admin"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Users & Roles" dark={dark} toggleDark={toggleDark}/>

        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <div style={{padding:'14px 24px 0',borderBottom:'var(--bdr)',background:'var(--n0)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
              <div>
                <h1 style={{fontFamily:'var(--ff-d)',fontSize:22,fontWeight:700,letterSpacing:'-.3px',color:'var(--n950)'}}>Users & Roles</h1>
                <p style={{fontSize:12,color:'var(--n500)'}}>Manage team members and access control</p>
              </div>
              <div style={{flex:1}}/>
              <button style={{height:32,padding:'0 14px',background:'var(--b500)',color:'#fff',border:'none',borderRadius:4,fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/></svg>
                Invite User
              </button>
            </div>
            <div style={{display:'flex',gap:0}}>
              {[{k:'users',label:'Team Members'},{k:'roles',label:'Roles & Permissions'}].map(t => (
                <button key={t.k} className={`tab-btn${tab===t.k?' active':''}`} onClick={() => setTab(t.k)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div style={{flex:1,overflow:'hidden',display:'flex'}}>
            {tab === 'users' && (
              <>
                <div style={{flex:1,overflowY:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead style={{position:'sticky',top:0,zIndex:10}}>
                      <tr style={{background:'var(--n50)',borderBottom:'var(--bdr)'}}>
                        {['User','Email','Role','Sites','Status','Last Active',''].map(h => (
                          <th key={h} style={{padding:'9px 14px',textAlign:'left',fontSize:10,fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase',color:'var(--n500)',whiteSpace:'nowrap',borderBottom:'var(--bdr)'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="row-hover" onClick={() => setSelectedUser(u)} style={{borderBottom:'var(--bdr)',cursor:'pointer',background:selectedUser?.id===u.id?'var(--b50)':'transparent'}}>
                          <td style={{padding:'11px 14px'}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <div style={{width:28,height:28,borderRadius:'50%',background:u.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:'#fff',flexShrink:0}}>{u.initials}</div>
                              <span style={{fontSize:13,fontWeight:500,color:'var(--n900)',whiteSpace:'nowrap'}}>{u.name}</span>
                            </div>
                          </td>
                          <td style={{padding:'11px 14px',fontSize:12,color:'var(--n600)',whiteSpace:'nowrap'}}>{u.email}</td>
                          <td style={{padding:'11px 14px',fontSize:12,color:'var(--n700)',whiteSpace:'nowrap'}}>{u.role}</td>
                          <td style={{padding:'11px 14px'}}>
                            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                              {u.sites.map(s => (
                                <span key={s} className="badge badge-n" style={{fontSize:10}}>{s}</span>
                              ))}
                            </div>
                          </td>
                          <td style={{padding:'11px 14px'}}>
                            <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:u.status==='Active'?'var(--sgt)':'var(--n500)',fontWeight:500}}>
                              <div style={{width:6,height:6,borderRadius:'50%',background:u.status==='Active'?'var(--sg)':'var(--n300)'}}/>
                              {u.status}
                            </span>
                          </td>
                          <td style={{padding:'11px 14px',fontFamily:'var(--ff-m)',fontSize:11,color:'var(--n500)',whiteSpace:'nowrap'}}>{u.last}</td>
                          <td style={{padding:'11px 14px'}}>
                            <button style={{background:'none',border:'none',cursor:'pointer',color:'var(--n400)'}}>
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="11" r="1" fill="currentColor"/></svg>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedUser && (
                  <div style={{width:300,flexShrink:0,borderLeft:'var(--bdr)',background:'var(--n0)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
                    <div style={{padding:'16px 18px',borderBottom:'var(--bdr)',display:'flex',alignItems:'center',gap:12}}>
                      <div style={{width:36,height:36,borderRadius:'50%',background:selectedUser.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'#fff'}}>{selectedUser.initials}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:'var(--n900)'}}>{selectedUser.name}</div>
                        <div style={{fontSize:11,color:'var(--n500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedUser.email}</div>
                      </div>
                      <button onClick={() => setSelectedUser(null)} style={{width:24,height:24,border:'1px solid var(--n200)',borderRadius:4,background:'var(--n0)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--n500)',flexShrink:0}}>
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                    <div style={{flex:1,overflowY:'auto',padding:'14px 18px',display:'flex',flexDirection:'column',gap:12}}>
                      <div style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,overflow:'hidden'}}>
                        {[
                          ['Role',selectedUser.role],
                          ['Status',selectedUser.status],
                          ['Last active',selectedUser.last],
                        ].map(([k,v]) => (
                          <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'9px 12px',borderBottom:'var(--bdr)',fontSize:12}}>
                            <span style={{color:'var(--n500)'}}>{k}</span>
                            <span style={{color:'var(--n800)',fontWeight:500}}>{v}</span>
                          </div>
                        ))}
                        <div style={{padding:'9px 12px',fontSize:12}}>
                          <div style={{color:'var(--n500)',marginBottom:6}}>Sites</div>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {selectedUser.sites.map(s => <span key={s} className="badge badge-n">{s}</span>)}
                          </div>
                        </div>
                      </div>
                      <button className="btn btn-secondary" style={{height:34,fontSize:12}}>Edit user</button>
                      <button className="btn btn-secondary" style={{height:34,fontSize:12,color:'var(--srt)'}}>Deactivate user</button>
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === 'roles' && (
              <div style={{flex:1,overflowY:'auto',padding:'20px 24px'}}>
                <div style={{display:'flex',flexDirection:'column',gap:10,maxWidth:780}}>
                  {roles.map(r => (
                    <div key={r.name} style={{background:'var(--n0)',border:'var(--bdr)',borderRadius:6,padding:'16px 18px'}}>
                      <div style={{display:'flex',alignItems:'flex-start',gap:12,marginBottom:10}}>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14,fontWeight:600,color:'var(--n900)',marginBottom:3}}>{r.name}</div>
                          <div style={{fontSize:12,color:'var(--n500)',lineHeight:1.5}}>{r.desc}</div>
                        </div>
                        <span style={{background:'var(--b50)',color:'var(--b700)',border:'1px solid var(--b200)',borderRadius:2,fontSize:11,fontWeight:500,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>{r.users} user{r.users>1?'s':''}</span>
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {r.perms.map(p => (
                          <span key={p} style={{background:'var(--n50)',color:'var(--n700)',border:'1px solid var(--n200)',borderRadius:3,fontSize:11,padding:'2px 8px'}}>{p}</span>
                        ))}
                      </div>
                    </div>
                  ))}

                  <button style={{height:36,padding:'0 16px',border:'1px dashed var(--n300)',borderRadius:6,background:'transparent',fontSize:13,color:'var(--n500)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                    Create custom role
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
