import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const SidebarContext = createContext({
  isOpen: false, toggle: () => {}, close: () => {},
  collapsed: false, toggleCollapsed: () => {},
})

const STORE_KEY = 'assetcore.sidebar.collapsed'

export function SidebarProvider({ children }) {
  // Mobile drawer open/closed.
  const [isOpen, setIsOpen] = useState(false)
  const toggle = useCallback(() => setIsOpen(o => !o), [])
  const close  = useCallback(() => setIsOpen(false), [])

  // Desktop collapsed rail — persisted so the choice survives reloads.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORE_KEY) === '1' } catch { return false }
  })
  const toggleCollapsed = useCallback(() => setCollapsed(c => !c), [])
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  return (
    <SidebarContext.Provider value={{ isOpen, toggle, close, collapsed, toggleCollapsed }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
