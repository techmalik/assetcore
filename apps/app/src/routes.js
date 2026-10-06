import { ADMIN_ENTRY_CAPS } from './lib/rbac'

/**
 * Every signed-in page: its path, its label and icon in the sidebar, who may
 * open it, and which part of the sidebar lists it (`section`: operations,
 * report or account; none for pages reached from another page).
 *
 * App.jsx gates each route with canOpen and Sidebar lists them with it, so a
 * page and its menu entry cannot disagree about who may see them. They used
 * to be written out twice, and had drifted: /inspections was open to every
 * role while the menu kept it behind inspection:read.
 *
 * `soon` lists a page in the sidebar but makes the entry inert.
 */
export const ROUTES = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: 'dashboard', section: 'operations' },
  { key: 'assets', path: '/assets', label: 'Assets', icon: 'assets', section: 'operations' },
  // The map and the scanner are both ways into the asset register, and both
  // were unreachable without knowing the URL — the scanner especially, which
  // is the one a technician standing at the plant actually wants.
  { key: 'asset-map', path: '/asset-map', label: 'Asset Map', icon: 'map', section: 'operations' },
  { key: 'scan', path: '/scan', label: 'Scan Tag', icon: 'scan', section: 'operations' },
  { key: 'work-orders', path: '/work-orders', label: 'Work Orders', icon: 'workorders', section: 'operations' },
  { key: 'maintenance', path: '/maintenance', label: 'Maintenance', icon: 'maintenance', section: 'operations', cap: 'pm:read' },
  { key: 'calendar', path: '/calendar', label: 'Calendar', icon: 'calendar', section: 'operations' },
  { key: 'integrity', path: '/integrity', label: 'Integrity', icon: 'integrity', section: 'operations', anyCap: ['inspection:read', 'defect:read', 'risk:read'] },
  { key: 'approvals', path: '/approvals', label: 'Approvals', icon: 'approvals', section: 'operations', cap: 'approval:read' },
  { key: 'devices', path: '/devices', label: 'Devices', icon: 'devices', section: 'operations' },
  // Spare parts is being reworked into warehouse inventory. Listed so people
  // know it is coming.
  { key: 'spare-parts', path: '/spare-parts', label: 'Warehouse Inventory', icon: 'spareParts', section: 'operations', soon: true },

  { key: 'compliance', path: '/compliance', label: 'Compliance', icon: 'compliance', section: 'report', cap: 'compliance:read' },
  { key: 'depreciation', path: '/depreciation', label: 'Depreciation', icon: 'depreciation', section: 'report', cap: 'depreciation:read' },
  { key: 'analytics', path: '/analytics', label: 'Analytics', icon: 'analytics', section: 'report', cap: 'report:read' },
  { key: 'export', path: '/export', label: 'Export', icon: 'reports', section: 'report', cap: 'report:read' },

  { key: 'notifications', path: '/notifications', label: 'Notifications', icon: 'notifications', section: 'account' },
  { key: 'admin', path: '/admin', label: 'Admin', icon: 'users', section: 'account', anyCap: ADMIN_ENTRY_CAPS },
  { key: 'integrations', path: '/integrations', label: 'Integrations', icon: 'integrations', section: 'account' },
  { key: 'settings', path: '/settings', label: 'Settings', icon: 'settings', section: 'account' },

  // Reached through Integrity's tabs rather than the sidebar.
  { key: 'defects', path: '/defects', label: 'Defects', cap: 'defect:read' },
  { key: 'risks', path: '/risks', label: 'Risk', cap: 'risk:read' },
  { key: 'inspections', path: '/inspections', label: 'Inspections', cap: 'inspection:read' },
]

/** Whether `can` (from useCan) lets the caller open `route`. */
export function canOpen(route, can) {
  return (!route.cap || can(route.cap)) && (!route.anyCap || route.anyCap.some((c) => can(c)))
}
