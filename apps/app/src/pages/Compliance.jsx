// Thin page shell. The feature itself lives in components/CompliancePanel.jsx
// so the Maintenance page's Compliance tab can mount the same live register
// instead of the hardcoded demo licences it used to render.
import { useSearchParams } from 'react-router-dom'
import CompliancePanel from '../components/CompliancePanel.jsx'
import PageShell from '../components/PageShell.jsx'

export default function Compliance() {
  // ?id=<uuid> is how a notification deep-links to a specific licence.
  const [searchParams] = useSearchParams()
  const selectedId = searchParams.get('id')

  return (
    <PageShell active="compliance" breadcrumb="Compliance">
        <CompliancePanel selectedId={selectedId} />
      </PageShell>
  )
}
