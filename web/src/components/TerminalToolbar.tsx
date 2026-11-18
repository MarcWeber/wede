import { useState, useRef, useLayoutEffect, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpToLine, ArrowDownToLine, Eye, EyeOff, Hand, Braces,
  Settings2, HelpCircle, ChevronLeft, RotateCcw, Type, Columns3, Keyboard, X, Droplets, Maximize2,
} from 'lucide-react'
import type { TerminalSettings, TerminalSwipeMode } from '../types'
import TerminalHelp from './TerminalHelp'
import { readTermSettings, TERM_SETTINGS_KEY } from '../lib/terminalSettings'
import {
  CELL_PX, RADIAL_PX, RADIAL_H, FULL_GRID_CELLS, DIRS, ACTION_GROUPS, QUICK_ASSIGNMENTS, KEYS, CTRL_KEYS,
  FN_KEYS, CHAR_KEYS, actionLabel, actionTitle, applyQuick, cellPrimaryLabel,
  cellTitle, defaultGrid, dirFromDelta, gridBounds, gridOrder, groupItems, sanitizeGrid,
  hasSettingsAction, isSpecialAction, loadGrid, saveGrid, seqForAction,
  setCellAction,
  type ActionGroup, type CellId, type CellActions, type Dir, type GridConfig,
} from '../lib/terminalGrid'

export interface TerminalInputDock {
  position: 'top' | 'bottom'
  transparent: boolean
  transparency: number // 0–80, percentage; default 50
}

interface TerminalToolbarProps {
  onSend: (data: string) => void
  dock: TerminalInputDock
  onDockChange: (dock: TerminalInputDock) => void
}

function decodeEscapes(text: string): string {
  return text.replace(/\\([nrte])/g, (_m, c: string) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : '\x1b')
}

const SWIPE_OPTIONS: { mode: TerminalSwipeMode; label: string; hint: string }[] = [
  { mode: 'cursor', label: 'Cursor movement', hint: '↑ / ↓' },
  { mode: 'wheel', label: 'Scroll events', hint: 'mouse wheel' },
  { mode: 'page', label: 'PgUp / PgDn', hint: 'e.g. opencode, less' },
  { mode: 'half', label: 'Vim C-u / C-d', hint: 'half page' },
  { mode: 'emacs', label: 'Emacs C-v / M-v', hint: 'one page' },
  { mode: 'scroll', label: 'Native scroll', hint: 'scrollback' },
]

type View =
  | 'settings' | 'dock' | 'font' | 'min' | 'followMode' | 'followMargin' | 'json'
  | 'swipeSingle' | 'swipeDouble' | 'help' | 'keys' | 'transparency'
  | 'arrowSpeed' | 'configure' | 'slot' | 'group' | 'actions'

// TerminalToolbar — a floating, configurable grid of action buttons. Tap runs
// the cell's T action, swiping runs the action for that direction, and a long
// press opens a radial menu with the assigned directions.
export default function TerminalToolbar({ onSend, dock, onDockChange }: TerminalToolbarProps) {
  const [grid, setGrid] = useState<GridConfig>(() => loadGrid())
  const [view, setView] = useState<View | null>(null)
  const [cfgCell, setCfgCell] = useState<CellId | null>(null)
  const [cfgDir, setCfgDir] = useState<Dir | null>(null)
  const [cfgGroup, setCfgGroup] = useState<ActionGroup | null>(null)
  const [cfgError, setCfgError] = useState<string | null>(null)
  const [radial, setRadial] = useState<{ id: CellId; left: number; top: number } | null>(null)
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonMsg, setJsonMsg] = useState<string | null>(null)
  const [customText, setCustomText] = useState('')

  const gridRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<{ id: CellId; x: number; y: number; t: number; moved: boolean; long: boolean } | null>(null)
  const longTimerRef = useRef<number | null>(null)
  const mouseTimerRef = useRef<number | null>(null)
  const lastTouchAtRef = useRef(0)
  const suppressClickRef = useRef(false)
  const suppressRadialClickRef = useRef(false)

  const [termSettings, setTermSettings] = useState<TerminalSettings>(readTermSettings)
  const saveTermSettings = (s: TerminalSettings) => {
    setTermSettings(s)
    try { localStorage.setItem(TERM_SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent<unknown>('wede:term-settings'))
  }
  const setDock = (patch: Partial<TerminalInputDock>) => onDockChange({ ...dock, ...patch })

  const commitGrid = (next: GridConfig) => { setGrid(next); saveGrid(next) }
  const resetGrid = () => { commitGrid(defaultGrid()); setCfgError(null) }
  const applyJson = (text: string) => {
    try {
      const parsed = sanitizeGrid(JSON.parse(text))
      if (!parsed) { setJsonMsg('invalid grid: keep at least one settings action'); return }
      commitGrid(parsed)
      setJsonMsg('applied')
    } catch {
      setJsonMsg('invalid JSON')
    }
  }
  const downloadJson = () => {
    const blob = new Blob([jsonText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'wede-terminal-grid.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const runSpecial = (id: string) => {
    switch (id) {
      case 'open-settings': setView('settings'); break
      case 'select-font-size': setView('font'); break
      case 'select-min': setView('min'); break
      case 'select-single-swipe-behavior': setView('swipeSingle'); break
      case 'select-double-swipe-behavior': setView('swipeDouble'); break
      case 'select-follow-mode': setView('followMode'); break
      case 'select-follow-margin': setView('followMargin'); break
      case 'select-dock-position': setView('dock'); break
      case 'show-help': setView('help'); break
      case 'show-json-config': setJsonText(JSON.stringify(grid, null, 2)); setJsonMsg(null); setView('json'); break
      case 'configure-behavior': setCfgCell(null); setCfgError(null); setView('configure'); break
      case 'reset-to-defaults': resetGrid(); break
      case 'show-more':
      case 'show-special-keys': setView('keys'); break
      case 'select-arrow-speeds': setView('arrowSpeed'); break
    }
  }
  const runAction = (action: string | undefined) => {
    if (!action) return
    if (isSpecialAction(action)) { runSpecial(action); return }
    const seq = seqForAction(action)
    if (seq != null) onSend(seq)
  }

  const closeRadial = () => setRadial(null)
  const showRadial = useCallback((id: CellId, rect: DOMRect) => {
    const margin = 8
    const vv = window.visualViewport
    const vw = vv?.width ?? window.innerWidth
    const vh = vv?.height ?? window.innerHeight
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    suppressRadialClickRef.current = true
    window.setTimeout(() => { suppressRadialClickRef.current = false }, 500)
    setRadial({
      id,
      left: Math.min(Math.max(margin, cx - RADIAL_PX / 2), vw - margin - RADIAL_PX),
      top: Math.min(Math.max(margin, cy - RADIAL_H / 2), vh - margin - RADIAL_H),
    })
  }, [])

  const clearLong = () => {
    if (longTimerRef.current != null) {
      clearTimeout(longTimerRef.current)
      longTimerRef.current = null
    }
  }
  const onCellDown = (e: React.TouchEvent, id: CellId) => {
    const t = e.touches[0]
    lastTouchAtRef.current = Date.now()
    gestureRef.current = { id, x: t.clientX, y: t.clientY, t: Date.now(), moved: false, long: false }
    suppressClickRef.current = false
    clearLong()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    longTimerRef.current = window.setTimeout(() => {
      const g = gestureRef.current
      if (!g || g.moved) return
      g.long = true
      suppressClickRef.current = true
      showRadial(id, rect)
    }, 450)
  }
  const onCellMove = (e: React.TouchEvent) => {
    const g = gestureRef.current
    if (!g) return
    const t = e.touches[0]
    if (Math.hypot(t.clientX - g.x, t.clientY - g.y) > 10) {
      g.moved = true
      clearLong()
    }
  }
  const onCellUp = (e: React.TouchEvent, id: CellId) => {
    clearLong()
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    if (g.long) return
    const t = e.changedTouches[0]
    const dx = t.clientX - g.x
    const dy = t.clientY - g.y
    if (Math.hypot(dx, dy) > 30 && Date.now() - g.t < 600) {
      suppressClickRef.current = true
      runAction(grid[id]?.[dirFromDelta(dx, dy)])
      e.preventDefault()
    }
  }
  const onCellCancel = () => { clearLong(); gestureRef.current = null }
  const clearMouseLong = () => {
    if (mouseTimerRef.current != null) {
      clearTimeout(mouseTimerRef.current)
      mouseTimerRef.current = null
    }
  }
  const onCellMouseDown = (e: React.MouseEvent, id: CellId) => {
    if (e.button !== 0) return
    // Synthetic mouse events follow a real touch; the touch handlers already
    // open the radial and would otherwise get a second one here.
    if (Date.now() - lastTouchAtRef.current < 600) return
    clearMouseLong()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    mouseTimerRef.current = window.setTimeout(() => {
      mouseTimerRef.current = null
      suppressClickRef.current = true
      showRadial(id, rect)
    }, 450)
  }
  const onCellMouseMove = (e: React.MouseEvent) => {
    if (mouseTimerRef.current == null) return
    if (Math.hypot(e.movementX, e.movementY) > 2) clearMouseLong()
  }
  const onCellMouseUp = () => { clearMouseLong() }
  const onCellClick = (e: React.MouseEvent, id: CellId) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    const actions = grid[id]
    if (!actions) return
    if (actions.T) runAction(actions.T)
    else showRadial(id, (e.currentTarget as HTMLElement).getBoundingClientRect())
  }

  const placeMenu = useCallback(() => {
    const el = gridRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    const vv = window.visualViewport
    const vw = vv?.width ?? window.innerWidth
    const vh = vv?.height ?? window.innerHeight
    const layoutH = window.innerHeight
    const preferred = view === 'help' ? 420 : 280
    const width = Math.min(preferred, Math.max(200, vw - margin * 2))
    const left = Math.min(Math.max(margin, r.right - width), vw - margin - width)
    const below = vh - r.bottom - margin
    const above = r.top - margin
    const openBelow = below >= 180 || below >= above
    const maxHeight = Math.max(120, openBelow ? below : above)
    setBox(openBelow
      ? { left, width, top: r.bottom + 6, maxHeight }
      : { left, width, bottom: layoutH - r.top + 6, maxHeight })
  }, [view])
  useLayoutEffect(() => {
    if (!view) return undefined
    placeMenu()
    const reposition = () => placeMenu()
    const vv = window.visualViewport
    window.addEventListener('resize', reposition)
    vv?.addEventListener('resize', reposition)
    vv?.addEventListener('scroll', reposition)
    return () => {
      window.removeEventListener('resize', reposition)
      vv?.removeEventListener('resize', reposition)
      vv?.removeEventListener('scroll', reposition)
    }
  }, [view, placeMenu])

  const applySlot = (action: string | null) => {
    if (!cfgCell || !cfgDir) return
    const next = setCellAction(grid, cfgCell, cfgDir, action)
    if (!hasSettingsAction(next)) {
      setCfgError('assign a second button to the settings before overwriting it!')
      return
    }
    setCfgError(null)
    commitGrid(next)
    setView('slot')
  }
  const applyPreset = (quick: string) => {
    if (!cfgCell) return
    const next = applyQuick(grid, cfgCell, quick)
    if (!hasSettingsAction(next)) {
      setCfgError('assign a second button to the settings before overwriting it!')
      return
    }
    setCfgError(null)
    commitGrid(next)
  }

  const clearCell = () => {
    if (!cfgCell) return
    const next: GridConfig = { ...grid }
    delete next[cfgCell]
    if (!hasSettingsAction(next)) {
      setCfgError('assign a second button to the settings before overwriting it!')
      return
    }
    setCfgError(null)
    commitGrid(next)
  }
  const back = (to: View) => (
    <button
      onClick={() => setView(to)}
      className="w-full min-h-[34px] px-3 text-left text-[11px] text-text-muted hover:text-text-primary flex items-center gap-1"
    >
      <ChevronLeft className="w-3 h-3" /> back
    </button>
  )
  const row = (icon: ReactNode, label: string, onClick: () => void, hint?: string, active = false, testId?: string) => (
    <button
      key={label}
      data-testid={testId}
      onClick={onClick}
      className={`w-full min-h-[40px] px-3 text-left text-sm flex items-center gap-2 transition-colors ${
        active ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[10px] opacity-60">{hint}</span>}
    </button>
  )
  const iconBtn = (icon: ReactNode, label: string, onClick: () => void, active = false) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex items-center justify-center w-10 h-10 shrink-0 rounded-md border transition-colors ${
        active
          ? 'bg-accent text-bg-primary border-accent'
          : 'bg-bg-secondary border-border text-text-secondary active:bg-bg-active'
      }`}
    >
      {icon}
    </button>
  )
  const divider = <div className="h-px bg-border/50 my-1" />
  const rangeRow = (label: string, value: number, min: number, max: number, onChange: (n: number) => void, suffix = '') => (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-text-muted">{label}</span>
        <span className="text-[11px] font-mono text-text-primary">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 accent-accent cursor-pointer"
      />
    </div>
  )

  const settingsBody = (() => {
    if (view === 'settings') return (
      <>
        <div className="flex gap-1 px-2 py-2 border-b border-border/50 overflow-x-auto">
          {iconBtn(<Eye className="w-4 h-4" />, `follow: ${termSettings.followMode ?? 'off'}`, () => setView('followMode'))}
          {iconBtn(<span className="text-[11px] font-semibold">%</span>, 'follow margin', () => setView('followMargin'))}
          {iconBtn(dock.position === 'top' ? <ArrowUpToLine className="w-4 h-4" /> : <ArrowDownToLine className="w-4 h-4" />, `dock: ${dock.position}`, () => setDock({ position: dock.position === 'top' ? 'bottom' : 'top' }))}
          {iconBtn(<Type className="w-4 h-4" />, 'font size', () => setView('font'))}
          {iconBtn(<Columns3 className="w-4 h-4" />, `min: ${termSettings.minCols || 'auto'}/${termSettings.minRows || 'auto'}`, () => setView('min'))}
          {iconBtn(<span className="w-4 h-4 flex items-center justify-center text-lg font-serif">•</span>, 'single-finger swipe', () => setView('swipeSingle'))}
          {iconBtn(<span className="w-4 h-4 flex items-center justify-center text-xs font-serif">••</span>, 'two-finger swipe', () => setView('swipeDouble'))}
          {iconBtn(<Droplets className="w-4 h-4" />, `transparency: ${dock.transparency ?? 50}%`, () => setView('transparency'))}
          {iconBtn(<Hand className="w-4 h-4" />, `step: ${termSettings.swipeStep ?? 10}px`, () => setView('arrowSpeed'))}
          {iconBtn(<Keyboard className="w-4 h-4" />, 'special keys', () => setView('keys'))}
        </div>
        {row(<Settings2 className="w-4 h-4" />, 'configure behavior', () => { setCfgCell(null); setCfgError(null); setView('configure') })}
        {row(<RotateCcw className="w-4 h-4" />, 'reset to defaults', resetGrid)}
        {row(<Braces className="w-4 h-4" />, 'menu config (JSON)', () => { setJsonText(JSON.stringify(grid, null, 2)); setJsonMsg(null); setView('json') })}
        {row(<HelpCircle className="w-4 h-4" />, 'terminal help', () => setView('help'))}
        {row(<Keyboard className="w-4 h-4" />, 'show more keys', () => setView('keys'))}
      </>
    )
    if (view === 'followMode') {
      const modes: { mode: TerminalSettings['followMode']; label: string; hint: string }[] = [
        { mode: 'off', label: 'Off', hint: 'Normal layout; no auto-scroll' },
        { mode: 'follow', label: 'Follow cursor', hint: 'Normal layout; keep the cursor visible' },
        { mode: 'shrink', label: 'Shrink & maximize', hint: 'Fill the space above the keyboard; follow cursor on' },
        { mode: 'zoom', label: 'Zoom (distort)', hint: 'Scale rows above the keyboard; follow cursor on' },
      ]
      return (
        <>
          {back('settings')}
          {modes.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => saveTermSettings({ ...termSettings, followMode: opt.mode, followCursor: opt.mode !== 'off' })}
              className={`w-full min-h-[44px] px-3 py-1 text-left flex flex-col justify-center transition-colors ${
                (termSettings.followMode ?? 'off') === opt.mode ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <span className="text-sm">{opt.label}</span>
              <span className="text-[10px] opacity-70">{opt.hint}</span>
            </button>
          ))}
          <div className="h-px bg-border/50 my-1" />
          {row(
            <Eye className="w-4 h-4" />,
            `follow cursor: ${termSettings.followCursor ? 'on' : 'off'}`,
            () => saveTermSettings({ ...termSettings, followCursor: !termSettings.followCursor }),
            termSettings.followCursor ? 'on' : 'off',
            termSettings.followCursor,
          )}
          <div className="px-3 py-2 text-[10px] text-text-muted leading-relaxed">
            Follow cursor is independent of the layout. It keeps the cursor above the keyboard in the shell as well as in full-screen apps like vim.
          </div>
          {row(
            <Maximize2 className="w-4 h-4" />,
            `maximize on keyboard: ${termSettings.maximizeOnKeyboard ? 'on' : 'off'}`,
            () => saveTermSettings({ ...termSettings, maximizeOnKeyboard: !termSettings.maximizeOnKeyboard }),
            termSettings.maximizeOnKeyboard ? 'on' : 'off',
            termSettings.maximizeOnKeyboard,
          )}
          <div className="px-3 py-2 text-[10px] text-text-muted leading-relaxed">
            Expands the whole terminal panel to the viewport while the software keyboard is open, then restores it when the keyboard closes. Works with every layout.
          </div>
        </>
      )
    }
    if (view === 'followMargin') return (
      <>
        {back('settings')}
        {rangeRow('follow margin', Math.round((termSettings.followMargin ?? 0.2) * 100), 0, 50, (n) => saveTermSettings({ ...termSettings, followMargin: n / 100 }), '%')}
        <div className="px-3 pb-2 text-[10px] text-text-muted leading-relaxed">
          How far the cursor stays from the top/bottom edge. 0% scrolls only when the cursor would leave the view; 50% keeps it near the middle.
        </div>
      </>
    )
    if (view === 'transparency') return (
      <>
        {back('settings')}
        {rangeRow('grid transparency', dock.transparency ?? 50, 0, 80, (n) => setDock({ transparency: n }), '%')}
        <div className="px-3 pb-2 text-[10px] text-text-muted leading-relaxed">
          Controls how see-through the grid button overlay is. 0% = opaque background, 80% = nearly transparent.
        </div>
      </>
    )
    if (view === 'arrowSpeed') return (
      <>
        {back('settings')}
        {rangeRow('swipe step', termSettings.swipeStep ?? 10, 4, 40, (n) => saveTermSettings({ ...termSettings, swipeStep: n }), 'px')}
        <div className="px-3 pb-2 text-[10px] text-text-muted leading-relaxed">
          Pixels of swipe per arrow key. Smaller = more sensitive (more keys per swipe). Larger = less sensitive.
        </div>
      </>
    )
    if (view === 'dock') return (
      <>
        {back('settings')}
        {row(<ArrowUpToLine className="w-4 h-4" />, 'dock at top', () => { setDock({ position: 'top' }); setView('settings') }, undefined, dock.position === 'top')}
        {row(<ArrowDownToLine className="w-4 h-4" />, 'dock at bottom', () => { setDock({ position: 'bottom' }); setView('settings') }, undefined, dock.position === 'bottom')}
        {divider}
        {row(<Eye className="w-4 h-4" />, 'transparent grid', () => setDock({ transparent: !dock.transparent }), dock.transparent ? 'on' : 'off')}
      </>
    )
    if (view === 'font') return (
      <>
        {back('settings')}
        {rangeRow('font size', termSettings.fontSize, 4, 24, (n) => saveTermSettings({ ...termSettings, fontSize: n }), 'px')}
      </>
    )
    if (view === 'min') return (
      <>
        {back('settings')}
        {rangeRow('min columns (0=auto)', termSettings.minCols, 0, 160, (n) => saveTermSettings({ ...termSettings, minCols: n }))}
        {rangeRow('min rows (0=auto)', termSettings.minRows, 0, 800, (n) => saveTermSettings({ ...termSettings, minRows: n }))}
        <div className="px-3 pb-2 text-[10px] text-text-muted leading-relaxed">
          Minimum terminal size. When set, the terminal scrolls instead of shrinking. Min-rows on small screens can make the terminal too tall.
        </div>
      </>
    )
    if (view === 'swipeSingle' || view === 'swipeDouble') {
      const single = view === 'swipeSingle'
      return (
        <>
          {back('settings')}
          <div className="px-3 py-1 text-[10px] text-text-muted">{single ? 'one finger' : 'two fingers'}</div>
          {SWIPE_OPTIONS.map((opt) => {
            const current = single ? termSettings.swipeMode : termSettings.swipeModeDouble
            return (
              <button
                key={opt.mode}
                onClick={() => saveTermSettings(single
                  ? { ...termSettings, swipeMode: opt.mode }
                  : { ...termSettings, swipeModeDouble: opt.mode })}
                className={`w-full min-h-[44px] px-3 py-1 text-left flex flex-col justify-center transition-colors ${
                  current === opt.mode ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <span className="text-sm">{opt.label}</span>
                <span className="text-[10px] opacity-70">{opt.hint}</span>
              </button>
            )
          })}
        </>
      )
    }
    if (view === 'help') return (
      <>
        {back('settings')}
        <TerminalHelp />
      </>
    )
    if (view === 'keys') {
      const groups = [
        { title: 'keys', items: KEYS },
        { title: 'ctrl', items: CTRL_KEYS },
        { title: 'F1–F12', items: FN_KEYS },
        { title: 'chars', items: CHAR_KEYS },
      ]
      return (
        <>
          {back('settings')}
          {groups.map((g) => (
            <div key={g.title} className="px-2 py-1">
              <div className="text-[10px] text-text-muted px-1 mb-1">{g.title}</div>
              <div className="flex flex-wrap gap-1">
                {g.items.map((k) => (
                  <button
                    key={k.label}
                    onClick={() => { onSend(k.send); setView(null) }}
                    className="px-2.5 py-2 text-[11px] font-medium rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active"
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )
    }
    if (view === 'json') return (
      <>
        {back('settings')}
        <div className="px-3 py-1 text-[11px] text-text-primary font-semibold">menu config (JSON)</div>
        <textarea
          data-testid="terminal-json"
          value={jsonText}
          onChange={(e) => { setJsonText(e.target.value); setJsonMsg(null) }}
          spellCheck={false}
          className="mx-2 mb-2 h-40 w-[calc(100%-1rem)] resize-none rounded border border-border bg-bg-secondary p-2 font-mono text-[11px] text-text-primary"
        />
        {jsonMsg && <div className="px-3 pb-1 text-[11px] text-text-muted">{jsonMsg}</div>}
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          <button data-testid="terminal-json-apply" onClick={() => applyJson(jsonText)} className="px-2 py-1 text-[11px] rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active">apply</button>
          <button data-testid="terminal-json-copy" onClick={() => { void navigator.clipboard?.writeText(jsonText) }} className="px-2 py-1 text-[11px] rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active">copy</button>
          <button data-testid="terminal-json-download" onClick={downloadJson} className="px-2 py-1 text-[11px] rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active">download</button>
          <label className="px-2 py-1 text-[11px] rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active">
            load file
            <input
              data-testid="terminal-json-file"
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                void file.text().then((text) => { setJsonText(text); applyJson(text) })
              }}
            />
          </label>
        </div>
      </>
    )
    if (view === 'configure') return (
      <>
        {back('settings')}
        {cfgError && <div className="px-3 py-1 text-[11px] text-red-400">{cfgError}</div>}
        <div className="flex flex-wrap gap-1 px-2 py-2 border-b border-border/50">
          {iconBtn(<span className="w-4 h-4 flex items-center justify-center text-lg font-serif">•</span>, 'single-finger swipe', () => setView('swipeSingle'))}
          {iconBtn(<span className="w-4 h-4 flex items-center justify-center text-xs font-serif">••</span>, 'two-finger swipe', () => setView('swipeDouble'))}
          {iconBtn(<RotateCcw className="w-4 h-4" />, 'reset to defaults', resetGrid)}
        </div>
        <div className="px-3 py-1 text-[10px] text-text-muted leading-relaxed">
          You can customize the grid button behavior: T = tapping, directions = swipe or long-press.
        </div>
        <div className="px-3 py-1 text-[10px] text-text-muted">select a button</div>
        <div className="px-2 pb-2">
          <div className="grid grid-cols-5 gap-1">
            {FULL_GRID_CELLS.map((id) => {
              const actions = grid[id]
              const hasActions = actions && Object.keys(actions).length > 0
              return (
                <button
                  key={id}
                  data-testid={`configure-cell-${id}`}
                  onClick={() => { setCfgCell(id); setCfgError(null); setView('slot') }}
                  className={`flex items-center justify-center h-11 rounded-md border text-[11px] font-semibold ${
                    hasActions
                      ? 'bg-bg-secondary border-border text-text-primary'
                      : 'border-dashed border-border/40 bg-bg-secondary/30 text-text-muted/50'
                  }`}
                  title={hasActions ? cellTitle(actions) : `empty cell ${id}`}
                >
                  <span className="flex flex-col items-center leading-tight">
                    <span className="text-[9px] opacity-60">{id}</span>
                    <span>{hasActions ? cellPrimaryLabel(actions) : '·'}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </>
    )
    if (view === 'slot' && cfgCell) {
      const actions: CellActions = grid[cfgCell] ?? {}
      return (
        <>
          {back('configure')}
          <div className="px-3 py-1 text-[11px] text-text-primary font-semibold">button {cfgCell}</div>
          {cfgError && <div className="px-3 py-1 text-[11px] text-red-400">{cfgError}</div>}
          <div className="px-2 pb-2">
            <button
              data-testid="cell-clear-all"
              onClick={clearCell}
              className="w-full flex items-center justify-center h-10 rounded-md border border-red-400/30 bg-red-400/10 text-red-400 text-[11px] font-semibold active:bg-red-400/20"
            >
              clear all
            </button>
          </div>
          <div className="px-2 pb-2">
            <div className="grid grid-cols-3 gap-1" style={{ width: RADIAL_PX }}>
              {DIRS.map((dir) => (
                <button
                  key={dir}
                  data-testid={`slot-${dir}`}
                  onClick={() => { setCfgDir(dir); setCfgGroup(null); setView('group') }}
                  className="flex flex-col items-center justify-center w-11 h-11 rounded-md border bg-bg-secondary border-border text-text-primary active:bg-bg-active"
                >
                  <span className="font-mono text-[9px] opacity-60">{dir}</span>
                  <span className="font-mono text-[10px] font-semibold max-w-[40px] truncate">
                    {actions[dir] ? actionLabel(actions[dir]!) : '—'}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="px-3 py-1 text-[10px] text-text-primary font-semibold border-t border-border/50">fast assignments</div>
          <div className="px-3 pb-1 text-[9px] text-text-muted">presets (fast assigning many triggers)</div>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            {Object.entries(QUICK_ASSIGNMENTS).map(([id, q]) => (
              <button
                key={id}
                onClick={() => applyPreset(id)}
                title={q.description}
                className="flex flex-col px-2 py-1 text-left text-[11px] rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active"
              >
                <span className="font-semibold">{q.label}</span>
                <span className="text-[9px] opacity-70">{q.description}</span>
              </button>
            ))}
          </div>
        </>
      )
    }
    if (view === 'group' && cfgCell && cfgDir) return (
      <>
        {back('slot')}
        <div className="px-3 py-1 text-[11px] text-text-primary font-semibold">button {cfgCell} · {cfgDir}</div>
        {cfgError && <div className="px-3 py-1 text-[11px] text-red-400">{cfgError}</div>}
        {ACTION_GROUPS.map((g) => row(
          <span className="font-mono text-xs">{g.label}</span>,
          g.label,
          () => { setCfgGroup(g.id); setView('actions') },
          g.description,
        ))}
        {divider}
        {row(<X className="w-4 h-4" />, 'clear', () => applySlot(null), undefined, false, 'action-clear')}
      </>
    )
    if (view === 'actions' && cfgCell && cfgDir && cfgGroup) {
      const group = ACTION_GROUPS.find((g) => g.id === cfgGroup)
      if (cfgGroup === 'text') return (
        <>
          {back('group')}
          <div className="px-3 py-1 text-[10px] text-text-muted">text</div>
          <div className="px-2 pb-2">
            <input
              data-testid="custom-text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="literal text"
              className="mb-1 w-full rounded border border-border bg-bg-secondary px-2 py-1 font-mono text-[12px] text-text-primary"
            />
            <button
              data-testid="custom-text-apply"
              onClick={() => {
                if (!customText) { setCfgError('enter some text'); return }
                setCfgError(null)
                applySlot(`send-text-${decodeEscapes(customText)}`)
              }}
              className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary active:bg-bg-active"
            >
              apply
            </button>
          </div>
          <div className="px-3 pb-2 text-[10px] text-text-muted">
            Escapes: \n Enter, \r CR, \t Tab, \e Esc. Example: ZQ for vim.
          </div>
        </>
      )
      return (
        <>
          {back('group')}
          <div className="px-3 py-1 text-[10px] text-text-muted">{group?.label}</div>
          {cfgError && <div className="px-3 py-1 text-[11px] text-red-400">{cfgError}</div>}
          <div className="max-h-[50vh] overflow-y-auto">
            {groupItems(cfgGroup).map((a) => (
              <button
                key={a.id}
                onClick={() => applySlot(a.id)}
                className="w-full min-h-[38px] px-3 text-left flex flex-col justify-center text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              >
                <span className="text-sm">{a.label}</span>
                {a.hint && <span className="text-[10px] opacity-60">{a.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )
    }
    return null
  })()

  const { cols } = gridBounds(grid)
  const order = gridOrder(grid)

  return (
    <>
      <div
        ref={gridRef}
        data-testid="terminal-grid"
        className={`terminal-no-select absolute z-20 grid gap-1 p-1 rounded-lg ${
          dock.position === 'top' ? 'top-2' : 'bottom-2'
        } right-2 ${dock.transparent ? 'bg-transparent' : 'bg-bg-elevated/90 border border-border shadow-lg'}`}
        style={{ gridTemplateColumns: `repeat(${cols}, ${CELL_PX}px)`, opacity: 1 - (dock.transparency ?? 50) / 100 }}
      >
        {order.map((id) => {
          const actions = grid[id]
          if (!actions || !Object.keys(actions).length) return <div key={id} className="w-11 h-11" />
          return (
            <button
              key={id}
              type="button"
              data-testid={`terminal-cell-${id}`}
              onTouchStart={(e) => onCellDown(e, id)}
              onTouchMove={onCellMove}
              onTouchEnd={(e) => onCellUp(e, id)}
              onTouchCancel={onCellCancel}
              onMouseDown={(e) => onCellMouseDown(e, id)}
              onMouseMove={onCellMouseMove}
              onMouseUp={onCellMouseUp}
              onMouseLeave={onCellMouseUp}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => onCellClick(e, id)}
              style={{ touchAction: 'none' }}
              title={cellTitle(actions)}
              className="flex items-center justify-center w-11 h-11 rounded-md border bg-bg-secondary/90 border-border text-text-primary active:bg-accent active:text-bg-primary transition-colors"
            >
              <span className="font-mono text-[12px] font-semibold leading-none">{cellPrimaryLabel(actions)}</span>
            </button>
          )
        })}
      </div>

      {radial && createPortal(
        <>
          <div className="fixed inset-0 z-30" onClick={closeRadial} />
          <div
            data-testid="terminal-radial"
            onPointerDown={() => { suppressRadialClickRef.current = false }}
            onContextMenu={(e) => e.preventDefault()}
            className="terminal-no-select fixed z-40 grid grid-cols-3 gap-1 p-1 rounded-lg bg-bg-elevated border border-border shadow-xl"
            style={{ left: radial.left, top: radial.top, width: RADIAL_PX, height: RADIAL_H }}
          >
            {DIRS.map((dir) => {
              const action = grid[radial.id]?.[dir]
              const center = dir === 'T'
              if (!action && !center) return <div key={dir} className="w-11 h-11" />
              return (
                <button
                  key={dir}
                  type="button"
                  onClick={() => {
                    // The finger release that opened the radial also produces a
                    // click at the cell centre (now the radial centre). Swallow it.
                    if (suppressRadialClickRef.current) {
                      suppressRadialClickRef.current = false
                      return
                    }
                    if (action) runAction(action)
                    else if (center) runAction(grid[radial.id]?.T)
                    closeRadial()
                  }}
                  title={action ? actionTitle(action) : 'tap'}
                  className={`flex items-center justify-center w-11 h-11 rounded-md border ${
                    center
                      ? 'bg-accent text-bg-primary border-accent'
                      : 'bg-bg-secondary border-border text-text-primary active:bg-accent active:text-bg-primary'
                  }`}
                >
                  <span className="font-mono text-[11px] font-semibold leading-none">
                    {action ? actionLabel(action) : cellPrimaryLabel(grid[radial.id])}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      , document.body)}

      {view && createPortal(
        <>
          <div className="fixed inset-0 z-30" onClick={() => setView(null)} />
          <div
            role="menu"
            data-testid="terminal-menu"
            className="terminal-no-select fixed z-40 overflow-y-auto overscroll-contain bg-bg-elevated border border-border rounded-lg shadow-xl py-1"
            style={{
              left: box?.left ?? 0,
              width: box?.width ?? 280,
              top: box?.top,
              bottom: box?.bottom,
              maxHeight: box?.maxHeight ?? '60vh',
              visibility: box ? 'visible' : 'hidden',
            }}
          >
            {settingsBody}
          </div>
        </>
      , document.body)}
    </>
  )
}
