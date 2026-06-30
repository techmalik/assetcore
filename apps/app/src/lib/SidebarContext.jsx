import { createContext, useContext, useState, useCallback } from 'react'

const SidebarContext = createContext({ isOpen: false, toggle: () => {}, close: () => {} })

export function SidebarProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const toggle = useCallback(() => setIsOpen(o => !o), [])
  const close  = useCallback(() => setIsOpen(false), [])
  return (
    <SidebarContext.Provider value={{ isOpen, toggle, close }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const useSidebar = () => useContext(SidebarContext)
