/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { ITheme } from '@xterm/xterm'

export type ThemeName = 'dark' | 'light'
// Slider stops: 1–3 night (black bg, dim→bright text), 3.5 high-contrast
// black, 4–6 evening (gray bg, dim→bright text), 7–9 day (light bg,
// dark→darkest text). 3.5 sits between the night and evening zones without
// renumbering existing stored levels.
export const THEME_LEVEL_STOPS = [1, 2, 3, 3.5, 4, 5, 6, 7, 8, 9] as const
export type ThemeLevel = (typeof THEME_LEVEL_STOPS)[number]

export interface ThemeContextValue {
  theme: ThemeName
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

const defaultLevelForTheme = (t: ThemeName): ThemeLevel => (t === 'light' ? 8 : 5)

// Keep the terminal foreground in sync with the level-aware text tokens.
const LEVEL_TEXT: Record<ThemeLevel, { primary: string; secondary: string; muted: string }> = {
  1: { primary: '#667', secondary: '#556', muted: '#445' },
  2: { primary: '#889', secondary: '#6a7080', muted: '#505560' },
  3: { primary: '#b3b9c6', secondary: '#858c9d', muted: '#5e6472' },
  3.5: { primary: '#ffffff', secondary: '#e6e9f0', muted: '#b8bfcc' },
  4: { primary: '#889', secondary: '#6a7080', muted: '#505560' },
  5: { primary: '#b3b9c6', secondary: '#858c9d', muted: '#5e6472' },
  6: { primary: '#d0d4dc', secondary: '#a8adb8', muted: '#7a8090' },
  7: { primary: '#333', secondary: '#4a4a4a', muted: '#666' },
  8: { primary: '#222', secondary: '#3a3a3a', muted: '#555' },
  9: { primary: '#111', secondary: '#2a2a2a', muted: '#444' },
}

function loadLevel(): ThemeLevel {
  const raw = Number(localStorage.getItem(LEVEL_KEY))
  if (THEME_LEVEL_STOPS.includes(raw as ThemeLevel)) return raw as ThemeLevel
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light') return 8
  return 5
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
    return 'dark' // default to dark on first visit, skip theme picker
  })
  const [level, setLevelState] = useState<ThemeLevel>(loadLevel)

  const apply = useCallback((t: ThemeName, n: ThemeLevel) => {
    document.documentElement.setAttribute('data-theme', t)
    document.documentElement.setAttribute('data-level', String(n))
  }, [])

  const setLevel = useCallback((n: ThemeLevel) => {
    const t: ThemeName = n <= 6 ? 'dark' : 'light'
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
    // Mirror across the slider stops. The 3.5 stop has no exact integer mirror,
    // so it lands on 6 (the bright end of the evening zone).
    if (level === 3.5) {
      setLevel(6)
      return
    }
    setLevel((10 - level) as ThemeLevel)
  }, [level, setLevel])

  const isDark = theme === 'dark'
  const text = LEVEL_TEXT[level]

  // Terminal colors vary by level zone
  const nightColors = level === 1
    ? { accent: '#6a74b0', accentHover: '#7d87c0', green: '#5a9a6a', red: '#a07070', yellow: '#a09050', peach: '#a07848', mauve: '#8a74b0', cyan: '#5a909a', pink: '#a06a88', selection: 'rgba(106, 116, 176, 0.18)' }
    : level === 2
      ? { accent: '#7a85c4', accentHover: '#8d92d0', green: '#65a878', red: '#b07a7a', yellow: '#b09a58', peach: '#b08050', mauve: '#9680c0', cyan: '#6598a4', pink: '#b07894', selection: 'rgba(122, 133, 196, 0.18)' }
      : level === 3.5
        ? { accent: '#aab4ff', accentHover: '#c4ccff', green: '#7dff9f', red: '#ff9a9a', yellow: '#ffe08a', peach: '#ffb080', mauve: '#d9b8ff', cyan: '#8fe8f2', pink: '#ffa8cc', selection: 'rgba(170, 180, 255, 0.30)' }
        : { accent: '#8b96e8', accentHover: '#a3abec', green: '#74c690', red: '#e08585', yellow: '#d9b968', peach: '#d99363', mauve: '#b596d9', cyan: '#77bfcb', pink: '#d68aac', selection: 'rgba(139, 150, 232, 0.20)' }

  const eveningColors = level === 4
    ? { accent: '#7a85c4', accentHover: '#8d92d0', green: '#65a878', red: '#b07a7a', yellow: '#b09a58', peach: '#b08050', mauve: '#9680c0', cyan: '#6598a4', pink: '#b07894', selection: 'rgba(122, 133, 196, 0.18)' }
    : level === 6
      ? { accent: '#9aa4f0', accentHover: '#b0b8f5', green: '#88d8a0', red: '#f09090', yellow: '#e8c870', peach: '#e8a070', mauve: '#c4a4e8', cyan: '#88d0dc', pink: '#e898bc', selection: 'rgba(154, 164, 240, 0.22)' }
      : { accent: '#8b96e8', accentHover: '#a3abec', green: '#74c690', red: '#e08585', yellow: '#d9b968', peach: '#d99363', mauve: '#b596d9', cyan: '#77bfcb', pink: '#d68aac', selection: 'rgba(139, 150, 232, 0.20)' }

  const dayColors = level === 7
    ? { accent: '#4f5ff7', accentHover: '#3b4bef', green: '#15803d', red: '#b91c1c', yellow: '#a16207', peach: '#c2410c', mauve: '#6d28d9', cyan: '#0e7490', pink: '#be185d', selection: 'rgba(79, 95, 247, 0.18)' }
    : level === 9
      ? { accent: '#3b4bef', accentHover: '#2a38d8', green: '#0a6020', red: '#901010', yellow: '#784804', peach: '#883006', mauve: '#4818a0', cyan: '#045068', pink: '#881040', selection: 'rgba(59, 75, 239, 0.18)' }
      : { accent: '#4550e8', accentHover: '#3340d8', green: '#107030', red: '#a81818', yellow: '#905806', peach: '#a83808', mauve: '#5c20c0', cyan: '#086080', pink: '#a81450', selection: 'rgba(69, 80, 232, 0.18)' }

  // Terminal background depends on the level zone
  const terminalBg = level < 4 ? '#000000' : level <= 6 ? '#1a1a1a' : '#ffffff'
  const terminalCursorAccent = level <= 6 ? '#000000' : '#ffffff'
  const darkOrDayColors = level < 4 ? nightColors : level <= 6 ? eveningColors : dayColors

  const terminalTheme: ITheme = isDark ? {
    background:          terminalBg,
    foreground:          text.primary,
    cursor:              darkOrDayColors.accent,
    cursorAccent:        terminalCursorAccent,
    selectionBackground: darkOrDayColors.selection,
    black:               level < 4 ? '#1b1b1b' : level <= 6 ? '#2a2a2a' : '#000000',
    red:                 darkOrDayColors.red,
    green:               darkOrDayColors.green,
    yellow:              darkOrDayColors.yellow,
    blue:                darkOrDayColors.accent,
    magenta:             darkOrDayColors.mauve,
    cyan:                darkOrDayColors.cyan,
    white:               text.secondary,
    brightBlack:         text.muted,
    brightRed:           darkOrDayColors.red,
    brightGreen:         darkOrDayColors.green,
    brightYellow:        darkOrDayColors.yellow,
    brightBlue:          darkOrDayColors.accentHover,
    brightMagenta:       darkOrDayColors.mauve,
    brightCyan:          darkOrDayColors.cyan,
    brightWhite:         text.primary,
  } : {
    background:          terminalBg,
    foreground:          text.primary,
    cursor:              darkOrDayColors.accent,
    cursorAccent:        terminalCursorAccent,
    selectionBackground: darkOrDayColors.selection,
    black:               level < 4 ? '#1b1b1b' : level <= 6 ? '#2a2a2a' : '#000000',
    red:                 darkOrDayColors.red,
    green:               darkOrDayColors.green,
    yellow:              darkOrDayColors.yellow,
    blue:                darkOrDayColors.accent,
    magenta:             darkOrDayColors.mauve,
    cyan:                darkOrDayColors.cyan,
    white:               text.secondary,
    brightBlack:         text.muted,
    brightRed:           darkOrDayColors.red,
    brightGreen:         darkOrDayColors.green,
    brightYellow:        darkOrDayColors.yellow,
    brightBlue:          darkOrDayColors.accentHover,
    brightMagenta:       darkOrDayColors.mauve,
    brightCyan:          darkOrDayColors.cyan,
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
