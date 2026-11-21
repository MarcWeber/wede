/* eslint-disable react-refresh/only-export-components */
import React, {
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
  | 'rest'

// Helper that returns the directional offset for a named position.
// Used to define button-type action zones: offset_pos("top-right") returns the
// position string that determines both drag direction matching and label placement.
export function offset_pos(name: DragHintPosition): DragHintPosition {
  return name
}

export type DragHintAction =
  | {
      type: 'chosen_by_mouse'
      // Predicate that returns true when the action matches the drag direction.
      position: (dx: number, dy: number) => boolean
      // Label shown when this action is active
      label?: string
      // Action callback fired on release
      action?: () => void
      // Passive actions (e.g. scroll) are shown for discoverability but do not
      // fire on release; the browser/onHorizontalDrag already performed them.
      passive?: boolean
      modes?: string[]
    }
  | {
      type: 'button'
      // The directional position from offset_pos()
      position: DragHintPosition
      // Label shown when this action is active
      label?: string
      // Action callback fired on release
      action?: () => void
      passive?: boolean
      modes?: string[]
    }
  | {
      type: 'rest'
      // Label shown when this action is active
      label?: string
      // Action callback fired on release
      action?: () => void
      passive?: boolean
      modes?: string[]
    }

export interface DragHintInfo {
  target: Element | null
  dx: number
  dy: number
  clientX: number
  clientY: number
  pointerType: string
}

export interface DragEndInfo extends DragHintInfo {
  // Element under the pointer at release time
  dropTarget: Element | null
  // The [data-reorder-id] element under the pointer, if any
  dropReorderId: string | null
  // Whether the pointer is outside the [data-reorder-group] at release
  outsideGroup: boolean
}

export interface UseDragHintsOptions {
  actions: DragHintAction[]
  onAction?: (action: DragHintAction, info: DragHintInfo) => void
  onHorizontalDrag?: (dx: number, info: DragHintInfo) => void
  // Called when the "rest" action fires on release — i.e. the user dragged
  // without hitting a directional button. Use it for drag-and-drop:
  // reorder tabs, float tabs, or drop into view modes.
  onDragEnd?: (info: DragEndInfo) => void
  triggerDistance?: number
  disabled?: boolean
}

export interface UseDragHintsResult {
  bind: {
    onPointerDown: (e: ReactPointerEvent) => void
    onTouchStart: (e: ReactTouchEvent) => void
    onTouchMove: (e: ReactTouchEvent) => void
    onTouchEnd: (e: ReactTouchEvent) => void
    onTouchCancel: (e: ReactTouchEvent) => void
  }
  overlay: ReactNode
  // True while a directional gesture (not scroll/rest) is active.
  // Other components (e.g. Selectable) should not start their own drag
  // while this is true, to avoid competing pointer listeners.
  gestureActive: () => boolean
  // Return true if a gesture action just fired on the last pointer-up.
  // Call this from onClick to skip the default click action after a swipe.
  consumeAction: () => boolean
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
  'rest': [0, 0],
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

const LABEL_DISTANCE = 50
const LABEL_HALF_WIDTH = 58
const LABEL_HALF_HEIGHT = 16
const DOT_HALF_SIZE = 5
// Max drag distance for button-type action highlights. Beyond this, the drag
// is considered "past" the button zone and buttons revert to their idle state.
const MAX_TRIGGER_DISTANCE = 120

function clampPoint(x: number, y: number, halfW: number, halfH: number) {
  return {
    x: Math.max(halfW, Math.min(x, window.innerWidth - halfW)),
    y: Math.max(halfH, Math.min(y, window.innerHeight - halfH)),
  }
}

// Detect if the device is likely mobile (touch-based, small screen)
function isMobile() {
  return window.innerWidth < 768 || window.innerHeight < 500
}

// Compute a translation vector toward the screen center for mobile devices.
// When the drag starts at [0,0] relative to the drag origin, choose a direction
// toward the center so the user can see the labels with their thumb.
// For portrait mode: prefer y-axis (x=0, y=1)
// For landscape mode: prefer x-axis (x=1, y=0)
function mobileTranslationVector(dx: number, dy: number): [number, number] {
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  const isPortrait = window.innerHeight > window.innerWidth

  // Direction toward center from the drag point
  let tx = cx - (dx > 0 ? dx : 0)
  let ty = cy - (dy > 0 ? dy : 0)

  // Normalize
  const len = Math.hypot(tx, ty)
  if (len === 0) {
    // Default: toward center based on orientation
    return isPortrait ? [0, 1] : [1, 0]
  }
  tx /= len
  ty /= len

  // Bias toward the preferred axis for readability
  if (isPortrait) {
    ty *= 1.5
  } else {
    tx *= 1.5
  }
  const biasedLen = Math.hypot(tx, ty)
  return [tx / biasedLen, ty / biasedLen]
}

// On mobile, shift the dot slightly toward screen center so the finger
// doesn't cover it. On desktop the dot stays exactly where the pointer is.
function relocate(pointX: number, pointY: number, isTouch: boolean = false) {
  if (!isTouch || !isMobile()) return { x: pointX, y: pointY }
  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2
  const [tx, ty] = mobileTranslationVector(pointX - cx, pointY - cy)
  return { x: pointX + tx * 60, y: pointY + ty * 60 }
}

function hintPoint(state: GestureState, position: DragHintPosition) {
  const [vx, vy] = VECTORS[position]
  const len = Math.hypot(vx, vy) || 1
  const baseX = state.startX + (vx / len) * LABEL_DISTANCE
  const baseY = state.startY + (vy / len) * LABEL_DISTANCE
  const isTouch = state.pointerType === 'touch'
  const point = relocate(baseX, baseY, isTouch)
  return clampPoint(point.x, point.y, LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
}

function dotPoint(state: GestureState) {
  const isTouch = state.pointerType === 'touch'
  const point = relocate(state.x, state.y, isTouch)
  return clampPoint(point.x, point.y, DOT_HALF_SIZE, DOT_HALF_SIZE)
}

// Find the first action in the list that matches the current drag state.
// Order: chosen_by_mouse → button (directional) → rest (fallback).
// Button actions always take priority over rest, even for left/right positions
// (e.g., sidebar swipe-left uses button 'left' for "All tabs").
function findActiveAction(state: GestureState, actions: DragHintAction[]): DragHintAction | null {
  const dx = state.x - state.startX
  const dy = state.y - state.startY

  // 1. Mouse-only predicate actions
  for (const action of actions) {
    if (action.type === 'chosen_by_mouse') {
      if (state.pointerType === 'mouse' && typeof action.position === 'function' && action.position(dx, dy)) {
        return action
      }
    }
  }
  // 2. Directional button actions — always checked before rest
  for (const action of actions) {
    if (action.type === 'button' && typeof action.position === 'string' && state.position === action.position) {
      return action
    }
  }
  // 3. Rest fallback — only when no button matched the current position
  const restAction = actions.find((a) => a.type === 'rest')
  if (restAction && state.position === null) return restAction

  return null
}

// Compute label position from a base point (element center or gesture start)
function labelPosition(baseX: number, baseY: number, position: DragHintPosition) {
  const [vx, vy] = VECTORS[position]
  const len = Math.hypot(vx, vy) || 1
  const baseXOff = baseX + (vx / len) * LABEL_DISTANCE
  const baseYOff = baseY + (vy / len) * LABEL_DISTANCE
  return clampPoint(baseXOff, baseYOff, LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
}

function DragHintOverlay({ state, actions }: { state: GestureState | null; actions: DragHintAction[] }) {
  if (actions.length === 0) return null
  if (!state) return null

  // Pointer event clientX/clientY are always in viewport coordinates, even
  // inside a CSS-scaled container. Portal to <body> so the overlay uses
  // viewport coordinates directly.
  return createPortal(
    <div className="fixed inset-0 z-[80] pointer-events-none overflow-hidden" aria-hidden>
      {/* Show all action labels when dragging has started */}
      {actions.map((action, i) => {
        if (action.type === 'button' && typeof action.position === 'string' && action.label) {
          const { x, y } = hintPoint(state, action.position)
          const dragDistance = Math.hypot(state.x - state.startX, state.y - state.startY)
          const isActive = state.position === action.position && dragDistance <= MAX_TRIGGER_DISTANCE
          return (
            <span
              key={`btn-${i}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-medium shadow-xl transition-all ${
                isActive
                  ? 'border-red-500 bg-red-500 text-white scale-110'
                  : 'border-border bg-bg-elevated/95 text-text-secondary'
              }`}
              style={{ left: x, top: y }}
            >
              {action.label}
            </span>
          )
        }
        return null
      })}
      {/* Show the active action label for chosen_by_mouse and rest types */}
      {(() => {
        const active = findActiveAction(state, actions)
        if (!active) return null
        const label = active.label || ''
        if (active.type === 'chosen_by_mouse') {
          const { x, y } = clampPoint(state.x, state.y, LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
          return (
            <span
              key="active"
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-red-500 bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white shadow-xl"
              style={{ left: x, top: y - 30 }}
            >
              {label}
            </span>
          )
        }
        if (active.type === 'rest') {
          const { x, y } = clampPoint(state.x, state.y, LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
          return (
            <span
              key="active"
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-red-500 bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white shadow-xl"
              style={{ left: x, top: y + 30 }}
            >
              {label}
            </span>
          )
        }
        return null
      })()}
      {/* Red dot at current pointer position */}
      <span
        data-testid="drag-hint-dot"
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white/80 shadow-lg"
        style={{ ...dotPoint(state), width: 10, height: 10 }}
      />
    </div>,
    document.body,
  )
}

export function useDragHints(opts: UseDragHintsOptions) {
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts }, [opts])
  const [state, setState] = useState<GestureState | null>(null)
  // Sync ref for gestureActive: React state is async, but Selectable needs
  // to read the current gesture position synchronously on the same event tick.
  const stateRef = useRef<GestureState | null>(null)
  const setStateSync = (s: GestureState | null) => {
    stateRef.current = s
    setState(s)
  }
  const cleanupRef = useRef<(() => void) | null>(null)
  // Track whether a gesture action just fired, so onClick can skip toggling.
  const actionFired = useRef(false)

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
    // 1. Check for chosen_by_mouse action first (mouse-only)
    if (info.pointerType === 'mouse') {
      const mouseAction = optsRef.current.actions.find((a) => a.type === 'chosen_by_mouse')
      if (mouseAction && typeof mouseAction.position === 'function') {
        const isActive = mouseAction.position(info.dx, info.dy)
        if (isActive) {
          mouseAction.action?.()
          optsRef.current.onAction?.(mouseAction, info)
          return
        }
      }
    }
    // 2. Check for directional button action — always before rest
    const buttonAction = optsRef.current.actions.find((a) => a.type === 'button' && typeof a.position === 'string' && a.position === position)
    if (buttonAction && position) {
      if (!buttonAction.passive) {
        buttonAction.action?.()
        optsRef.current.onAction?.(buttonAction, info)
      }
      return
    }
    // 3. Rest fallback — only when no button matched (position is null)
    if (!position) {
      const restAction = optsRef.current.actions.find((a) => a.type === 'rest')
      if (restAction) {
        restAction.action?.()
        optsRef.current.onAction?.(restAction, info)
      }
      // If onDragEnd is configured, resolve what's under the pointer and call it
      const opts = optsRef.current
      if (opts.onDragEnd) {
        const el = document.elementFromPoint(info.clientX, info.clientY) as HTMLElement | null
        const row = el?.closest('[data-reorder-id]') as HTMLElement | null
        const groupEl = info.target?.closest('[data-reorder-group]') as HTMLElement | null
        const dropReorderId = row?.dataset.reorderId ?? null
        let outsideGroup = false
        if (groupEl && el) {
          const gr = groupEl.getBoundingClientRect()
          outsideGroup = info.clientX < gr.left - 12 || info.clientX > gr.right + 12
            || info.clientY > gr.bottom + 12 || info.clientY < gr.top - 12
        }
        opts.onDragEnd({
          ...info,
          dropTarget: el,
          dropReorderId,
          outsideGroup,
        })
      }
      return
    }
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    if (optsRef.current.disabled) return
    // Touch is handled by touch events: browsers may cancel pointer events as
    // soon as they decide the gesture is a pan, which would lose the swipe.
    if (e.pointerType === 'touch') return
    actionFired.current = false
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

    // Find the first chosen_by_mouse action whose predicate matches.
    // This is the action "signaled" to the user — e.g. horizontal drag = Scroll.
    const getActiveMouseAction = (dx: number, dy: number) => {
      if (pointerType !== 'mouse') return null
      for (const a of optsRef.current.actions) {
        if (a.type === 'chosen_by_mouse' && typeof a.position === 'function' && a.position(dx, dy)) return a
      }
      return null
    }

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)

      if (!scrolling) {
        // Check chosen_by_mouse first — it defines what horizontal drag means
        // (e.g. scrolling). If it matches, use it as the scroll trigger.
        // Scrolling takes priority over dragging so horizontal mouse drag
        // always scrolls the strip, even if dragging was already activated.
        const mouseAction = getActiveMouseAction(dx, dy)
        if (
          mouseAction &&
          pointerType === 'mouse' &&
          optsRef.current.onHorizontalDrag &&
          resetEl &&
          insideResetEl(ev.clientX, ev.clientY) &&
          adx > 18
        ) {
          scrolling = true
          lastX = ev.clientX
        }
      }

      if (!dragging && !scrolling && insideResetEl(ev.clientX, ev.clientY) && Math.hypot(dx, dy) >= 8) {
        dragging = true
      }

      if (scrolling) {
        // Leaving the tab resets the scroll gesture: re-entering must not apply
        // the distance travelled while outside as a single scroll jump.
        if (!insideResetEl(ev.clientX, ev.clientY)) {
          scrolling = false
          setStateSync(null)
          return
        }
        const step = ev.clientX - lastX
        lastX = ev.clientX
        optsRef.current.onHorizontalDrag?.(step, info(ev))
        // Show the chosen_by_mouse label in the overlay so the user sees
        // which action is being signaled.
        setStateSync({
          startX,
          startY,
          x: ev.clientX,
          y: ev.clientY,
          position: null,
          target,
          pointerType,
        })
        ev.preventDefault()
        return
      }

      if (!dragging) return

      const swipe = detectSwipe(dx, dy, {
        minDistance: triggerDistance,
        diagonalMinDistance: triggerDistance,
      })
      activePosition = swipe ? DIRECTION_POSITION[swipe.direction] : null
      setStateSync({
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
      setStateSync(null)
      if (!wasDragging) {
        actionFired.current = false
        return
      }
      swallowClick()
      if (!scrolling) {
        runAction(activePosition, info(ev))
        actionFired.current = true
      }
    }

    const onCancel = () => {
      cleanup()
      setStateSync(null)
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
    actionFired.current = false
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
    setStateSync(null)
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
        setStateSync(null)
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
      setStateSync(null)
      return
    }
    const swipe = detectSwipe(dx, dy, {
      minDistance: optsRef.current.triggerDistance ?? 15,
      diagonalMinDistance: optsRef.current.triggerDistance ?? 15,
    })
    s.position = swipe ? DIRECTION_POSITION[swipe.direction] : null
    setStateSync({
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
    setStateSync(null)
    if (!s?.dragging) {
      actionFired.current = false
      return
    }
    swallowClick()
    runAction(s.position, {
      target: s.target,
      dx: s.x - s.startX,
      dy: s.y - s.startY,
      clientX: s.x,
      clientY: s.y,
      pointerType: 'touch',
    })
    actionFired.current = true
  }, [runAction, swallowClick])

  const onTouchCancel = useCallback(() => {
    touchRef.current = null
    setStateSync(null)
  }, [])

  const overlay = state ? <DragHintOverlay state={state} actions={opts.actions} /> : null

  // Expose whether a directional gesture is active (not scroll/rest).
  // Other components should not start their own drag while this is true.
  const gestureActive = useCallback(() => {
    const s = stateRef.current
    if (!s || s.position === null) return false
    // left/right are gesture-active only when there's a button action for them
    // (e.g., sidebar swipe-left for "All tabs"). Otherwise they're the rest zone.
    if (s.position === 'left' || s.position === 'right') {
      const hasButton = optsRef.current.actions.some(
        (a) => a.type === 'button' && typeof a.position === 'string' && (a.position === 'left' || a.position === 'right'),
      )
      if (!hasButton) return false
    }
    return true
  }, [])

  // Let the consumer's onClick handler skip its default action when a gesture
  // just fired (e.g., swipe-left on a sidebar row should not toggle the row).
  const consumeAction = useCallback(() => {
    const v = actionFired.current
    actionFired.current = false
    return v
  }, [])

  return {
    bind: { onPointerDown, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
    overlay,
    gestureActive,
    consumeAction,
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
