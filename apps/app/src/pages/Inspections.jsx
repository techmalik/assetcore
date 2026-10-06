// Thin page shell. The feature itself lives in components/InspectionsPanel.jsx
// so the Maintenance page's Inspections tab can mount the same thing instead
// of the "Phase 3 — coming soon" placeholder it used to render.
import { useSearchParams } from 'react-router-dom'
import InspectionsPanel from '../components/InspectionsPanel.jsx'
import IntegrityTabs from '../components/IntegrityTabs.jsx'
import PageShell from '../components/PageShell.jsx'

export default function Inspections() {
  // ?id=<uuid> is how a notification deep-links to a specific inspection.
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get('id')

  return (
    <PageShell active="integrity" breadcrumb="Integrity / Inspections">
        <IntegrityTabs active="inspections" />
        <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
          <InspectionsPanel selectedId={selectedId} />
        </div>
      </PageShell>
  )
}
