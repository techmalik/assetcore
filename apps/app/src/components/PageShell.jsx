import Sidebar from './Sidebar.jsx'
import Topbar from './Topbar.jsx'

/**
 * The frame every signed-in page sits in: the sidebar with `active`
 * highlighted, and a column holding the top bar and the page.
 */
export default function PageShell({ active, breadcrumb, children }) {
  return (
    <div className="app-shell">
      <Sidebar active={active} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar breadcrumb={breadcrumb} />
        {children}
      </div>
    </div>
  )
}
