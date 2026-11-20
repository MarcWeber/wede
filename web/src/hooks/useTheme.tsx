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
  4: { primary: '#a2a8b6', secondary: '#797f90', muted: '#535966' },
  5: { primary: '#b3b9c6', secondary: '#858c9d', muted: '#5e6472' },
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

  const darkColors = level === 4
    ? {
        accent: '#7f89c9', accentHover: '#929bd4',
        green: '#67ad80', red: '#c97979', yellow: '#bfa25e',
        peach: '#c0845b', mauve: '#a184c4', cyan: '#6ba8b3', pink: '#c07b99',
        selection: 'rgba(127, 137, 201, 0.20)',
      }
    : level === 6
      ? {
          accent: '#7c8cf8', accentHover: '#9aa4fb',
          green: '#4ade80', red: '#f87171', yellow: '#fbbf24',
          peach: '#fb923c', mauve: '#c084fc', cyan: '#22d3ee', pink: '#f472b6',
          selection: 'rgba(124, 140, 248, 0.25)',
        }
      : {
          accent: '#8b96e8', accentHover: '#a3abec',
          green: '#74c690', red: '#e08585', yellow: '#d9b968',
          peach: '#d99363', mauve: '#b596d9', cyan: '#77bfcb', pink: '#d68aac',
          selection: 'rgba(139, 150, 232, 0.22)',
        }

  const terminalTheme: ITheme = isDark ? {
    background:          '#000000',
    foreground:          text.primary,
    cursor:              darkColors.accent,
    cursorAccent:        '#000000',
    selectionBackground: darkColors.selection,
    black:               '#1b1b1b',
    red:                 darkColors.red,
    green:               darkColors.green,
    yellow:              darkColors.yellow,
    blue:                darkColors.accent,
    magenta:             darkColors.mauve,
    cyan:                darkColors.cyan,
    white:               text.secondary,
    brightBlack:         text.muted,
    brightRed:           darkColors.red,
    brightGreen:         darkColors.green,
    brightYellow:        darkColors.yellow,
    brightBlue:          darkColors.accentHover,
    brightMagenta:       darkColors.mauve,
    brightCyan:          darkColors.cyan,
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
