/* eslint-disable react-refresh/only-export-components */
import React, {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
  type ReactNode, type TouchEvent as ReactTouchEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { detectSwipe, type SwipeDirection } from '../lib/swipe'
import { fit_translation, is_x_scroll, TAB_DRAG_THRESHOLD, toward_center_translation } from '../lib/swipe-utilities'
import { type D2, add, normalize, scale } from '../lib/2dspace'

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
  // Whether the pointer landed on the right half of the target tab
  dropReorderAfter: boolean
  // Whether the pointer is outside the [data-reorder-group] at release
  outsideGroup: boolean
}

export interface UseDragHintsOptions {
  actions: DragHintAction[]
  onAction?: (action: DragHintAction, info: DragHintInfo) => void
  onHorizontalDrag?: (dx: number, info: DragHintInfo) => boolean | void
  onDragStart?: (info: DragHintInfo) => void
  onDragCancel?: () => void
  // Called when the "rest" action fires on release — i.e. the user dragged
  // without hitting a directional button. Use it for drag-and-drop:
  // reorder tabs, float tabs, or drop into view modes.
  onDragEnd?: (info: DragEndInfo) => void
  triggerDistance?: number
  // Rest drag only starts after this distance. Tabbed uses 3*D so a short
  // directionless swipe does not reorder the strip.
  restMinDistance?: number
  // Optional cap for directional buttons. Past it the gesture is treated as a
  // rest/drag instead of firing a button. Defaults to no cap (a row swipe must
  // still fire after crossing the whole row). Tabbed caps at 5*D.
  buttonMaxDistance?: number
  disabled?: boolean
  mode?: string
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
  tabDragMode: boolean // true while the pointer is in tab-drag mode
}

const VECTORS: Record<DragHintPosition, D2> = {
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

const LABEL_DISTANCE = 50 // Distance from gesture start to labels
const LABEL_HALF_WIDTH = 58
const LABEL_HALF_HEIGHT = 10
const DOT_HALF_SIZE = 5
// Max drag distance for tab-strip directional buttons is 5*D (see
// swipe-utilities). Other DragHint users (menu rows) leave this uncapped.

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

type Translation = D2

// Compute the overlay shift once for the whole gesture. On touch the labels and
// the red dot move together toward the screen centre. On desktop they move only
// far enough to keep every button (and the dot) on screen.
function overlay_translation(state: GestureState, actions: DragHintAction[], mode?: string): Translation {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  if (state.pointerType === 'touch' && isMobile()) {
    const p = toward_center_translation({ x: state.startX, y: state.startY }, viewport, 60)
    return [p.x, p.y]
  }

  const points: Array<{ x: number; y: number; hw: number; hh: number }> = [
    { x: state.x, y: state.y, hw: DOT_HALF_SIZE, hh: DOT_HALF_SIZE },
  ]
  if (!state.tabDragMode) {
    for (const action of actions) {
      if (action.type !== 'button' || !actionAvailable(action, mode)) continue
      const p = add([state.startX, state.startY], scale(normalize(VECTORS[action.position]), LABEL_DISTANCE))
      points.push({
        x: p[0],
        y: p[1],
        hw: LABEL_HALF_WIDTH,
        hh: LABEL_HALF_HEIGHT,
      })
    }
  }
  const bounds = points.reduce(
    (b, p) => ({
      left: Math.min(b.left, p.x - p.hw),
      right: Math.max(b.right, p.x + p.hw),
      top: Math.min(b.top, p.y - p.hh),
      bottom: Math.max(b.bottom, p.y + p.hh),
    }),
    { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
  )
  const fit = fit_translation(bounds, viewport, 8)
  return [fit.x, fit.y]
}

// Position a label around the gesture start point in a given direction.
function hintPoint(startX: number, startY: number, position: DragHintPosition, translation: Translation) {
  const p = add(add([startX, startY], scale(normalize(VECTORS[position]), LABEL_DISTANCE)), translation)
  return clampPoint(p[0], p[1], LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
}

// Position the red dot at the current pointer plus the overlay translation.
function dotPoint(x: number, y: number, translation: Translation) {
  return clampPoint(x + translation[0], y + translation[1], DOT_HALF_SIZE, DOT_HALF_SIZE)
}

// Check if an action is available in the current mode.
function actionAvailable(action: DragHintAction, mode?: string): boolean {
  if (!action.modes || action.modes.length === 0) return true
  return mode ? action.modes.includes(mode) : true
}

// Find the first matching action: chosen_by_mouse → button → rest.
function findActiveAction(
  position: DragHintPosition | null,
  dx: number,
  dy: number,
  pointerType: string,
  actions: DragHintAction[],
  mode?: string,
  tabDrag = false,
): DragHintAction | null {
  // 1. Mouse-only predicate actions
  if (!tabDrag && pointerType === 'mouse') {
    for (const a of actions) {
      if (
        a.type === 'chosen_by_mouse' &&
        actionAvailable(a, mode) &&
        typeof a.position === 'function' &&
        a.position(dx, dy)
      ) {
        return a
      }
    }
  }
  // 2. Directional button actions — always before rest
  if (position) {
    for (const a of actions) {
      if (a.type === 'button' && actionAvailable(a, mode) && a.position === position) {
        return a
      }
    }
  }
  // 3. Rest fallback — only when no button matched
  const restAction = actions.find((a) => a.type === 'rest' && actionAvailable(a, mode))
  if (restAction && position === null) return restAction
  return null
}

function DragHintOverlay({
  state,
  actions,
  mode,
  restMinDistance = 0,
  buttonMaxDistance = Infinity,
}: {
  state: GestureState | null
  actions: DragHintAction[]
  mode?: string
  restMinDistance?: number
  buttonMaxDistance?: number
}) {
  if (!state || actions.length === 0) return null

  const dragDistance = Math.hypot(state.x - state.startX, state.y - state.startY)
  const translation = overlay_translation(state, actions, mode)

  return createPortal(
    <div className="fixed inset-0 z-[80] pointer-events-none overflow-hidden" aria-hidden>
      {/* Button-type action labels around gesture start */}
      {!state.tabDragMode &&
        actions.map((action, i) => {
          if (action.type !== 'button' || typeof action.position !== 'string' || !action.label) return null
          if (!actionAvailable(action, mode)) return null
          const { x, y } = hintPoint(state.startX, state.startY, action.position, translation)
          const isActive = state.position === action.position && dragDistance <= buttonMaxDistance
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
        })}
      {/* Active label for chosen_by_mouse and rest types */}
      {(() => {
        const active = findActiveAction(
          state.position,
          state.x - state.startX,
          state.y - state.startY,
          state.pointerType,
          actions,
          mode,
          state.tabDragMode,
        )
        if (!active || !active.label) return null
        if (active.type === 'rest' && dragDistance < restMinDistance) return null
        const dot = dotPoint(state.x, state.y, translation)
        const { x, y } = clampPoint(dot.x, dot.y, LABEL_HALF_WIDTH, LABEL_HALF_HEIGHT)
        if (active.type === 'chosen_by_mouse') {
          return (
            <span
              key="active"
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-red-500 bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white shadow-xl"
              style={{ left: x, top: y - 30 }}
            >
              {active.label}
            </span>
          )
        }
        if (active.type === 'rest') {
          return (
            <span
              key="active"
              className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-red-500 bg-red-500 px-2.5 py-1 text-[11px] font-medium text-white shadow-xl"
              style={{ left: x, top: y + 30 }}
            >
              {active.label}
            </span>
          )
        }
        return null
      })()}
      {/* Red dot at current pointer position */}
      {(() => {
        const { x, y } = dotPoint(state.x, state.y, translation)
        return (
          <span
            data-testid="drag-hint-dot"
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-white/80 shadow-lg"
            style={{ left: x, top: y, width: 10, height: 10 }}
          />
        )
      })()}
    </div>,
    document.body,
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

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

  // Find the element under a point by checking bounding rects of all
  // [data-reorder-id] elements. This works even when pointerEvents:none blocks
  // elementFromPoint (e.g. floating containers during modeDrag).
  function findElementAtPoint(x: number, y: number): HTMLElement | null {
    // Try elementFromPoint first (fast path)
    const direct = document.elementFromPoint(x, y) as HTMLElement | null
    if (direct) return direct
    // Fallback: scan all reorder-id elements by bounding rect
    const all = document.querySelectorAll('[data-reorder-id]') as NodeListOf<HTMLElement>
    let best: HTMLElement | null = null
    for (let i = 0; i < all.length; i++) {
      const r = all[i].getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        best = all[i]
        break
      }
    }
    return best
  }

  const runAction = useCallback((position: DragHintPosition | null, info: DragHintInfo, tabDrag = false) => {
    const o = optsRef.current
    const currentMode = o.mode
    const buttonMaxDistance = o.buttonMaxDistance ?? Infinity

    // 1. chosen_by_mouse (mouse-only predicate). Never while tab-drag mode is
    // active: the gesture has already become a drag & drop, so a horizontal
    // final move must not swallow the drop.
    if (!tabDrag && info.pointerType === 'mouse') {
      const mouseAction = o.actions.find((a) => a.type === 'chosen_by_mouse' && actionAvailable(a, currentMode))
      if (
        mouseAction?.type === 'chosen_by_mouse' &&
        typeof mouseAction.position === 'function' &&
        mouseAction.position(info.dx, info.dy)
      ) {
        mouseAction.action?.()
        o.onAction?.(mouseAction, info)
        return
      }
    }
    // 2. Directional button action — a matching button always wins, even if
    // the pointer has left the strip (e.g. Close tab dragged downward).
    // The release-point check below is only used for drag & drop.
    // Use findElementAtPoint which checks bounding rects when elementFromPoint
    // fails due to pointerEvents:none on floating containers.
    const el = findElementAtPoint(info.clientX, info.clientY)
    const releaseGroupEl = el?.closest('[data-reorder-group]') as HTMLElement | null
    let releaseOutsideGroup = false
    if (releaseGroupEl) {
      const gr = releaseGroupEl.getBoundingClientRect()
      releaseOutsideGroup =
        info.clientX < gr.left - 12 ||
        info.clientX > gr.right + 12 ||
        info.clientY > gr.bottom + 12 ||
        info.clientY < gr.top - 12
    } else {
      releaseOutsideGroup = true
    }
    const dragDistance = Math.hypot(info.dx, info.dy)
    if (position && dragDistance <= buttonMaxDistance) {
      const buttonAction = o.actions.find(
        (a) => a.type === 'button' && actionAvailable(a, currentMode) && a.position === position,
      )
      if (buttonAction) {
        if (!buttonAction.passive) {
          buttonAction.action?.()
          o.onAction?.(buttonAction, info)
        }
        return
      }
    }
    // 3. Rest fallback — drag & drop (when no button matched or outside group).
    // A rest gesture is a real tab drag only after the tab-drag threshold.
    if (Math.hypot(info.dx, info.dy) < (o.restMinDistance ?? 0)) return
    {
      const restAction = o.actions.find((a) => a.type === 'rest' && actionAvailable(a, currentMode))
      if (restAction) {
        restAction.action?.()
        o.onAction?.(restAction, info)
      }
      if (o.onDragEnd) {
        const row = el?.closest('[data-reorder-id]') as HTMLElement | null
        const dropReorderId = row?.dataset.reorderId ?? null
        // Detect left/right half of the target tab for insert position
        let dropReorderAfter = false
        if (row) {
          const rect = row.getBoundingClientRect()
          dropReorderAfter = info.clientX > rect.left + rect.width / 2
        }
        o.onDragEnd({
          ...info,
          dropTarget: el,
          dropReorderId,
          dropReorderAfter,
          outsideGroup: releaseOutsideGroup,
        })
      }
    }
  }, [])

  // ── Mouse pointer events ─────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0 || optsRef.current.disabled) return
      if (e.pointerType === 'touch') return // handled by touch events
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
      let tabDragMode = false
      let dragStarted = false
      let cancelled = false
      let activePosition: DragHintPosition | null = null
      let lastX = startX

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

      const getActiveMouseAction = (dx: number, dy: number) => {
        if (pointerType !== 'mouse') return null
        const currentMode = optsRef.current.mode
        for (const a of optsRef.current.actions) {
          if (
            a.type === 'chosen_by_mouse' &&
            actionAvailable(a, currentMode) &&
            typeof a.position === 'function' &&
            a.position(dx, dy)
          )
            return a
        }
        return null
      }

      const getActiveButtonAction = (position: DragHintPosition | null, distance: number) => {
        if (!position || distance > (optsRef.current.buttonMaxDistance ?? Infinity)) return null
        const currentMode = optsRef.current.mode
        return (
          optsRef.current.actions.find(
            (a) => a.type === 'button' && actionAvailable(a, currentMode) && a.position === position,
          ) ?? null
        )
      }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || cancelled) return
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        const adx = Math.abs(dx)
        const distance = Math.hypot(dx, dy)

        // Horizontal scroll wins until tab-drag mode starts. This is checked on
        // every mouse move, not just the first one, so a slow drag cannot turn a
        // scroll into a reorder by crossing 8px first.
        if (
          !tabDragMode &&
          pointerType === 'mouse' &&
          optsRef.current.onHorizontalDrag &&
          adx > 18 &&
          is_x_scroll(dx, dy)
        ) {
          const mouseAction = getActiveMouseAction(dx, dy)
          if (mouseAction) {
            if (!scrolling) {
              scrolling = true
              lastX = ev.clientX
              if (dragging) {
                dragging = false
                if (dragStarted) optsRef.current.onDragCancel?.()
                dragStarted = false
              }
            }
            const step = ev.clientX - lastX
            lastX = ev.clientX
            const handled = optsRef.current.onHorizontalDrag(step, info(ev))
            ev.preventDefault()
            if (handled === false) {
              // The pointer left the strip: reset the whole gesture instead of
              // letting it turn into a drop/reorder on release.
              cancelled = true
              scrolling = false
              setStateSync(null)
              return
            }
            setStateSync({
              startX,
              startY,
              x: ev.clientX,
              y: ev.clientY,
              position: null,
              target,
              pointerType,
              tabDragMode: false,
            })
            return
          }
        }

        if (!dragging && !scrolling && distance >= 8) {
          dragging = true
        }

        if (!dragging) return

        const swipe = detectSwipe(dx, dy, {
          minDistance: triggerDistance,
          diagonalMinDistance: triggerDistance,
        })
        activePosition = swipe ? DIRECTION_POSITION[swipe.direction] : null

        // A directional button always wins. Tab-drag only starts when there is
        // no action under the pointer, so dragging toward "Close tab" does not
        // silently turn into a reorder at 60px.
        if (!tabDragMode && !getActiveButtonAction(activePosition, distance) && distance >= TAB_DRAG_THRESHOLD) {
          tabDragMode = true
          dragStarted = true
          optsRef.current.onDragStart?.(info(ev))
        }

        setStateSync({
          startX,
          startY,
          x: ev.clientX,
          y: ev.clientY,
          position: tabDragMode ? null : activePosition,
          target,
          pointerType,
          tabDragMode,
        })
        if (pointerType === 'mouse') ev.preventDefault()
      }

      let handled = false
      const onUp = (ev: PointerEvent | MouseEvent) => {
        if (handled) return
        if ('pointerId' in ev && ev.pointerId !== pointerId) return
        handled = true
        cleanup()
        const wasDragging = dragging || scrolling
        setStateSync(null)
        if (cancelled) {
          actionFired.current = false
          return
        }
        if (!wasDragging) {
          actionFired.current = false
          return
        }
        swallowClick()
        if (!scrolling) {
          // Once tab-drag mode starts, direction buttons are no longer active;
          // the release is a drag & drop operation.
          const clientX = 'clientX' in ev ? ev.clientX : 0
          const clientY = 'clientY' in ev ? ev.clientY : 0
          runAction(tabDragMode ? null : activePosition, {
            target,
            dx: clientX - startX,
            dy: clientY - startY,
            clientX,
            clientY,
            pointerType,
          }, tabDragMode)
          actionFired.current = true
        }
      }

      const onCancel = () => {
        cleanup()
        setStateSync(null)
        if (dragStarted) optsRef.current.onDragCancel?.()
      }

      cleanupRef.current?.()
      cleanupRef.current = cleanup
      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('pointercancel', onCancel)
    },
    [runAction, swallowClick],
  )

  // ── Touch events ─────────────────────────────────────────────────────────

  const touchRef = useRef<{
    startX: number
    startY: number
    x: number
    y: number
    target: Element | null
    dragging: boolean
    scrolling: boolean
    tabDragMode: boolean
    dragStarted: boolean
    cancelled: boolean
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
      tabDragMode: false,
      dragStarted: false,
      cancelled: false,
      position: null,
    }
    setStateSync(null)
  }, [])

  const onTouchMove = useCallback((e: ReactTouchEvent) => {
    const s = touchRef.current
    const t = e.touches[0]
    if (!s || !t || s.cancelled) return
    const dx = t.clientX - s.startX
    const dy = t.clientY - s.startY
    const adx = Math.abs(dx)
    const distance = Math.hypot(dx, dy)
    s.x = t.clientX
    s.y = t.clientY

    if (distance < 8 && !s.scrolling) return

    if (s.scrolling) {
      // Leaving the strip resets the gesture instead of starting a drop.
      const group = s.target?.closest('[data-reorder-group]') as HTMLElement | null
      if (group) {
        const r = group.getBoundingClientRect()
        const inside = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom
        if (!inside) {
          s.cancelled = true
          s.scrolling = false
          s.dragging = false
          if (s.dragStarted) optsRef.current.onDragCancel?.()
          setStateSync(null)
          return
        }
      }
      setStateSync(null)
      return
    }

    // Horizontal touch is native strip scrolling — only for reorderable tab
    // strips.  Menu rows and other elements without a [data-reorder-group]
    // should not be treated as horizontal scroll so that directional swipe
    // buttons (e.g. "Add Terminal" on a right swipe) still fire.
    const inReorderGroup = s.target?.closest('[data-reorder-group]') !== null
    if (!s.tabDragMode && inReorderGroup && adx > 18 && is_x_scroll(dx, dy)) {
      s.scrolling = true
      s.position = null
      if (s.dragging) {
        s.dragging = false
        if (s.dragStarted) optsRef.current.onDragCancel?.()
        s.dragStarted = false
      }
      setStateSync(null)
      return
    }

    if (!s.dragging) s.dragging = true

    const swipe = detectSwipe(dx, dy, {
      minDistance: optsRef.current.triggerDistance ?? 15,
      diagonalMinDistance: optsRef.current.triggerDistance ?? 15,
    })
    s.position = swipe ? DIRECTION_POSITION[swipe.direction] : null

    const button =
      s.position &&
      distance <= (optsRef.current.buttonMaxDistance ?? Infinity) &&
      optsRef.current.actions.find(
        (a) => a.type === 'button' && actionAvailable(a, optsRef.current.mode) && a.position === s.position,
      )
    if (!s.tabDragMode && !button && distance >= TAB_DRAG_THRESHOLD) {
      s.tabDragMode = true
      s.dragStarted = true
      optsRef.current.onDragStart?.({
        target: s.target,
        dx,
        dy,
        clientX: s.x,
        clientY: s.y,
        pointerType: 'touch',
      })
    }

    setStateSync({
      startX: s.startX,
      startY: s.startY,
      x: s.x,
      y: s.y,
      position: s.tabDragMode ? null : s.position,
      target: s.target,
      pointerType: 'touch',
      tabDragMode: s.tabDragMode,
    })
  }, [])

  const onTouchEnd = useCallback(() => {
    const s = touchRef.current
    touchRef.current = null
    setStateSync(null)
    if (!s || s.cancelled || !s.dragging) {
      actionFired.current = false
      return
    }
    // If this element has no swipe/drag actions at all (e.g. a plain menu row
    // such as Help or Settings), a slight finger movement should not swallow the
    // tap click — the user just intended to tap.
    const o = optsRef.current
    const hasMeaningfulAction =
      o.actions.some((a) => a.type === 'button' && actionAvailable(a, o.mode)) ||
      o.actions.some((a) => a.type === 'rest' && actionAvailable(a, o.mode)) ||
      !!o.onDragEnd
    if (!hasMeaningfulAction) {
      actionFired.current = false
      return
    }
    swallowClick()
    // Tab-drag mode only moves the tab; direction buttons are disabled.
    const pos = s.tabDragMode ? null : s.position
    runAction(pos, {
      target: s.target,
      dx: s.x - s.startX,
      dy: s.y - s.startY,
      clientX: s.x,
      clientY: s.y,
      pointerType: 'touch',
    }, s.tabDragMode)
    actionFired.current = true
  }, [runAction, swallowClick])

  const onTouchCancel = useCallback(() => {
    const s = touchRef.current
    touchRef.current = null
    setStateSync(null)
    if (s?.dragStarted) optsRef.current.onDragCancel?.()
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────

  const overlay = state ? (
    <DragHintOverlay state={state} actions={opts.actions} mode={opts.mode} restMinDistance={opts.restMinDistance} buttonMaxDistance={opts.buttonMaxDistance} />
  ) : null

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
