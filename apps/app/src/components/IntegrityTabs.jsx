import { useNavigate } from 'react-router-dom'
import { useCan } from '../lib/AuthContext.jsx'

const TABS = [
  { key: 'overview', label: 'Overview', path: '/integrity' },
  { key: 'inspections', label: 'Inspections', path: '/inspections', cap: 'inspection:read' },
  { key: 'defects', label: 'Defects', path: '/defects', cap: 'defect:read' },
  { key: 'risks', label: 'Risk', path: '/risks', cap: 'risk:read' },
]

/**
 * Integrity's child modules live in the page, not in the global sidebar.
 * Keeping this strip shared means deep links retain the same local navigation
 * and permission rules as the overview.
 */
export default function IntegrityTabs({ active }) {
  const can = useCan()
  const nav = useNavigate()
  const tabs = TABS.filter((tab) => !tab.cap || can(tab.cap))

  return (
    <div className="integrity-section-tabs">
      <nav className="tab-strip" aria-label="Integrity sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={active === tab.key ? 'page' : undefined}
            className={`tab-btn${active === tab.key ? ' active' : ''}`}
            onClick={() => nav(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
