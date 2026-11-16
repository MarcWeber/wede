import { useState, useRef, useLayoutEffect, useCallback, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  Send, ArrowUpToLine, ArrowDownToLine, Eye, EyeOff, MoveVertical,
  Settings2, HelpCircle, ChevronLeft,
} from 'lucide-react'
import type { TerminalSettings, TerminalSwipeMode } from '../types'

interface KeyDef {
  label: string
  send?: string
  modifier?: boolean
}

const keys: KeyDef[] = [
  { label: 'Tab', send: '\t' },
  { label: 'Esc', send: '\x1b' },
  { label: 'Ctrl', modifier: true },
  { label: '↑', send: '\x1b[A' },
  { label: '↓', send: '\x1b[B' },
  { label: '←', send: '\x1b[D' },
  { label: '→', send: '\x1b[C' },
  { label: 'PgUp', send: '\x1b[5~' },
  { label: 'PgDn', send: '\x1b[6~' },
  { label: '~', send: '~' },
  { label: '/', send: '/' },
  { label: '-', send: '-' },
  { label: '|', send: '|' },
  { label: '$', send: '$' },
]

// xterm-256color function keys (see `infocmp xterm-256color`).
const fnKeys: KeyDef[] = [
  { label: 'F1', send: '\x1bOP' },
  { label: 'F2', send: '\x1bOQ' },
  { label: 'F3', send: '\x1bOR' },
  { label: 'F4', send: '\x1bOS' },
  { label: 'F5', send: '\x1b[15~' },
  { label: 'F6', send: '\x1b[17~' },
  { label: 'F7', send: '\x1b[18~' },
  { label: 'F8', send: '\x1b[19~' },
  { label: 'F9', send: '\x1b[20~' },
  { label: 'F10', send: '\x1b[21~' },
  { label: 'F11', send: '\x1b[23~' },
  { label: 'F12', send: '\x1b[24~' },
]

const ctrlKeys: KeyDef[] = [
  { label: 'C', send: '\x03' },
  { label: 'D', send: '\x04' },
  { label: 'Z', send: '\x1a' },
  { label: 'L', send: '\x0c' },
  { label: 'A', send: '\x01' },
  { label: 'E', send: '\x05' },
  { label: 'R', send: '\x12' },
  { label: 'W', send: '\x17' },
]

// 3×3 pad. Corners are the Ctrl-* keys reached for most; the edges mirror the
// four swipe directions on the = button; the centre toggles the settings popup.
interface PadCellDef {
  key: string
  label: string
  hint: string
  send?: string
  center?: boolean
}
const padCells: PadCellDef[] = [
  { key: 'nw', label: 'C-p', hint: 'Ctrl-P', send: '\x10' },
  { key: 'n', label: 'fg', hint: 'foreground', send: 'fg\n' },
  { key: 'ne', label: 'C-l', hint: 'Ctrl-L', send: '\x0c' },
  { key: 'w', label: 'C-c', hint: 'Ctrl-C', send: '\x03' },
  { key: 'center', label: '=', hint: 'settings', center: true },
  { key: 'e', label: 'Tab', hint: 'completion', send: '\t' },
  { key: 'sw', label: 'C-n', hint: 'Ctrl-N', send: '\x0e' },
  { key: 's', label: 'C-z', hint: 'Ctrl-Z', send: '\x1a' },
  { key: 'se', label: 'C-r', hint: 'Ctrl-R', send: '\x12' },
]
// 3 * 44px touch targets + 2 * 4px gaps + 2 * 4px padding. The middle cell is
// the fixed 44px = button, so the other eight cells line up around it.
const PAD_PX = 148

const swipeModes: { mode: TerminalSwipeMode; label: string; hint: string }[] = [
  { mode: 'scroll', label: 'Native scroll', hint: 'scrollback' },
  { mode: 'page', label: 'PgUp / PgDn', hint: 'e.g. opencode, less' },
  { mode: 'half', label: 'Vim C-u / C-d', hint: 'half page' },
  { mode: 'emacs', label: 'Emacs C-v / M-v', hint: 'one page' },
  { mode: 'wheel', label: 'Mouse wheel emulation', hint: 'e.g. Junie' },
]
const swipeModeLabel = (m: TerminalSwipeMode) =>
  swipeModes.find((x) => x.mode === m)?.label ?? m

type Submenu = null | 'dock' | 'follow' | 'swipe' | 'more' | 'help'

export interface TerminalInputDock {
  position: 'top' | 'bottom'
  transparent: boolean
  inputSend: boolean
  more: boolean
}

interface TerminalToolbarProps {
  onSend: (data: string) => void
  dock: TerminalInputDock
  onDockChange: (dock: TerminalInputDock) => void
  docked?: boolean
}

// TerminalToolbar — the [input][send][=] bar. `=` opens the 3×3 action pad;
// its centre opens settings (dock, follow cursor, swipe mode, more, help).
// Hiding input_send and more collapses the bar to just the `=` button.
const DEFAULT_TERM_SETTINGS: TerminalSettings = { fontSize: 12, minCols: 0, minRows: 0, scrollback: 5000, followCursor: false, swipeMode: 'wheel', writeDelayMs: 250 }
const TERM_SETTINGS_KEY = 'wede_terminal_settings'

export default function TerminalToolbar({ onSend, dock, onDockChange, docked }: TerminalToolbarProps) {
  const [ctrl, setCtrl] = useState(false)
  const [padOpen, setPadOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  // Gestures on the = button:
  //   Tap → open the 3×3 pad (centre of the pad opens settings)
  //   Swipe up → "fg"            Swipe down → Ctrl+Z
  //   Swipe left → Ctrl+C        Swipe right → Tab
  //   Diagonal ↖ Ctrl-P  ↗ Ctrl-L  ↙ Ctrl-N  ↘ Ctrl-R
  const swipeStart = useRef<{ x: number; y: number; time: number } | null>(null)
  const swipedRef = useRef(false)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const handleSwipeStart = (e: React.TouchEvent) => {
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() }
    swipedRef.current = false
  }
  const handleSwipeCancel = () => {
    swipeStart.current = null
    swipedRef.current = false
  }
  const handleSwipeEnd = (e: React.TouchEvent) => {
    if (!swipeStart.current) return
    const dx = e.changedTouches[0].clientX - swipeStart.current.x
    const dy = e.changedTouches[0].clientY - swipeStart.current.y
    const dt = Date.now() - swipeStart.current.time
    swipeStart.current = null
    const threshold = 30
    // Swipe toward a pad cell → run that cell. Eight 45° sectors, so
    // up-right is Ctrl-L, up-left Ctrl-P, down-left Ctrl-N, down-right Ctrl-R.
    const dist = Math.hypot(dx, dy)
    if (dist > threshold && dt < 500) {
      const dir = Math.round((Math.atan2(-dy, dx) * 180) / Math.PI / 45)
      swipedRef.current = true
      if (dir === 0) onSend('\t')
      else if (dir === 1) onSend('\x0c')
      else if (dir === 2) onSend('fg\n')
      else if (dir === 3) onSend('\x10')
      else if (dir === -1) onSend('\x12')
      else if (dir === -2) onSend('\x1a')
      else if (dir === -3) onSend('\x0e')
      else onSend('\x03')
      e.preventDefault()
      return
    }
  }
  // The 3×3 pad is anchored so its middle cell sits on the fixed 32px = button.
  // The settings contents start below the grid (above it when the grid has to
  // open upward) and scroll. The eight outer cells are only visible while the
  // menu contents are open, so the closed state is just the = button.
  const [overlayBox, setOverlayBox] = useState<{
    panelLeft: number
    panelTop: number
    left: number
    width: number
    settingsTop?: number
    settingsBottom?: number
    maxHeight: number
  } | null>(null)
  const placeOverlay = useCallback(() => {
    const btn = menuBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(260, Math.max(190, vw - margin * 2))
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const panelLeft = Math.min(Math.max(margin, cx - PAD_PX / 2), vw - margin - PAD_PX)
    const panelTop = Math.min(Math.max(margin, cy - PAD_PX / 2), vh - margin - PAD_PX)
    const left = Math.min(Math.max(margin, panelLeft + PAD_PX - width), vw - margin - width)
    const spaceBelow = vh - (panelTop + PAD_PX) - margin
    const spaceAbove = panelTop - margin
    const below = spaceBelow >= 140 || spaceBelow >= spaceAbove
    const maxHeight = Math.max(120, below ? spaceBelow : spaceAbove)
    setOverlayBox(below
      ? { panelLeft, panelTop, left, width, settingsTop: panelTop + PAD_PX + 6, maxHeight }
      : { panelLeft, panelTop, left, width, settingsBottom: vh - panelTop + 6, maxHeight })
  }, [])
  const closeOverlay = () => {
    setPadOpen(false)
    setMenuOpen(false)
    setSubmenu(null)
  }
  const handleBtnClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // A swipe already produced a synthetic click on this same button — ignore it
    // so the pad does not flicker open after a gesture.
    if (swipedRef.current) { swipedRef.current = false; return }
    if (padOpen || menuOpen) {
      closeOverlay()
      return
    }
    placeOverlay()
    setSubmenu(null)
    setMenuOpen(true)
    setPadOpen(true)
  }
  // Re-anchor if the viewport (or a scroll container) moves while open.
  useLayoutEffect(() => {
    if (!padOpen && !menuOpen) return undefined
    const reposition = () => placeOverlay()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [padOpen, menuOpen, placeOverlay])

  // Terminal display settings — persisted to localStorage so the Terminal
  // component can read them without prop drilling. A same-tab custom event
  // notifies live terminals immediately (the `storage` event only fires in
  // other tabs), so there is no polling.
  const [termSettings, setTermSettings] = useState<TerminalSettings>(() => {
    try {
      const raw = localStorage.getItem(TERM_SETTINGS_KEY)
      if (raw) return { ...DEFAULT_TERM_SETTINGS, ...(JSON.parse(raw) as Partial<TerminalSettings>) }
    } catch { /* ignore */ }
    return DEFAULT_TERM_SETTINGS
  })
  const saveTermSettings = (s: TerminalSettings) => {
    setTermSettings(s)
    try { localStorage.setItem(TERM_SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent<unknown>('wede:term-settings'))
  }

  const remember = (cmd: string) => {
    const v = cmd.trim()
    if (!v) return
    setHistory((prev) => [v, ...prev.filter((x) => x !== v)].slice(0, 100))
  }

  const handleKey = (key: KeyDef) => {
    if (key.modifier) {
      setCtrl((c) => !c)
      return
    }
    if (ctrl) {
      const ch = (key.send || '').toUpperCase()
      if (ch.length === 1 && ch >= 'A' && ch <= 'Z') {
        onSend(String.fromCharCode(ch.charCodeAt(0) - 64))
      } else {
        onSend(key.send || '')
      }
      setCtrl(false)
      return
    }
    onSend(key.send || '')
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!input) return
    onSend(input + '\n')
    remember(input)
    setHistIdx(-1)
    setInput('')
  }

  const sendHistory = (cmd: string) => {
    onSend(cmd + '\n')
    remember(cmd)
    setHistIdx(-1)
    setInput('')
    inputRef.current?.focus()
  }

  const handleInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (histIdx < history.length - 1) {
        const next = histIdx + 1
        setHistIdx(next)
        setInput(history[next])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx > 0) {
        const next = histIdx - 1
        setHistIdx(next)
        setInput(history[next])
      } else if (histIdx === 0) {
        setHistIdx(-1)
        setInput('')
      }
    }
  }

  const setPosition = (position: 'top' | 'bottom') => {
    onDockChange({ ...dock, position })
    setSubmenu(null)
  }

  // With neither the input nor the extra keys shown the toolbar collapses to a
  // single floating = button. Tapping it opens the 3×3 pad (where input_send
  // can be enabled) instead of silently switching the input row on.
  const collapsed = !dock.inputSend && !dock.more
  // The = button lives on the same line as the input (when shown) instead of
  // occupying a full-width row of its own — on a phone that extra empty band
  // was most of what made the toolbar look like it had "no content".
  const firstLine = (
    <div className={collapsed ? 'flex items-center' : 'flex items-center gap-1.5 px-2 py-1.5 w-full'}>
      {dock.inputSend ? (
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5 flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleInputKey}
            placeholder="Type command..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            className="flex-1 bg-bg-primary/80 border border-border rounded px-2 py-1.5 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent min-w-0"
          />
          <button
            type="submit"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-bg-primary active:opacity-70 transition-opacity shrink-0 shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      ) : (
        <div className="flex-1 min-w-0" />
      )}
      <button
        ref={menuBtnRef}
        type="button"
        data-testid="terminal-menu-btn"
        onClick={handleBtnClick}
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
        onTouchCancel={handleSwipeCancel}
        aria-haspopup="menu"
        aria-expanded={padOpen}
        aria-label="Terminal pad (tap to look up, or swipe for actions)"
        title="Tap: pad  ↑:fg  ↓:C-z  ←:C-c  →:Tab  ↖:C-p ↗:C-l ↙:C-n ↘:C-r"
        style={{ touchAction: 'none' }}
        className={`flex items-center justify-center w-11 h-11 rounded-md border text-[15px] font-bold shrink-0 transition-colors ${
          padOpen
            ? 'invisible'
            : 'bg-bg-secondary/80 border-border text-text-secondary active:bg-bg-active'
        }`}
      >
        =
      </button>
    </div>
  )

  const extra = dock.more && (
    <div className={dock.position === 'bottom' ? 'border-b border-border/50' : 'border-t border-border/50'}>
      {/* Special keys — wrap so they are always findable, never scrolled. */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {ctrl ? (
          <>
            <button
              onClick={() => setCtrl(false)}
              className="px-2 py-1 text-[11px] font-bold rounded bg-accent text-bg-primary"
            >
              Ctrl
            </button>
            {ctrlKeys.map((k) => (
              <button
                key={k.label}
                onClick={() => { onSend(k.send || ''); setCtrl(false) }}
                className="px-2.5 py-1 text-[11px] font-medium rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active"
              >
                {k.label}
              </button>
            ))}
          </>
        ) : (
          <>
            {keys.map((k) => (
              <button
                key={k.label}
                onClick={() => handleKey(k)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded border ${
                  k.modifier
                    ? 'bg-bg-secondary border-border text-text-secondary active:bg-accent active:text-bg-primary'
                    : 'bg-bg-secondary border-border text-text-primary active:bg-bg-active'
                }`}
              >
                {k.label}
              </button>
            ))}
            {fnKeys.map((k) => (
              <button
                key={k.label}
                onClick={() => onSend(k.send || '')}
                className="px-2.5 py-1 text-[11px] font-medium rounded bg-bg-secondary border border-border text-text-primary active:bg-bg-active"
              >
                {k.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Commands typed this session — scrollable, tap to send. */}
      {history.length > 0 && (
        <div className="max-h-28 overflow-y-auto border-t border-border/50">
          {history.map((cmd, i) => (
            <button
              key={`${cmd}-${i}`}
              type="button"
              onClick={() => sendHistory(cmd)}
              className="w-full text-left px-2.5 py-1.5 font-mono text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary active:bg-bg-active truncate"
              title={`Send: ${cmd}`}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const menuRow = (icon: ReactNode, label: string, onClick: () => void, active = false, hint?: string) => (
    <button
      key={label}
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
  const toggleRow = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      className={`w-full min-h-[40px] px-3 text-left text-sm flex items-center gap-2 transition-colors ${
        on ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
      }`}
    >
      <span className="font-mono">[{on ? 'x' : ' '}]</span>
      <span>{label}</span>
    </button>
  )
  const backRow = (
    <button
      onClick={() => setSubmenu(null)}
      className="w-full min-h-[34px] px-3 text-left text-[11px] text-text-muted hover:text-text-primary flex items-center gap-1"
    >
      <ChevronLeft className="w-3 h-3" /> back
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
  const menuBody = (() => {
    if (submenu === 'dock') return (
      <>
        {backRow}
        {menuRow(<ArrowUpToLine className="w-4 h-4" />, 'dock at top', () => setPosition('top'), dock.position === 'top')}
        {menuRow(<ArrowDownToLine className="w-4 h-4" />, 'dock at bottom', () => setPosition('bottom'), dock.position === 'bottom')}
      </>
    )
    if (submenu === 'follow') return (
      <>
        {backRow}
        {menuRow(<Eye className="w-4 h-4" />, 'follow cursor', () => { saveTermSettings({ ...termSettings, followCursor: true }); setSubmenu(null) }, termSettings.followCursor)}
        {menuRow(<EyeOff className="w-4 h-4" />, 'do not follow cursor', () => { saveTermSettings({ ...termSettings, followCursor: false }); setSubmenu(null) }, !termSettings.followCursor)}
      </>
    )
    if (submenu === 'swipe') return (
      <>
        {backRow}
        {swipeModes.map(({ mode, label, hint }) => (
          <button
            key={mode}
            onClick={() => { saveTermSettings({ ...termSettings, swipeMode: mode }); setSubmenu(null) }}
            className={`w-full min-h-[44px] px-3 py-1 text-left flex flex-col justify-center transition-colors ${
              termSettings.swipeMode === mode ? 'bg-accent text-bg-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            <span className="text-sm">{label}</span>
            <span className="text-[10px] opacity-70">{hint}</span>
          </button>
        ))}
      </>
    )
    if (submenu === 'more') return (
      <>
        {backRow}
        {rangeRow('min rows (0=auto)', termSettings.minRows ?? 0, 0, 800, (n) => saveTermSettings({ ...termSettings, minRows: n }))}
        <div className="px-3 py-2">
          <div className="text-[11px] text-text-muted mb-1">initial command delay</div>
          <div className="flex flex-wrap gap-1">
            {[0, 50, 100, 150, 200, 250].map((ms) => (
              <button
                key={ms}
                onClick={() => saveTermSettings({ ...termSettings, writeDelayMs: ms })}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                  termSettings.writeDelayMs === ms ? 'bg-accent text-bg-primary' : 'bg-bg-input text-text-secondary hover:bg-bg-hover'
                }`}
              >
                {ms}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-text-muted mt-1">ms before sending a new terminal's command</div>
        </div>
        {toggleRow('input_send', dock.inputSend, () => onDockChange({ ...dock, inputSend: !dock.inputSend }))}
      </>
    )
    if (submenu === 'help') return (
      <>
        {backRow}
        <div className="px-3 py-2 text-[11px] text-text-secondary leading-relaxed space-y-1">
          <div className="text-text-primary font-semibold">3×3 pad</div>
          <div><span className="font-mono">C-p</span> Ctrl-P (top-left) · <span className="font-mono">C-l</span> Ctrl-L (top-right)</div>
          <div><span className="font-mono">C-n</span> Ctrl-N (bottom-left) · <span className="font-mono">C-r</span> Ctrl-R (bottom-right)</div>
          <div><span className="font-mono">fg</span> foreground · <span className="font-mono">C-z</span> Ctrl-Z</div>
          <div><span className="font-mono">C-c</span> Ctrl-C · <span className="font-mono">Tab</span> completion</div>
          <div className="pt-1 text-text-primary font-semibold">swipe on =</div>
          <div>↑ fg · ↓ C-z · ← C-c · → Tab</div>
          <div>↖ C-p · ↗ C-l · ↙ C-n · ↘ C-r</div>
        </div>
      </>
    )
    return (
      <>
        {menuRow(dock.position === 'top' ? <ArrowUpToLine className="w-4 h-4" /> : <ArrowDownToLine className="w-4 h-4" />, `dock: ${dock.position}`, () => setSubmenu('dock'))}
        {menuRow(termSettings.followCursor ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />, 'follow cursor', () => setSubmenu('follow'), false, termSettings.followCursor ? 'on' : 'off')}
        {menuRow(<MoveVertical className="w-4 h-4" />, 'swipe', () => setSubmenu('swipe'), false, swipeModeLabel(termSettings.swipeMode))}
        {divider}
        {rangeRow('font size', termSettings.fontSize ?? 12, 4, 20, (n) => saveTermSettings({ ...termSettings, fontSize: n }), 'px')}
        {rangeRow('min cols (0=auto)', termSettings.minCols ?? 0, 0, 160, (n) => saveTermSettings({ ...termSettings, minCols: n }))}
        {divider}
        {menuRow(<Settings2 className="w-4 h-4" />, 'more settings', () => setSubmenu('more'))}
        {menuRow(<HelpCircle className="w-4 h-4" />, 'help', () => setSubmenu('help'))}
        {divider}
        {toggleRow('transparent', dock.transparent, () => onDockChange({ ...dock, transparent: !dock.transparent }))}
        {toggleRow('more keys', dock.more, () => onDockChange({ ...dock, more: !dock.more }))}
      </>
    )
  })()

  const overlay = (padOpen || menuOpen) && (
    <>
      {/* Transparent click-catcher: dismiss on outside tap without dimming the
          whole IDE (the old full-screen black overlay read as a blank view). */}
      <div className="fixed inset-0 z-30" onClick={closeOverlay} />
      <div
        data-testid="terminal-pad"
        className={`fixed z-40 grid grid-cols-3 gap-1 p-1 rounded-lg ${
          menuOpen ? 'bg-bg-elevated border border-border shadow-xl' : ''
        }`}
        style={{
          left: overlayBox?.panelLeft ?? 0,
          top: overlayBox?.panelTop ?? 0,
          width: PAD_PX,
          height: PAD_PX,
          visibility: overlayBox ? 'visible' : 'hidden',
        }}
      >
        {padCells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            onClick={() => {
              if (swipedRef.current) { swipedRef.current = false; return }
              if (cell.center) {
                setSubmenu(null)
                setMenuOpen((v) => !v)
                return
              }
              if (cell.send) onSend(cell.send)
            }}
            onTouchStart={cell.center ? handleSwipeStart : undefined}
            onTouchEnd={cell.center ? handleSwipeEnd : undefined}
            onTouchCancel={cell.center ? handleSwipeCancel : undefined}
            title={cell.hint}
            style={cell.center ? { touchAction: 'none' } : undefined}
            className={`flex items-center justify-center w-11 h-11 rounded-md border transition-colors ${
              !cell.center && !menuOpen ? 'invisible' : ''
            } ${
              cell.center
                ? menuOpen
                  ? 'bg-accent text-bg-primary border-accent'
                  : 'bg-bg-secondary/80 border-border text-text-secondary active:bg-bg-active'
                : 'bg-bg-secondary border-border text-text-primary active:bg-accent active:text-bg-primary'
            }`}
          >
            <span className={`font-mono font-semibold leading-none ${cell.center ? 'text-[15px]' : 'text-[11px]'}`}>{cell.label}</span>
          </button>
        ))}
      </div>
      {menuOpen && (
        <div
          role="menu"
          data-testid="terminal-menu"
          className="fixed z-40 overflow-y-auto overscroll-contain bg-bg-elevated border border-border rounded-lg shadow-xl py-1"
          style={{
            left: overlayBox?.left ?? 0,
            width: overlayBox?.width ?? 260,
            top: overlayBox?.settingsTop,
            bottom: overlayBox?.settingsBottom,
            maxHeight: overlayBox?.maxHeight ?? '60vh',
            visibility: overlayBox ? 'visible' : 'hidden',
          }}
        >
          {menuBody}
        </div>
      )}
    </>
  )

  const rootClass = collapsed
    ? `fixed right-[60px] z-20 ${dock.position === 'top' ? 'top-[60px]' : 'bottom-[60px]'}`
    : docked
      ? `relative shrink-0 ${dock.position === 'top' ? 'order-first border-b' : 'border-t'} border-border`
      : `absolute inset-x-0 z-20 ${
        dock.position === 'top' ? 'top-0 border-b' : 'bottom-0 border-t'
      } border-border/60`

  // The floating overlay fades as one unit — background, input, buttons and
  // the expanded key rows. The pad + settings are siblings so they stay readable.
  // Collapsed, only the = button is drawn (no full-width empty band).
  const barClass = collapsed
    ? 'flex flex-col'
    : docked ? 'flex flex-col bg-bg-tertiary' : 'flex flex-col bg-bg-tertiary opacity-80'

  return (
    <div className={rootClass}>
      <div className={barClass}>
        {firstLine}
        {extra}
      </div>
      {overlay}
    </div>
  )
}
