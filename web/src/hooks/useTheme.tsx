/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { ITheme } from '@xterm/xterm'

export type ThemeName = 'dark' | 'light'
// 1–3 light (strong → soft), 4–6 dark (soft → strong).
export type ThemeLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface ThemeContextValue {
  theme: ThemeName | null
  level: ThemeLevel
  setTheme: (t: ThemeName) => void
  setLevel: (n: ThemeLevel) => void
  toggle: () => void
  isDark: boolean
  terminalTheme: ITheme
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'wede_theme'
const LEVEL_KEY = 'wede_theme_level'

const defaultLevelForTheme = (t: ThemeName): ThemeLevel => (t === 'light' ? 2 : 5)

// Keep the terminal foreground in sync with the level-aware text tokens.
const LEVEL_TEXT: Record<ThemeLevel, { primary: string; secondary: string; muted: string }> = {
  1: { primary: '#0b1020', secondary: '#374151', muted: '#5b6478' },
  2: { primary: '#111827', secondary: '#4b5577', muted: '#8b91ab' },
  3: { primary: '#1f2937', secondary: '#6b7280', muted: '#9ca3af' },
  4: { primary: '#d8dbe8', secondary: '#8f95ad', muted: '#626984' },
  5: { primary: '#e8eaf2', secondary: '#aeb4ca', muted: '#7c839d' },
  6: { primary: '#f7f8fc', secondary: '#c2c7da', muted: '#9ea5bd' },
}

function loadLevel(): ThemeLevel {
  const raw = Number(localStorage.getItem(LEVEL_KEY))
  if (raw >= 1 && raw <= 6) return raw as ThemeLevel
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light') return 2
  return 5
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
    return null // null = not yet chosen
  })
  const [level, setLevelState] = useState<ThemeLevel>(loadLevel)

  const apply = useCallback((t: ThemeName, n: ThemeLevel) => {
    document.documentElement.setAttribute('data-theme', t)
    document.documentElement.setAttribute('data-level', String(n))
  }, [])

  const setLevel = useCallback((n: ThemeLevel) => {
    const t: ThemeName = n <= 3 ? 'light' : 'dark'
    setLevelState(n)
    setThemeState(t)
    localStorage.setItem(LEVEL_KEY, String(n))
    localStorage.setItem(STORAGE_KEY, t)
    apply(t, n)
  }, [apply])

  const setTheme = useCallback((t: ThemeName) => {
    setLevel(defaultLevelForTheme(t))
  }, [setLevel])

  useEffect(() => {
    if (theme) apply(theme, level)
  }, [theme, level, apply])

  const toggle = useCallback(() => {
    // Mirror the softness: 1↔6, 2↔5, 3↔4.
    setLevel((7 - level) as ThemeLevel)
  }, [level, setLevel])

  const isDark = theme === 'dark' || theme === null
  const text = LEVEL_TEXT[level]

  // Terminal theme — matched to new warm-indigo palette
  const terminalTheme: ITheme = isDark ? {
    background:          '#0e1018',  // --c-bg-tertiary
    foreground:          text.primary,  // --c-text-primary
    cursor:              '#7c8cf8',  // --c-accent
    cursorAccent:        '#0e1018',
    selectionBackground: 'rgba(124, 140, 248, 0.25)',
    black:               '#1e2130',
    red:                 '#f87171',
    green:               '#4ade80',
    yellow:              '#fbbf24',
    blue:                '#7c8cf8',
    magenta:             '#c084fc',
    cyan:                '#22d3ee',
    white:               text.secondary,
    brightBlack:         text.muted,
    brightRed:           '#f87171',
    brightGreen:         '#4ade80',
    brightYellow:        '#fbbf24',
    brightBlue:          '#9aa4fb',
    brightMagenta:       '#c084fc',
    brightCyan:          '#22d3ee',
    brightWhite:         text.primary,
  } : {
    background:          '#ffffff',
    foreground:          '#000000',
    cursor:              '#4f5ff7',
    cursorAccent:        '#ffffff',
    selectionBackground: 'rgba(79, 95, 247, 0.18)',
    black:               '#000000',
    red:                 '#dc2626',
    green:               '#16a34a',
    yellow:              '#d97706',
    blue:                '#4f5ff7',
    magenta:             '#7c3aed',
    cyan:                '#0891b2',
    white:               text.primary,
    brightBlack:         text.muted,
    brightRed:           '#dc2626',
    brightGreen:         '#16a34a',
    brightYellow:        '#d97706',
    brightBlue:          '#3b4bef',
    brightMagenta:       '#7c3aed',
    brightCyan:          '#0891b2',
    brightWhite:         text.primary,
  }

  return (
    <ThemeContext.Provider value={{ theme, level, setTheme, setLevel, toggle, isDark, terminalTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  // Always used within <ThemeProvider> (wraps <App/> in main.tsx); the
  // non-null assertion documents that invariant rather than changing behavior —
  // a misuse outside the provider would already throw when the caller
  // destructures the (previously untyped) undefined result.
  return useContext(ThemeContext)!
}
