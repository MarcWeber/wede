import { EditorView } from '@codemirror/view'
import type { CollabPointer } from '../types'
import { clamp01 } from './collabPointer'

export type PointerDirection = 'up' | 'down' | 'left' | 'right'

export interface DecodedPointer {
  x: number
  y: number
  offscreen: boolean
  direction: PointerDirection | null
}

const EDGE_MARGIN = 14

export function findCollabPane(tab: string): HTMLElement | null {
  const panes = document.querySelectorAll<HTMLElement>('[data-collab-tab]')
  for (const pane of panes) {
    if (pane.dataset.collabTab === tab) return pane
  }
  return null
}

function elementFrom(target: EventTarget | null | undefined): Element | null {
  return target instanceof Element ? target : null
}

function unitPoint(rect: DOMRect, clientX: number, clientY: number): { u: number; v: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    u: clamp01((clientX - rect.left) / rect.width),
    v: clamp01((clientY - rect.top) / rect.height),
  }
}

// encodeCollabPointer turns a local pointer event into a semantic location.
// DOM structure is used instead of component refs so every mounted tab (center,
// docked, floating, nested) works without extra prop plumbing.
export function encodeCollabPointer(
  pane: HTMLElement,
  clientX: number,
  clientY: number,
  target?: EventTarget | null,
): CollabPointer | null {
  const tab = pane.dataset.collabTab
  if (!tab) return null
  const el = elementFrom(target)

  const pdfPage = el?.closest<HTMLElement>('[data-pdf-page]')
  if (pdfPage) {
    const page = Number(pdfPage.dataset.pdfPage)
    const point = unitPoint(pdfPage.getBoundingClientRect(), clientX, clientY)
    if (Number.isInteger(page) && page > 0 && point) return { kind: 'pdf', tab, page, ...point }
  }

  const img = el?.closest<HTMLImageElement>('img[data-collab-image]')
  if (img) {
    const point = unitPoint(img.getBoundingClientRect(), clientX, clientY)
    if (point) return { kind: 'image', tab, ...point }
  }

  const cm = el?.closest<HTMLElement>('.cm-editor')
  if (cm) {
    const view = EditorView.findFromDOM(cm)
    const pos = view?.posAtCoords({ x: clientX, y: clientY })
    if (view && pos != null) {
      const line = view.state.doc.lineAt(pos)
      return { kind: 'code', tab, line: line.number, col: pos - line.from + 1 }
    }
  }

  const rect = pane.getBoundingClientRect()
  const point = unitPoint(rect, clientX, clientY)
  if (!point) return null
  return { kind: 'panel', tab, ...point }
}

export interface RectLike {
  left: number
  top: number
  right: number
  bottom: number
}

export function clampPointToRect(
  x: number,
  y: number,
  rect: RectLike,
  viewport: { width: number; height: number },
): DecodedPointer {
  const minX = Math.max(rect.left, 0) + EDGE_MARGIN
  const maxX = Math.min(rect.right, viewport.width) - EDGE_MARGIN
  const minY = Math.max(rect.top, 0) + EDGE_MARGIN
  const maxY = Math.min(rect.bottom, viewport.height) - EDGE_MARGIN
  const cx = Math.min(Math.max(x, minX), Math.max(minX, maxX))
  const cy = Math.min(Math.max(y, minY), Math.max(minY, maxY))
  const offscreen = x < minX || x > maxX || y < minY || y > maxY
  let direction: PointerDirection | null = null
  if (offscreen) {
    const dx = x < minX ? x - minX : x > maxX ? x - maxX : 0
    const dy = y < minY ? y - minY : y > maxY ? y - maxY : 0
    if (Math.abs(dx) > Math.abs(dy)) direction = dx < 0 ? 'left' : 'right'
    else direction = dy < 0 ? 'up' : 'down'
  }
  return { x: cx, y: cy, offscreen, direction }
}

function clampToRect(x: number, y: number, rect: DOMRect): DecodedPointer {
  return clampPointToRect(x, y, rect, { width: window.innerWidth, height: window.innerHeight })
}

// decodeCollabPointer maps a semantic target back to viewport coordinates.
// Off-screen targets are clamped to the visible edge of their pane so the
// overlay can show a direction dot instead of losing the collaborator.
export function decodeCollabPointer(pointer: CollabPointer): DecodedPointer | null {
  const pane = findCollabPane(pointer.tab)
  if (!pane) return null
  const paneRect = pane.getBoundingClientRect()
  if (paneRect.width <= 0 || paneRect.height <= 0) return null

  let x = 0
  let y = 0
  let rect: DOMRect | null = null

  switch (pointer.kind) {
    case 'code': {
      const cm = pane.querySelector<HTMLElement>('.cm-editor')
      const view = cm ? EditorView.findFromDOM(cm) : null
      if (!view) return null
      const line = view.state.doc.line(Math.max(1, Math.min(pointer.line, view.state.doc.lines)))
      const pos = line.from + Math.max(0, Math.min(pointer.col - 1, line.length))
      const coords = view.coordsAtPos(pos)
      if (coords) {
        x = coords.left
        y = (coords.top + coords.bottom) / 2
      } else {
        const block = view.lineBlockAt(pos)
        x = view.scrollDOM.getBoundingClientRect().left + 8
        y = view.documentTop + block.top + view.defaultLineHeight / 2
      }
      rect = paneRect
      break
    }
    case 'image': {
      const img = pane.querySelector<HTMLImageElement>('img[data-collab-image]')
      if (!img) return null
      const r = img.getBoundingClientRect()
      x = r.left + pointer.u * r.width
      y = r.top + pointer.v * r.height
      rect = paneRect
      break
    }
    case 'pdf': {
      const page = pane.querySelector<HTMLElement>(`[data-pdf-page="${pointer.page}"]`)
      if (!page) return null
      const r = page.getBoundingClientRect()
      x = r.left + pointer.u * r.width
      y = r.top + pointer.v * r.height
      rect = paneRect
      break
    }
    case 'browser':
    case 'panel': {
      x = paneRect.left + pointer.u * paneRect.width
      y = paneRect.top + pointer.v * paneRect.height
      rect = paneRect
      break
    }
    case 'terminal':
      return null
  }

  return rect ? clampToRect(x, y, rect) : null
}
