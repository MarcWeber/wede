// Configurable terminal action grid. The model is intentionally dumb: a cell
// id ("B2") maps 9 slots (8 swipe directions + tap) to action strings. Special
// actions are handled by TerminalToolbar; key actions decode to PTY bytes here.

export type GridRow = 'A' | 'B' | 'C'
export type GridCol = 1 | 2 | 3 | 4 | 5
export type CellId = `${GridRow}${GridCol}`
export type Dir = 'tl' | 't' | 'tr' | 'l' | 'T' | 'r' | 'bl' | 'b' | 'br'
export type SwipeDir = Exclude<Dir, 'T'>
export type CellActions = Partial<Record<Dir, string>>
export type GridConfig = Partial<Record<CellId, CellActions>>

export const GRID_KEY = 'wede_terminal_grid'
export const CELL_PX = 44
export const RADIAL_PX = 148

export const DIRS: Dir[] = ['tl', 't', 'tr', 'l', 'T', 'r', 'bl', 'b', 'br']
export const SWIPE_DIRS: SwipeDir[] = ['tl', 't', 'tr', 'l', 'r', 'bl', 'b', 'br']

export interface SpecialAction {
  label: string
  title: string
  description?: string
}

export const SPECIAL_TERMINAL_ACTIONS: Record<string, SpecialAction> = {
  'open-settings': { label: '=', title: 'settings' },
  'select-font-size': { label: 'S', title: 'font size', description: 'Changes the available rows/columns unless min cols/rows is set.' },
  'select-min-columns': { label: 'mC', title: 'min columns', description: 'Keep the terminal at least this wide; scroll horizontally instead.' },
  'select-min-rows': { label: 'mR', title: 'min rows', description: 'Keep the terminal at least this tall; scroll vertically instead.' },
  'select-single-swipe-behavior': { label: '↕', title: 'single-finger swipe', description: 'What one-finger vertical swipes on the terminal send.' },
  'select-double-swipe-behavior': { label: '⇕', title: 'two-finger swipe', description: 'What two-finger vertical swipes on the terminal send.' },
  'toggle-follow-cursor': { label: 'follow', title: 'follow cursor', description: 'Scroll to keep the cursor visible.' },
  'select-dock-position': { label: 'dock', title: 'dock position', description: 'Grid at the top or bottom of the terminal.' },
  'show-help': { label: '?', title: 'help', description: 'How the grid and the default keys work.' },
  'configure-behavior': { label: 'config', title: 'configure behavior', description: 'Assign actions to a grid button.' },
  'reset-to-defaults': { label: 'reset', title: 'reset to defaults', description: 'Restore the default 2x2 grid.' },
  'show-more': { label: 'more', title: 'more keys', description: 'Show extra keys; closes after one is sent.' },
  'show-special-keys': { label: 'keys', title: 'special keys', description: 'Show extra keys; closes after one is sent.' },
}

export function isSpecialAction(action: string): boolean {
  return action in SPECIAL_TERMINAL_ACTIONS
}

const KEY_SEQ: Record<string, string> = {
  tab: '\t', esc: '\x1b', enter: '\r', space: ' ', backspace: '\x7f', delete: '\x1b[3~',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  home: '\x1b[H', end: '\x1b[F', pgup: '\x1b[5~', pgdn: '\x1b[6~',
}
const KEY_LABELS: Record<string, string> = {
  tab: 'Tab', esc: 'Esc', enter: '⏎', space: '␠', backspace: '⌫', delete: 'Del',
  up: '↑', down: '↓', right: '→', left: '←', home: 'Home', end: 'End', pgup: 'PgUp', pgdn: 'PgDn',
}
const FN_SEQ: Record<number, string> = {
  1: '\x1bOP', 2: '\x1bOQ', 3: '\x1bOR', 4: '\x1bOS',
  5: '\x1b[15~', 6: '\x1b[17~', 7: '\x1b[18~', 8: '\x1b[19~',
  9: '\x1b[20~', 10: '\x1b[21~', 11: '\x1b[23~', 12: '\x1b[24~',
}

export function seqForAction(action: string): string | null {
  if (action.startsWith('send-ctrl-')) {
    const c = action.slice(10).toLowerCase()
    return c.length === 1 && c >= 'a' && c <= 'z' ? String.fromCharCode(c.charCodeAt(0) - 96) : null
  }
  if (action.startsWith('send-esc-')) {
    const rest = action.slice(9)
    return rest ? '\x1b' + rest : null
  }
  const fm = /^send-f(\d{1,2})$/.exec(action)
  if (fm) return FN_SEQ[Number(fm[1])] ?? null
  if (action.startsWith('send-key-')) return KEY_SEQ[action.slice(9)] ?? null
  if (action.startsWith('send-text-')) return action.slice(10)
  return null
}

export function actionLabel(action: string): string {
  const sp = SPECIAL_TERMINAL_ACTIONS[action]
  if (sp) return sp.label
  if (action.startsWith('send-ctrl-')) return `C-${action.slice(10).toLowerCase()}`
  if (action.startsWith('send-esc-')) return `Esc-${action.slice(9)}`
  const fm = /^send-f(\d{1,2})$/.exec(action)
  if (fm) return `F${fm[1]}`
  if (action.startsWith('send-key-')) {
    const k = action.slice(9)
    return KEY_LABELS[k] ?? k
  }
  if (action.startsWith('send-text-')) {
    const t = action.slice(10)
    if (t === '\n') return '⏎'
    if (t === ' ') return '␠'
    return t.replace(/\n$/, '')
  }
  return action
}

export function actionTitle(action: string): string {
  const sp = SPECIAL_TERMINAL_ACTIONS[action]
  if (sp) return sp.description ? `${sp.title} — ${sp.description}` : sp.title
  return actionLabel(action)
}

export function cellPrimaryLabel(actions: CellActions | undefined): string {
  if (!actions) return '·'
  const all = Object.values(actions)
  if (all.length && all.every((a) => /^send-f\d{1,2}$/.test(a))) return 'Fx'
  if (actions.T) return actionLabel(actions.T)
  const first = SWIPE_DIRS.find((d) => actions[d])
  return first ? actionLabel(actions[first]!) : '·'
}

export function cellTitle(actions: CellActions | undefined): string {
  if (!actions) return ''
  return DIRS.filter((d) => actions[d]).map((d) => `${d}: ${actionTitle(actions[d]!)}`).join('\n')
}

export function dirFromDelta(dx: number, dy: number): Dir {
  const d = Math.round((Math.atan2(-dy, dx) * 180) / Math.PI / 45)
  if (d === 0) return 'r'
  if (d === 1) return 'tr'
  if (d === 2) return 't'
  if (d === 3) return 'tl'
  if (d === -1) return 'br'
  if (d === -2) return 'b'
  if (d === -3) return 'bl'
  return 'l'
}

export function expandFx(start = 1): CellActions {
  const out: CellActions = {}
  DIRS.forEach((dir, i) => {
    const n = start + i
    if (n <= 12) out[dir] = `send-f${n}`
  })
  return out
}

const F10_12: CellActions = { l: 'send-f10', T: 'send-f11', r: 'send-f12' }
const SPECIAL_CHARS: CellActions = {
  tl: 'send-text-|', t: 'send-text-/', tr: 'send-text--',
  l: 'send-key-tab', T: 'send-text-~', r: 'send-text-$',
  bl: 'send-key-pgup', b: 'send-key-esc', br: 'send-key-pgdn',
}
const HAMBURGER: CellActions = {
  tl: 'send-ctrl-p', t: 'send-text-fg\n', tr: 'send-ctrl-l',
  l: 'send-ctrl-c', T: 'open-settings', r: 'send-key-tab',
  bl: 'send-ctrl-n', b: 'send-ctrl-z', br: 'send-ctrl-r',
}

export interface QuickAssignment {
  label: string
  description: string
  actions: CellActions
}

export const QUICK_ASSIGNMENTS: Record<string, QuickAssignment> = {
  hamburger: { label: '= menu', description: 'tap settings, old swipes', actions: HAMBURGER },
  'special-chars': { label: '~ chars', description: 'Tab ~ $ | / -', actions: SPECIAL_CHARS },
  fx: { label: 'Fx', description: 'F1..F9', actions: expandFx(1) },
  'f10-f12': { label: 'F10-12', description: 'F10 F11 F12', actions: F10_12 },
  'swipe-single': { label: 'swipe 1', description: 'single-finger behavior', actions: { T: 'select-single-swipe-behavior' } },
  'swipe-double': { label: 'swipe 2', description: 'two-finger behavior', actions: { T: 'select-double-swipe-behavior' } },
}

export function defaultGrid(): GridConfig {
  return {
    A1: { T: 'select-single-swipe-behavior', l: 'send-ctrl-u', r: 'send-ctrl-e' },
    A2: { ...QUICK_ASSIGNMENTS.fx.actions },
    B1: { ...QUICK_ASSIGNMENTS['special-chars'].actions },
    B2: { ...QUICK_ASSIGNMENTS.hamburger.actions },
  }
}

export function gridBounds(grid: GridConfig): { rows: number; cols: number } {
  let rows = 0
  let cols = 0
  for (const [id, actions] of Object.entries(grid) as [CellId, CellActions][]) {
    if (!actions || !Object.keys(actions).length) continue
    const row = 'ABC'.indexOf(id[0]) + 1
    const col = Number(id.slice(1))
    if (row > rows) rows = row
    if (col > cols) cols = col
  }
  return { rows, cols }
}

// Render order: row-major, columns from maxCol down to 1 (column 1 is rightmost).
export function gridOrder(grid: GridConfig): CellId[] {
  const { rows, cols } = gridBounds(grid)
  const out: CellId[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = cols; c >= 1; c--) out.push(`${'ABC'[r]}${c}` as CellId)
  }
  return out
}

export function hasSettingsAction(grid: GridConfig): boolean {
  return Object.values(grid).some((a) => a?.T === 'open-settings')
}

export function setCellAction(grid: GridConfig, cell: CellId, dir: Dir, action: string | null): GridConfig {
  const next: GridConfig = { ...grid }
  const actions: CellActions = { ...(grid[cell] ?? {}) }
  if (action) actions[dir] = action
  else delete actions[dir]
  if (Object.keys(actions).length) next[cell] = actions
  else delete next[cell]
  return next
}

export function applyQuick(grid: GridConfig, cell: CellId, quick: string): GridConfig {
  const q = QUICK_ASSIGNMENTS[quick]
  if (!q) return grid
  return { ...grid, [cell]: { ...q.actions } }
}

export function loadGrid(): GridConfig {
  try {
    const raw = localStorage.getItem(GRID_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as GridConfig
      if (parsed && typeof parsed === 'object' && hasSettingsAction(parsed)) return parsed
    }
  } catch { /* ignore */ }
  return defaultGrid()
}

export function saveGrid(grid: GridConfig): void {
  try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)) } catch { /* ignore */ }
}

export type ActionGroup = 'special' | 'fx' | 'ctrl' | 'esc' | 'chars'
export interface ActionItem { id: string; label: string; hint?: string }

export const ACTION_GROUPS: { id: ActionGroup; label: string; description: string }[] = [
  { id: 'special', label: 'special', description: 'settings, sliders, swipe behaviors' },
  { id: 'fx', label: 'Fx', description: 'F1..F12' },
  { id: 'ctrl', label: 'ctrl-x', description: 'Ctrl combinations' },
  { id: 'esc', label: 'esc-x', description: 'Esc combinations' },
  { id: 'chars', label: '~', description: 'special characters' },
]

const CHARS = ['~', '|', '$', '<', '>', '&', '%', '!', '#', '@', '^', '*', '(', ')', '[', ']', '{', '}', ';', ':', "'", '"', '`', ',', '.', '/', '?', '+', '-', '=', '_', ' ']

export function groupItems(group: ActionGroup): ActionItem[] {
  if (group === 'special') {
    return Object.entries(SPECIAL_TERMINAL_ACTIONS).map(([id, s]) => ({ id, label: s.title, hint: s.description }))
  }
  if (group === 'fx') return Array.from({ length: 12 }, (_, i) => ({ id: `send-f${i + 1}`, label: `F${i + 1}` }))
  if (group === 'ctrl') return 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => ({ id: `send-ctrl-${c}`, label: `C-${c}` }))
  if (group === 'esc') return 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => ({ id: `send-esc-${c}`, label: `Esc-${c}` }))
  return CHARS.map((c) => ({ id: `send-text-${c}`, label: c === ' ' ? 'space' : c }))
}

export interface KeyItem { label: string; send: string }

export const KEYS: KeyItem[] = [
  { label: 'Tab', send: '\t' },
  { label: 'Esc', send: '\x1b' },
  { label: '↑', send: '\x1b[A' },
  { label: '↓', send: '\x1b[B' },
  { label: '←', send: '\x1b[D' },
  { label: '→', send: '\x1b[C' },
  { label: 'PgUp', send: '\x1b[5~' },
  { label: 'PgDn', send: '\x1b[6~' },
  { label: 'Home', send: '\x1b[H' },
  { label: 'End', send: '\x1b[F' },
  { label: 'Enter', send: '\r' },
  { label: 'Space', send: ' ' },
  { label: 'Bksp', send: '\x7f' },
]
export const CTRL_KEYS: KeyItem[] = 'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => ({
  label: `C-${c}`,
  send: String.fromCharCode(c.charCodeAt(0) - 96),
}))
export const FN_KEYS: KeyItem[] = Array.from({ length: 12 }, (_, i) => ({
  label: `F${i + 1}`,
  send: FN_SEQ[i + 1],
}))
export const CHAR_KEYS: KeyItem[] = CHARS.map((c) => ({ label: c === ' ' ? 'Space' : c, send: c }))
