export type UiLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface UiLogEntry {
  seq: number
  at: number
  level: UiLogLevel
  source: string
  message: string
  data?: unknown
  line: string
}

const MAX_ENTRIES = 1000
const entries: UiLogEntry[] = []
const publicLines: string[] = []
const listeners = new Set<() => void>()
let seq = 0
let snapshot = ''
let installed = false

declare global {
  interface Window {
    wedeLog?: string[]
    wedeLogEvent?: (source: string, message: string, data?: unknown) => void
    clearWedeLog?: () => void
  }
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function timestamp(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

function dataText(data: unknown): string {
  if (data === undefined) return ''
  if (data instanceof Error) {
    return ` ${data.name}: ${data.message}${data.stack ? `\n${data.stack}` : ''}`
  }
  try {
    return ` ${JSON.stringify(data)}`
  } catch {
    return ' [unserializable]'
  }
}

function rebuildSnapshot() {
  snapshot = entries.map((entry) => entry.line).join('\n')
  for (const listener of listeners) listener()
}

export function logUi(level: UiLogLevel, source: string, message: string, data?: unknown): void {
  const at = Date.now()
  const entry: UiLogEntry = {
    seq: ++seq,
    at,
    level,
    source,
    message,
    data,
    line: `${timestamp(at)} ${level.toUpperCase().padEnd(5)} [${source}] ${message}${dataText(data)}`,
  }
  entries.push(entry)
  publicLines.push(entry.line)
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
    publicLines.splice(0, publicLines.length - MAX_ENTRIES)
  }
  rebuildSnapshot()
}

export function clearUiLog(): void {
  entries.length = 0
  publicLines.length = 0
  rebuildSnapshot()
}

export function getUiLogSnapshot(): string {
  return snapshot
}

export function subscribeUiLog(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function installUiLogCapture(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.wedeLog = publicLines
  window.wedeLogEvent = (source, message, data) => logUi('info', source, message, data)
  window.clearWedeLog = clearUiLog
  window.addEventListener('error', (event) => {
    logUi('error', 'window.error', event.message, event.error instanceof Error
      ? event.error
      : { filename: event.filename, line: event.lineno, column: event.colno })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    logUi('error', 'window.unhandledrejection', reason instanceof Error ? reason.message : String(reason), reason)
  })
  logUi('info', 'ui.log', 'browser diagnostics installed')
}
