import { useState, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

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
  { label: '~', send: '~' },
  { label: '/', send: '/' },
  { label: '-', send: '-' },
  { label: '|', send: '|' },
  { label: '$', send: '$' },
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
export default function TerminalToolbar({ onSend, dock, onDockChange, docked }: TerminalToolbarProps) {
  const [ctrl, setCtrl] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const firstLine = (
    <form onSubmit={handleSubmit} className="flex items-center gap-1.5 px-2 py-1.5">
      {dock.inputSend && (
        <>
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
        </>
      )}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-label="Input position"
        title="Input position"
        className={`ml-auto flex items-center justify-center w-8 h-8 rounded-md border text-[13px] font-bold shrink-0 transition-colors ${
          menuOpen
            ? 'bg-accent text-bg-primary border-accent'
            : 'bg-bg-secondary/80 border-border text-text-secondary active:bg-bg-active'
        }`}
      >
        m
      </button>
    </form>
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
          keys.map((k) => (
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
          ))
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
      <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
      <div
        className={`absolute right-2 z-40 min-w-[190px] bg-bg-elevated border border-border rounded-lg shadow-xl py-1 ${
          dock.position === 'bottom' ? 'bottom-full mb-1' : 'top-full mt-1'
        }`}
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
      </div>
    </>
  )

  const rootClass = docked
    ? `relative shrink-0 ${dock.position === 'top' ? 'order-first border-b' : 'border-t'} border-border`
    : `absolute inset-x-0 z-20 ${
      dock.position === 'top' ? 'top-0 border-b' : 'bottom-0 border-t'
    } border-border/60`

  // The floating overlay fades as one unit — background, input, buttons and
  // the expanded key rows. The `m` submenu is a sibling so it stays readable.
  const barClass = docked ? 'bg-bg-tertiary' : 'bg-bg-tertiary opacity-80'

  return (
    <div className={rootClass}>
      <div className={barClass}>
        {dock.position === 'bottom' && extra}
        {firstLine}
        {dock.position === 'top' && extra}
      </div>
      {menu}
    </div>
  )
}
