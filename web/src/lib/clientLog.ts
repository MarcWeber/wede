// clientLog — logs client-side events (layout saves, cursor positions,
// server responses) for debugging. Only active when debug mode is enabled.
import { logUi } from './uiLog'

export function logLayoutSave(key: string, data: unknown): void {
  logUi('debug', 'client.log', 'layout save', { key, data })
}

export function logLayoutRestore(key: string, hasData: boolean): void {
  logUi('debug', 'client.log', 'layout restore', { key, hasData })
}

export function logInitPath(path: 'new-session' | 'restore-from-server'): void {
  logUi('debug', 'client.log', 'init path', { path })
}

export function logInitRestore(data: { tabs: number; containers: number; activeTab: string | null }): void {
  logUi('debug', 'client.log', 'init restore', data)
}


export function logCursorMove(path: string, line: number, col: number): void {
  logUi('debug', 'client.log', 'cursor move', { path, line, col })
}

export function logServerResponse(url: string, status: number, latency: number): void {
  logUi('debug', 'client.log', 'server response', { url, status, latency })
}

export function logWebSocketSend(msg: string): void {
  logUi('debug', 'client.log', 'ws send', { msg })
}

export function logWebSocketReceive(msg: string): void {
  logUi('debug', 'client.log', 'ws receive', { msg })
}

export function logDragDrop(action: string, data: Record<string, unknown>): void {
  logUi('debug', 'client.log', 'drag-drop', { action, ...data })
}
