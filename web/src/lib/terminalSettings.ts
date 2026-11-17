import type { TerminalSettings } from '../types'

export const TERM_SETTINGS_KEY = 'wede_terminal_settings'

export const DEFAULT_TERM_SETTINGS: TerminalSettings = {
  fontSize: 12, minCols: 0, minRows: 0, scrollback: 5000,
  followMode: 'off', followCursor: false, maximizeOnKeyboard: false, followMargin: 0.2,
  swipeMode: 'wheel', swipeModeDouble: 'cursor',
  swipeStep: 10, writeDelayMs: 250,
}

export function normalizeTermSettings(raw: Partial<TerminalSettings>): TerminalSettings {
  const merged = { ...DEFAULT_TERM_SETTINGS, ...raw }
  // Old settings had no followCursor. Preserve the old 'follow' choice, and
  // make shrink/zoom follow by default so the cursor does not hide behind the
  // keyboard (the shell does not keep it visible the way vim does).
  if (raw.followCursor == null) {
    merged.followCursor = (raw.followMode ?? 'off') !== 'off'
  }
  return merged
}

export function readTermSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(TERM_SETTINGS_KEY)
    if (raw) return normalizeTermSettings(JSON.parse(raw) as Partial<TerminalSettings>)
  } catch { /* ignore */ }
  return { ...DEFAULT_TERM_SETTINGS }
}
