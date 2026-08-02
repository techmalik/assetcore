// Thin page shell. The feature itself lives in components/InspectionsPanel.jsx
// so the Maintenance page's Inspections tab can mount the same thing instead
// of the "Phase 3 — coming soon" placeholder it used to render.
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import InspectionsPanel from '../components/InspectionsPanel.jsx'

export default function Inspections({ dark, toggleDark }) {
  // ?id=<uuid> is how a notification deep-links to a specific inspection.
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get('id')

  return (
    <div className="app-shell">
      <Sidebar active="inspections"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Inspections" dark={dark} toggleDark={toggleDark}/>
        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <InspectionsPanel selectedId={selectedId} />
        </div>
      </div>
    </div>
  )
}
