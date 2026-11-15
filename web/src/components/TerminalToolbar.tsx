import { useState, useRef, useLayoutEffect, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'
import type { TerminalSettings } from '../types'

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

// TerminalToolbar — the [input][send][m] bar. `m` opens a menu with two
// position actions (top/bottom) followed by independent transparent,
// input_send and more toggles. Hiding input_send and more is the old hide
// mode: only the small m button remains.
const DEFAULT_TERM_SETTINGS: TerminalSettings = { fontSize: 12, minCols: 0, minRows: 0, scrollback: 5000, followCursor: false, swipeMode: 'scroll', writeDelayMs: 250 }
const TERM_SETTINGS_KEY = 'wede_terminal_settings'

export default function TerminalToolbar({ onSend, dock, onDockChange, docked }: TerminalToolbarProps) {
  const [ctrl, setCtrl] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  // Gestures on the = button:
  //   Tap → open menu
  //   Swipe up → send "fg" (foreground)
  //   Swipe down → send Ctrl+Z (suspend)
  //   Swipe left → send Ctrl+C (interrupt)
  //   Swipe right → send Tab (completion)
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
    // Swipe right → Tab completion
    if (dx > threshold && dx > Math.abs(dy) && dt < 500) {
      swipedRef.current = true
      onSend('\t')
      e.preventDefault()
      return
    }
    // Swipe left → send Ctrl+C
    if (dx < -threshold && Math.abs(dx) > Math.abs(dy) && dt < 500) {
      swipedRef.current = true
      onSend('\x03')
      e.preventDefault()
      return
    }
    // Swipe up → send "fg"
    if (dy < -threshold && Math.abs(dy) > Math.abs(dx) && dt < 500) {
      swipedRef.current = true
      onSend('fg\n')
      e.preventDefault()
      return
    }
    // Swipe down → send Ctrl+Z
    if (dy > threshold && dy > Math.abs(dx) && dt < 500) {
      swipedRef.current = true
      onSend('\x1a')
      e.preventDefault()
      return
    }
  }
  // The menu is anchored to the = button and clamped to the visual viewport.
  // Anchoring it to the toolbar with CSS only (top-full/bottom-full) let the
  // panel grow taller than a phone in landscape, pushing the lower controls
  // off-screen; fixed positioning + max-height keeps every control reachable.
  const [menuBox, setMenuBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const placeMenu = useCallback(() => {
    const btn = menuBtnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const margin = 6
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(260, Math.max(190, vw - margin * 2))
    const left = Math.min(Math.max(margin, r.right - width), vw - margin - width)
    const spaceBelow = vh - r.bottom - margin
    const spaceAbove = r.top - margin
    const openBelow = spaceBelow >= 240 || spaceBelow >= spaceAbove
    const maxHeight = Math.max(140, openBelow ? spaceBelow : spaceAbove)
    setMenuBox(openBelow
      ? { left, width, top: r.bottom + margin, maxHeight }
      : { left, width, bottom: vh - r.top + margin, maxHeight })
  }, [])
  const handleBtnClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // A swipe already produced a synthetic click on this same button — ignore it
    // so the menu does not flicker open after a gesture.
    if (swipedRef.current) { swipedRef.current = false; return }
    const next = !menuOpen
    if (next) placeMenu()
    setMenuOpen(next)
  }
  // Re-anchor if the viewport (or a scroll container) moves while open.
  useLayoutEffect(() => {
    if (!menuOpen) return undefined
    const reposition = () => placeMenu()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [menuOpen, placeMenu])

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
    setMenuOpen(false)
  }

  // With neither the input nor the extra keys shown the toolbar collapses to a
  // single floating = button. Tapping it opens the menu (where input_send can
  // be enabled) instead of silently switching the input row on.
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
        aria-expanded={menuOpen}
        aria-label="Terminal menu (swipe for actions)"
        title="Tap: menu  ↑:fg  ↓:Ctrl-Z  ←:Ctrl-C  →:Tab"
        style={{ touchAction: 'none' }}
        className={`flex items-center justify-center w-8 h-8 rounded-md border text-[13px] font-bold shrink-0 transition-colors ${
          menuOpen
            ? 'bg-accent text-bg-primary border-accent'
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

  const menu = menuOpen && (
    <>
      {/* Transparent click-catcher: dismiss on outside tap without dimming the
          whole IDE (the old full-screen black overlay read as a blank view). */}
      <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
      <div
        role="menu"
        data-testid="terminal-menu"
        className="fixed z-40 overflow-y-auto overscroll-contain bg-bg-elevated border border-border rounded-lg shadow-xl py-1"
        style={{
          left: menuBox?.left ?? 0,
          width: menuBox?.width ?? 260,
          top: menuBox?.top,
          bottom: menuBox?.bottom,
          maxHeight: menuBox?.maxHeight ?? '70vh',
          visibility: menuBox ? 'visible' : 'hidden',
        }}
      >
        {(['top', 'bottom'] as const).map((pos) => (
          <button
            key={pos}
            onClick={() => setPosition(pos)}
            className={`w-full min-h-[40px] px-3 text-left text-sm transition-colors ${
              dock.position === pos
                ? 'text-accent bg-accent/15'
                : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {pos}
          </button>
        ))}
        <div className="h-px bg-border/50 my-1" />
        <button
          onClick={() => onDockChange({ ...dock, transparent: !dock.transparent })}
          className={`w-full min-h-[40px] px-3 text-left text-sm flex items-center gap-2 transition-colors ${
            dock.transparent
              ? 'bg-accent text-bg-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <span className="font-mono">[{dock.transparent ? 'x' : ' '}]</span>
          <span>transparent</span>
        </button>
        <button
          onClick={() => onDockChange({ ...dock, inputSend: !dock.inputSend })}
          className={`w-full min-h-[40px] px-3 text-left text-sm flex items-center gap-2 transition-colors ${
            dock.inputSend
              ? 'bg-accent text-bg-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <span className="font-mono">[{dock.inputSend ? 'x' : ' '}]</span>
          <span>input_send</span>
        </button>
        <button
          onClick={() => onDockChange({ ...dock, more: !dock.more })}
          className={`w-full min-h-[40px] px-3 text-left text-sm flex items-center gap-2 transition-colors ${
            dock.more
              ? 'bg-accent text-bg-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <span className="font-mono">[{dock.more ? 'x' : ' '}]</span>
          <span>more</span>
        </button>
        <button
          onClick={() => saveTermSettings({ ...termSettings, followCursor: !termSettings.followCursor })}
          className={`w-full min-h-[40px] px-3 text-left text-sm flex items-center gap-2 transition-colors ${
            termSettings.followCursor
              ? 'bg-accent text-bg-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
          }`}
        >
          <span className="font-mono">[{termSettings.followCursor ? 'x' : ' '}]</span>
          <span>Follow cursor</span>
        </button>
        <div className="px-3 py-2">
          <div className="text-[11px] text-text-muted mb-1">Swipe up/down</div>
          {([
            ['scroll', 'scroll'],
            ['page', 'PageUp / PageDown'],
            ['half', 'half page (vim C-u / C-d)'],
            ['emacs', 'emacs (C-v / M-v)'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => saveTermSettings({ ...termSettings, swipeMode: mode })}
              className="w-full min-h-[36px] text-left text-sm flex items-center gap-2 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              <span className="font-mono">[{termSettings.swipeMode === mode ? 'x' : ' '}]</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="px-3 py-2">
          <div className="text-[11px] text-text-muted mb-1">Initial command delay</div>
          <div className="flex flex-wrap gap-1">
            {[0, 50, 100, 150, 200, 250].map((ms) => (
              <button
                key={ms}
                onClick={() => saveTermSettings({ ...termSettings, writeDelayMs: ms })}
                className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                  termSettings.writeDelayMs === ms
                    ? 'bg-accent text-bg-primary'
                    : 'bg-bg-input text-text-secondary hover:bg-bg-hover'
                }`}
              >
                {ms}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-text-muted mt-1">ms to wait before sending a new terminal's command</div>
        </div>
        <div className="h-px bg-border/50 my-1" />
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-text-muted">Font size</span>
            <span className="text-[11px] font-mono text-text-primary">{termSettings.fontSize ?? 12}px</span>
          </div>
          <input
            type="range"
            min={4}
            max={20}
            value={termSettings.fontSize ?? 12}
            onChange={(e) => saveTermSettings({ ...termSettings, fontSize: Number(e.target.value) })}
            className="w-full h-1 accent-accent cursor-pointer"
          />
        </div>
        {/* Min columns */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-text-muted">Min cols <span className="text-[10px] opacity-60">(0=auto)</span></span>
            <span className="text-[11px] font-mono text-text-primary">{termSettings.minCols ?? 0}</span>
          </div>
          <input
            type="range"
            min={0}
            max={160}
            value={termSettings.minCols ?? 0}
            onChange={(e) => saveTermSettings({ ...termSettings, minCols: Number(e.target.value) })}
            className="w-full h-1 accent-accent cursor-pointer"
          />
        </div>
        {/* Min rows */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-text-muted">Min rows <span className="text-[10px] opacity-60">(0=auto)</span></span>
            <span className="text-[11px] font-mono text-text-primary">{termSettings.minRows ?? 0}</span>
          </div>
          <input
            type="range"
            min={0}
            max={800}
            value={termSettings.minRows ?? 0}
            onChange={(e) => saveTermSettings({ ...termSettings, minRows: Number(e.target.value) })}
            className="w-full h-1 accent-accent cursor-pointer"
          />
        </div>
        {/* Gesture hint — always visible at the bottom */}
        <div className="h-px bg-border/50 my-1" />
        <div className="px-3 py-2">
          <div className="text-[10px] text-text-muted leading-relaxed">
            <span className="font-mono">tap</span> menu &nbsp;
            <span className="font-mono">↑</span> fg &nbsp;
            <span className="font-mono">↓</span> Ctrl-Z &nbsp;
            <span className="font-mono">←</span> Ctrl-C &nbsp;
            <span className="font-mono">→</span> Tab
          </div>
        </div>
      </div>
    </>
  )

  const rootClass = collapsed
    ? `absolute right-2 z-20 ${dock.position === 'top' ? 'top-2' : 'bottom-2'}`
    : docked
      ? `relative shrink-0 ${dock.position === 'top' ? 'order-first border-b' : 'border-t'} border-border`
      : `absolute inset-x-0 z-20 ${
        dock.position === 'top' ? 'top-0 border-b' : 'bottom-0 border-t'
      } border-border/60`

  // The floating overlay fades as one unit — background, input, buttons and
  // the expanded key rows. The menu is a sibling so it stays readable.
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
      {menu}
    </div>
  )
}
