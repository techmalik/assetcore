// Thin page shell. The feature itself lives in components/CompliancePanel.jsx
// so the Maintenance page's Compliance tab can mount the same live register
// instead of the hardcoded demo licences it used to render.
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar.jsx'
import Topbar from '../components/Topbar.jsx'
import CompliancePanel from '../components/CompliancePanel.jsx'

export default function Compliance({ dark, toggleDark }) {
  // ?id=<uuid> is how a notification deep-links to a specific licence.
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get('id')

  return (
    <div className="app-shell">
      <Sidebar active="compliance"/>
      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Topbar breadcrumb="Compliance" dark={dark} toggleDark={toggleDark}/>
        <CompliancePanel selectedId={selectedId} />
      </div>
    </div>
  )
}
