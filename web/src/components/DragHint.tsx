/* eslint-disable react-refresh/only-export-components */
import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
  type ReactNode, type TouchEvent as ReactTouchEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { detectSwipe, type SwipeDirection } from '../lib/swipe'

// ── DragHint: reusable action labels shown while dragging/swiping ────────────
//
// The gesture model is intentionally the same for finger and mouse:
//   - horizontal movement scrolls the strip natively (touch) or via
//     `onHorizontalDrag` (mouse),
//   - vertical/diagonal movement reveals labelled action zones,
//   - releasing over a zone runs its action.
//
// Labels gravitate toward the middle of the screen so the finger never covers
// them on a phone. The hook does not call preventDefault for touch, so native
// scrolling keeps working; pointercancel simply hides the labels.

export type DragHintPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

export interface DragHintAction {
  position: DragHintPosition
  label: string
  action?: () => void
  // Passive actions (e.g. scroll) are shown for discoverability but do not
  // fire on release; the browser/onHorizontalDrag already performed them.
  passive?: boolean
}

export interface DragHintInfo {
  target: Element | null
  dx: number
  dy: number
  clientX: number
  clientY: number
  pointerType: string
}

export interface UseDragHintsOptions {
  actions: DragHintAction[]
  onAction?: (action: DragHintAction, info: DragHintInfo) => void
  onHorizontalDrag?: (dx: number, info: DragHintInfo) => void
  triggerDistance?: number
  disabled?: boolean
}

interface GestureState {
  startX: number
  startY: number
  x: number
  y: number
  position: DragHintPosition | null
  target: Element | null
  pointerType: string
}

const VECTORS: Record<DragHintPosition, [number, number]> = {
  'top-left': [-1, -1],
  top: [0, -1],
  'top-right': [1, -1],
  left: [-1, 0],
  right: [1, 0],
  'bottom-left': [-1, 1],
  bottom: [0, 1],
  'bottom-right': [1, 1],
}

const DIRECTION_POSITION: Record<SwipeDirection, DragHintPosition> = {
  up: 'top',
  down: 'bottom',
  left: 'left',
  right: 'right',
  'up-left': 'top-left',
  'up-right': 'top-right',
  'down-left': 'bottom-left',
  'down-right': 'bottom-right',
}

const LABEL_PULL_TO_CENTER = 0.5
const LABEL_DISTANCE = 84
const LABEL_HALF_WIDTH = 58
const LABEL_HALF_HEIGHT = 16
const DOT_HALF_SIZE = 5

function clampPoint(x: number, y: number, halfW: number, halfH: number) {
  return {
    x: Math.max(halfW, Math.min(x, window.innerWidth - halfW)),
    y: Math.max(halfH, Math.min(y, window.innerHeight - halfH)),
  }
}

// Move a point halfway toward the screen centre, then keep it at least one
// label-distance away from the centre. The second step matters when the drag
// starts near the middle (e.g. a floating window): without it the hint sits
// under the finger and cannot be read.
function relocate(pointX: number, pointY: number, dirX: number, dirY: number) {
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  let x = pointX * (1 - LABEL_PULL_TO_CENTER) + cx * LABEL_PULL_TO_CENTER
  let y = pointY * (1 - LABEL_PULL_TO_CENTER) + cy * LABEL_PULL_TO_CENTER
  const dx = x - cx
  const dy = y - cy
  const dist = Math.hypot(dx, dy)
  if (dist < LABEL_DISTANCE) {
    const len = Math.hypot(dirX, dirY)
    const ux = len > 0 ? dirX / len : 0
    const uy = len > 0 ? dirY / len : 1
    x = cx + ux * LABEL_DISTANCE
    y = cy + uy * LABEL_DISTANCE
  }
  return { x, y }
}

function hintPoint(state: GestureState, position: DragHintPosition) {
  const [vx, vy] = VECTORS[position]
  const len = Math.hypot(vx, vy) || 1
  const baseX = state.startX + (vx / len) * LABEL_DISTANCE
  const baseY = state.startY + (vy / len) * LABEL_DISTANCE
  const point = relocate(baseX, baseY, vx, vy)
  return clampPoint(point.x, point.y, LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
}

function dotPoint(state: GestureState) {
  const [vx, vy] = state.position
    ? VECTORS[state.position]
    : [state.x - state.startX, state.y - state.startY]
  const point = relocate(state.x, state.y, vx, vy)
  return clampPoint(point.x, point.y, DOT_HALF_SIZE, DOT_HALF_SIZE)
}

function DragHintOverlay({ state, actions }: { state: GestureState; actions: DragHintAction[] }) {
  if (actions.length === 0) return null
  const dot = dotPoint(state)
  // `fixed` inside the IDE is relative to the UI-scale transform, which would
  // shrink/offset the dot away from the real pointer. Portal to <body> so the
  // overlay always uses viewport coordinates.
  return createPortal(
    <div className="fixed inset-0 z-[80] pointer-events-none overflow-hidden" aria-hidden>
      {actions.map((action) => {
        const { x, y } = hintPoint(state, action.position)
        const active = state.position === action.position
        return (
          <span
            key={`${action.position}:${action.label}`}
            className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-medium shadow-xl transition-all ${
              active
                ? 'border-accent bg-accent text-white scale-110'
                : 'border-border bg-bg-elevated/95 text-text-secondary'
            }`}
            style={{ left: x, top: y }}
          >
            {action.label}
          </span>
        )
      })}
      <span
        data-testid="drag-hint-dot"
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white/80 shadow-lg"
        style={{ left: dot.x, top: dot.y, width: 10, height: 10 }}
      />
    </div>,
    document.body,
  )
}

export function useDragHints(opts: UseDragHintsOptions) {
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts }, [opts])
  const [state, setState] = useState<GestureState | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  const swallowClick = useCallback(() => {
    const swallow = (ce: MouseEvent) => {
      ce.preventDefault()
      ce.stopPropagation()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => {
      window.removeEventListener('click', swallow, { capture: true })
    }, 80)
  }, [])

  const runAction = useCallback((position: DragHintPosition | null, info: DragHintInfo) => {
    if (!position) return
    const action = optsRef.current.actions.find((a) => a.position === position)
    if (!action || action.passive) return
    action.action?.()
    optsRef.current.onAction?.(action, info)
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    if (optsRef.current.disabled) return
    // Touch is handled by touch events: browsers may cancel pointer events as
    // soon as they decide the gesture is a pan, which would lose the swipe.
    if (e.pointerType === 'touch') return
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest('[data-drag-hint-ignore]')) return

    const startX = e.clientX
    const startY = e.clientY
    const pointerId = e.pointerId
    const pointerType = e.pointerType
    const triggerDistance = optsRef.current.triggerDistance ?? 15
    let dragging = false
    let scrolling = false
    let activePosition: DragHintPosition | null = null
    let lastX = startX
    const resetEl = target?.closest('[data-reorder-id]') as HTMLElement | null
    const insideResetEl = (x: number, y: number) => {
      if (!resetEl) return true
      const r = resetEl.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }

    const info = (ev: PointerEvent): DragHintInfo => ({
      target,
      dx: ev.clientX - startX,
      dy: ev.clientY - startY,
      clientX: ev.clientX,
      clientY: ev.clientY,
      pointerType,
    })

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      cleanupRef.current = null
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)

      if (!dragging && !scrolling) {
        // Mouse has no native horizontal pan on a tab strip. Scroll it while
        // the button is down so dragging and swiping behave the same way.
        if (
          pointerType === 'mouse' &&
          optsRef.current.onHorizontalDrag &&
          resetEl &&
          insideResetEl(ev.clientX, ev.clientY) &&
          adx > 18 &&
          adx > ady * 1.6
        ) {
          scrolling = true
          lastX = ev.clientX
        } else if (insideResetEl(ev.clientX, ev.clientY) && Math.hypot(dx, dy) >= 8) {
          dragging = true
        }
      }

      if (scrolling) {
        // Leaving the tab resets the scroll gesture: re-entering must not apply
        // the distance travelled while outside as a single scroll jump.
        if (!insideResetEl(ev.clientX, ev.clientY)) {
          scrolling = false
          setState(null)
          return
        }
        const step = ev.clientX - lastX
        lastX = ev.clientX
        optsRef.current.onHorizontalDrag?.(step, info(ev))
        ev.preventDefault()
        return
      }

      if (!dragging) return

      const swipe = detectSwipe(dx, dy, {
        minDistance: triggerDistance,
        diagonalMinDistance: triggerDistance,
      })
      activePosition = swipe ? DIRECTION_POSITION[swipe.direction] : null
      setState({
        startX,
        startY,
        x: ev.clientX,
        y: ev.clientY,
        position: activePosition,
        target,
        pointerType,
      })
      // Only the mouse needs this; touch scrolling must stay native.
      if (pointerType === 'mouse') ev.preventDefault()
    }

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      cleanup()
      const wasDragging = dragging || scrolling
      setState(null)
      if (!wasDragging) return
      swallowClick()
      if (!scrolling) runAction(activePosition, info(ev))
    }

    const onCancel = () => {
      cleanup()
      setState(null)
    }

    cleanupRef.current?.()
    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }, [runAction, swallowClick])

  const touchRef = useRef<{
    startX: number
    startY: number
    x: number
    y: number
    target: Element | null
    dragging: boolean
    scrolling: boolean
    position: DragHintPosition | null
  } | null>(null)

  const onTouchStart = useCallback((e: ReactTouchEvent) => {
    if (optsRef.current.disabled || e.touches.length !== 1) return
    const t = e.touches[0]
    const target = e.target instanceof Element ? e.target : null
    if (target?.closest('[data-drag-hint-ignore]')) return
    touchRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      x: t.clientX,
      y: t.clientY,
      target,
      dragging: false,
      scrolling: false,
      position: null,
    }
    setState(null)
  }, [])

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const s = touchRef.current
    const t = e.touches[0]
    if (!s || !t) return
    const dx = t.clientX - s.startX
    const dy = t.clientY - s.startY
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)
    s.x = t.clientX
    s.y = t.clientY
    const resetEl = s.target?.closest('[data-reorder-id]') as HTMLElement | null
    const insideResetEl = (x: number, y: number) => {
      if (!resetEl) return true
      const r = resetEl.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    if (!s.dragging && !s.scrolling) {
      if (Math.hypot(dx, dy) < 8) return
      // Horizontal touch is native strip scrolling, not an action button.
      if (resetEl && adx > 18 && adx > ady * 1.6) {
        s.scrolling = true
        s.position = null
        setState(null)
        return
      }
      s.dragging = true
    }
    if (s.scrolling) {
      if (!insideResetEl(t.clientX, t.clientY)) {
        s.scrolling = false
        s.startX = t.clientX
        s.startY = t.clientY
        s.dragging = false
      }
      setState(null)
      return
    }
    const swipe = detectSwipe(dx, dy, {
      minDistance: optsRef.current.triggerDistance ?? 15,
      diagonalMinDistance: optsRef.current.triggerDistance ?? 15,
    })
    s.position = swipe ? DIRECTION_POSITION[swipe.direction] : null
    setState({
      startX: s.startX,
      startY: s.startY,
      x: s.x,
      y: s.y,
      position: s.position,
      target: s.target,
      pointerType: 'touch',
    })
  }, [])

  const onTouchEnd = useCallback(() => {
    const s = touchRef.current
    touchRef.current = null
    setState(null)
    if (!s?.dragging) return
    swallowClick()
    runAction(s.position, {
      target: s.target,
      dx: s.x - s.startX,
      dy: s.y - s.startY,
      clientX: s.x,
      clientY: s.y,
      pointerType: 'touch',
    })
  }, [runAction, swallowClick])

  const onTouchCancel = useCallback(() => {
    touchRef.current = null
    setState(null)
  }, [])

  const overlay = state ? <DragHintOverlay state={state} actions={opts.actions} /> : null
  return {
    bind: { onPointerDown, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    overlay,
  }
}

// Convenience wrapper for components that do not need the hook directly.
export interface DragHintProps extends UseDragHintsOptions {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export default function DragHint({ children, className = '', style, ...options }: DragHintProps) {
  const { bind, overlay } = useDragHints(options)
  return (
    <div {...bind} className={`relative ${className}`} style={style}>
      {children}
      {overlay}
    </div>
  )
}
