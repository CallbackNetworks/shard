import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { DARK, LIGHT } from '../constants/theme'

const STORAGE_KEY = 'theme_mode'

const ThemeContext = createContext({
  mode: 'dark',
  theme: DARK,
  toggle: () => {},
  setMode: () => {},
})

function applyThemeVars(theme, mode) {
  const root = document.documentElement
  root.setAttribute('data-theme', mode)
  // Set CSS custom properties for components that use CSS vars
  Object.entries(theme).forEach(([key, value]) => {
    root.style.setProperty(`--theme-${key}`, value)
  })
  // Special body styles
  root.style.setProperty('--body-bg', theme.bg)
  root.style.setProperty('--body-text', theme.text)
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'dark'
    } catch {
      return 'dark'
    }
  })

  const theme = mode === 'light' ? LIGHT : DARK

  const setMode = useCallback((m) => {
    setModeState(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch {}
  }, [])

  const toggle = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark')
  }, [mode, setMode])

  useEffect(() => {
    applyThemeVars(theme, mode)
    document.body.style.background = theme.bg
    document.body.style.color = theme.text
  }, [theme, mode])

  const value = useMemo(() => ({ mode, theme, toggle, setMode }), [mode, theme, toggle, setMode])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
