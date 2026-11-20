import type { CollabPointer } from '../types'

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function isUnit(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

// isCollabPointer validates a peer's pointer before it reaches the overlay.
// The backend also validates, but a second check keeps a malformed frame from
// producing NaN CSS coordinates.
export function isCollabPointer(value: unknown): value is CollabPointer {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  if (typeof p.tab !== 'string' || p.tab.length === 0 || p.tab.length > 1024) return false
  switch (p.kind) {
    case 'code':
      return isPositiveInt(p.line) && isPositiveInt(p.col)
    case 'image':
    case 'panel':
      return isUnit(p.u) && isUnit(p.v)
    case 'pdf':
      return isPositiveInt(p.page) && isUnit(p.u) && isUnit(p.v)
    case 'terminal':
      return isPositiveInt(p.row) && isPositiveInt(p.col)
    case 'browser':
      return typeof p.url === 'string' && p.url.length <= 2048 && isUnit(p.u) && isUnit(p.v)
    default:
      return false
  }
}

export function tabLabel(tab: string): string {
  return tab.split(/[\\/]/).pop() || tab
}

// pointerLabel is the semantic location shown in the roster and in cursor
// titles: file.go:20:14, doc.pdf p.2 50%/40%, etc.
export function pointerLabel(pointer: CollabPointer | null | undefined): string {
  if (!pointer) return ''
  const name = tabLabel(pointer.tab)
  switch (pointer.kind) {
    case 'code':
      return `${name}:${pointer.line}:${pointer.col}`
    case 'image':
      return `${name} ${Math.round(pointer.u * 100)}%, ${Math.round(pointer.v * 100)}%`
    case 'pdf':
      return `${name} p.${pointer.page} ${Math.round(pointer.u * 100)}%, ${Math.round(pointer.v * 100)}%`
    case 'terminal':
      return `${name} ${pointer.row}:${pointer.col}`
    case 'browser':
      return `${name} ${pointer.url}`
    case 'panel':
      return name
  }
}
