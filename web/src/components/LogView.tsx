import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { ScrollText, RefreshCw, FileText, Server, ChevronDown, X, Bug } from 'lucide-react'
import { workspaceUrl } from '../api'
import type { AuthFetch } from '../types'
import { clearUiLog, getUiLogSnapshot, subscribeUiLog } from '../lib/uiLog'

interface LogViewProps {
  authFetch: AuthFetch
  workspaceId: string | null
  debug?: boolean
}

// LogView — three modes:
//   server-log: server log lines (debug only)
//   client-log: client-side events — layout saves, cursor moves, server responses (debug only)
//   file-log: watch a workspace file for changes (always available)
export default function LogView({ authFetch, workspaceId, debug = false }: LogViewProps) {
  const [mode, setMode] = useState<'server' | 'client' | 'file'>(debug ? 'client' : 'file')
  const [watchPath, setWatchPath] = useState('')
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const uiLog = useSyncExternalStore(subscribeUiLog, getUiLogSnapshot)

  // When debug is disabled and we're in a debug-only mode, switch to file-log.
  useEffect(() => {
    if (!debug && (mode === 'server' || mode === 'client')) {
      setMode('file')
    }
  }, [debug, mode])

  const watching = mode === 'file' && watchPath !== ''
  const filename = watching ? watchPath : (mode === 'server' ? 'server.log' : 'client.log')
  const displayLines = mode === 'client' ? uiLog.split('\n').filter(Boolean) : lines

  const switchMode = (m: 'server' | 'client' | 'file') => {
    if (!debug && m !== 'file') return
    setMode(m)
    setFormOpen(false)
    setError('')
  }

  useEffect(() => {
    if (paused || mode === 'client') return undefined
    let active = true
    const load = async () => {
      try {
        if (mode === 'file' && watching && !workspaceId) throw new Error('no workspace')
        let url: string
        if (mode === 'server') {
          url = '/api/logs?n=400'
        } else if (mode === 'file' && watching) {
          url = `${workspaceUrl(workspaceId as string, '/log')}?path=${encodeURIComponent(watchPath)}&n=400`
        } else {
          return // file mode with no path — nothing to load
        }
        const res = await authFetch(url)
        if (!res.ok) {
          const body: { error?: string } = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const data: { lines?: string[] } = await res.json()
        if (!active) return
        setLines(data.lines || [])
        setError('')
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'unavailable')
      }
    }
    void load()
    const id = setInterval(load, 2000)
    return () => { active = false; clearInterval(id) }
  }, [authFetch, mode, paused, watchPath, watching, workspaceId])

  useEffect(() => {
    const el = boxRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [lines, uiLog])

  const watch = (e: FormEvent) => {
    e.preventDefault()
    const path = input.trim()
    if (!path) return
    setWatchPath(path)
    setLines([])
    setError('')
    setFormOpen(false)
  }

  const clearLines = () => {
    if (mode === 'client') clearUiLog()
    else setLines([])
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      <div className="flex items-center gap-2 px-2.5 h-8 border-b border-border bg-bg-secondary shrink-0">
        {mode === 'server' ? <Server className="w-3.5 h-3.5 text-green shrink-0" />
          : mode === 'client' ? <Bug className="w-3.5 h-3.5 text-accent shrink-0" />
          : watching ? <FileText className="w-3.5 h-3.5 text-green shrink-0" />
          : <ScrollText className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        <span className="text-[10px] text-text-muted shrink-0">{displayLines.length} lines</span>

        {/* Mode buttons */}
        {debug && (
          <button type="button" onClick={() => switchMode('server')}
            title="Server log"
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 ${
              mode === 'server' ? 'bg-green text-bg-primary' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}>
            server
          </button>
        )}
        {debug && (
          <button type="button" onClick={() => switchMode('client')}
            title="Client-side events log"
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 ${
              mode === 'client' ? 'bg-accent text-bg-primary' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            }`}>
            client
          </button>
        )}
        <button type="button" onClick={() => switchMode('file')}
          title="Watch a file"
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors shrink-0 ${
            mode === 'file' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
          }`}>
          file
        </button>

        {/* Filename display */}
        {mode === 'file' ? (
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            title={watching ? `Watching ${watchPath}` : 'Watch a file'}
            className="ml-auto flex items-center justify-end gap-1 min-w-0 max-w-[55%] group"
          >
            <span dir="rtl" className="min-w-0 truncate text-[12px] font-medium text-text-secondary underline decoration-dotted decoration-text-muted/70 underline-offset-2 group-hover:text-text-primary group-hover:decoration-text-primary">
              <span dir="ltr">{filename}</span>
            </span>
            <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-text-muted transition-transform ${formOpen ? 'rotate-180' : ''}`} />
          </button>
        ) : (
          <span className="ml-auto min-w-0 truncate text-[12px] font-medium text-text-secondary">{filename}</span>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {(mode === 'server' || mode === 'file') && (
            <button onClick={() => setPaused((p) => !p)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors ${paused ? 'bg-yellow/30 text-yellow' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          )}
          <button onClick={clearLines} title="Clear view"
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* File path input form */}
      {formOpen && mode === 'file' && (
        <form onSubmit={watch} className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border bg-bg-secondary shrink-0">
          <FileText className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a file path to watch…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            className="flex-1 min-w-0 h-7 px-2 rounded-md bg-bg-primary border border-border text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 font-mono"
          />
          <button type="submit" disabled={!input.trim()}
            className="px-2.5 h-7 rounded-md text-[11px] font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
            Watch
          </button>
          {watching && (
            <button type="button" onClick={() => { setWatchPath(''); setLines([]); }}
              title="Stop watching"
              className="flex items-center gap-1 px-2 h-7 rounded-md text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" onClick={() => setFormOpen(false)} title="Hide form"
            className="p-1.5 h-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {/* Log output */}
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="flex-1 min-h-0 overflow-auto font-mono text-[11px] leading-5 px-2.5 py-1.5 text-text-secondary whitespace-pre-wrap break-all"
      >
        {mode === 'client'
          ? displayLines.length === 0
            ? <div className="text-text-muted py-2">No client events yet. Layout saves, cursor moves, and server responses will appear here.</div>
            : displayLines.map((line, i) => (
              <div key={i} className={line.includes('ERROR') ? 'text-red/80' : line.includes('WARN') ? 'text-yellow/90' : undefined}>{line}</div>
            ))
          : error
            ? <div className="text-red/80 py-2">{watching ? `${watchPath}: ` : ''}{error}</div>
            : displayLines.length === 0
              ? <div className="text-text-muted py-2">
                  {mode === 'server' ? 'Debug mode is off — enable "debug: true" in config to see server logs.' : 'No file selected. Click "file" then enter a path to watch.'}
                </div>
              : displayLines.map((line, i) => (
                <div key={i} className={line.includes('ERROR') || line.includes('error') ? 'text-red/80' : undefined}>{line}</div>
              ))}
      </div>
    </div>
  )
}
