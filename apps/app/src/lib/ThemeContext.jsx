import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// A theme is a preference, not a session: it has to survive a reload, and the
// first visit should follow the operating system rather than assume light.
// Stored per browser, not per account — the same person on a bright control
// room screen and a dark cab wants different answers.
const THEME_KEY = 'assetcore:theme'

function preferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved === 'dark'
  } catch { /* private window, or storage disabled */ }
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : '')
}

const ThemeContext = createContext({ dark: false, toggleDark: () => {} })

/**
 * Light or dark, for the whole app. It used to be held in App and passed as
 * props through every page only to reach the top bar's menu.
 */
export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(preferredTheme)

  // The attribute lives on <html>, which React does not own, so it has to be
  // written on mount as well as on toggle — otherwise a remembered preference
  // is in state and invisible.
  useEffect(() => { applyTheme(dark) }, [dark])

  const toggleDark = useCallback(() => {
    setDark((d) => {
      const next = !d
      try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light') } catch { /* private window */ }
      return next
    })
  }, [])

  const value = useMemo(() => ({ dark, toggleDark }), [dark, toggleDark])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
