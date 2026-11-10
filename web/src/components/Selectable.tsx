import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { Check } from 'lucide-react'
import { TONE_RING, TONE_VAR, type Tone } from '../lib/viewTypes'

export interface MenuSegment {
  key: string
  label: string
  disabled?: boolean
  tint?: 'yellow' | 'red'
  onSelect: () => void
}

export interface MenuEntry {
  key: string
  kind?: 'item' | 'header' | 'separator' | 'split'
  label?: string
  icon?: ReactNode
  checked?: boolean
  onSelect?: () => void
  segments?: MenuSegment[]
}

const LONG_PRESS_MS = 450

// useRowMenu — the reusable long-press hook. Attach `bind` to any row; a long
// press (450ms) or right-click opens the popup at the pointer. `openMenu(x, y)`
// is exposed so a caller can open the popup programmatically.
//
// `onLongPress` lets a SelectableGroup intercept the long press (to enter
// select mode instead of opening the menu immediately). `onMenuClose` fires
// whenever the popup goes away so the group can return to selecting mode.
//
// When `swipe` is supplied, a short drag in that direction fires `onSwipe`.
// This is only used by the view-menu rows (swipe right to add an instance);
// selection itself is long-press driven.
export function useRowMenu(
  items: MenuEntry[],
  opts: {
    swipe?: 'up' | 'left' | 'right'
    onSwipe?: () => void
    onLongPress?: (x: number, y: number) => void
    onContextMenu?: () => void
    onMenuClose?: () => void
  } = {},
) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | null>(null)
  const longFired = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const swipeFired = useRef(false)
  const openedAt = useRef(0)

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  useEffect(() => clearTimer, [])

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [pos])

  // Notify the group when the popup closes (action, outside click, scroll, …).
  const prevPos = useRef(pos)
  useEffect(() => {
    if (prevPos.current && !pos) opts.onMenuClose?.()
    prevPos.current = pos
  }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps

  const openMenu = (x: number, y: number) => {
    openedAt.current = performance.now()
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - 220)),
      y: Math.max(8, Math.min(y, window.innerHeight - 260)),
    })
  }

  const consumeLongPress = () => {
    const v = longFired.current
    longFired.current = false
    return v
  }

  const consumeSwipe = () => {
    const v = swipeFired.current
    swipeFired.current = false
    return v
  }

  const bind = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      longFired.current = false
      swipeFired.current = false
      const pt = { x: e.clientX, y: e.clientY }
      origin.current = pt
      clearTimer()
      if (items.length > 0 || opts.onLongPress) {
        timer.current = window.setTimeout(() => {
          longFired.current = true
          if (opts.onLongPress) opts.onLongPress(pt.x, pt.y)
          else openMenu(pt.x, pt.y)
        }, LONG_PRESS_MS)
      }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!origin.current) return
      const dx = e.clientX - origin.current.x
      const dy = e.clientY - origin.current.y
      const fired = opts.swipe === 'up'
        ? dy < -28 && Math.abs(dx) < 24
        : opts.swipe === 'left'
          ? dx < -28 && Math.abs(dy) < 24
          : opts.swipe === 'right'
            ? dx > 28 && Math.abs(dy) < 24
            : false
      if (fired) {
        clearTimer()
        if (!swipeFired.current) {
          swipeFired.current = true
          opts.onSwipe?.()
        }
        return
      }
      const moveThreshold = e.pointerType === 'touch' ? 32 : 12
      if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) clearTimer()
    },
    onPointerUp: () => {
      clearTimer()
      origin.current = null
    },
    // Touch browsers fire pointerleave on the slightest finger drift; treating
    // that as a cancel made long-press selection practically impossible. Touch
    // scrolling is still covered by pointercancel, and real movement clears the
    // timer in onPointerMove.
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch') return
      clearTimer()
      origin.current = null
    },
    onPointerCancel: () => { clearTimer(); origin.current = null },
    onContextMenu: (e: ReactMouseEvent) => {
      if (items.length === 0 && !opts.onLongPress) return
      e.preventDefault()
      // A touch long-press may surface as `contextmenu` before our 450ms timer
      // on some browsers. Treat that as the long press instead of swallowing
      // the gesture; otherwise selection never starts on those devices.
      if (origin.current) {
        if (!longFired.current) {
          longFired.current = true
          clearTimer()
          if (opts.onLongPress) opts.onLongPress(e.clientX, e.clientY)
          else openMenu(e.clientX, e.clientY)
        }
        return
      }
      clearTimer()
      if (longFired.current) return
      opts.onContextMenu?.()
      openMenu(e.clientX, e.clientY)
    },
  }

  const menuNode = pos ? (
    <>
      <div
        className="fixed inset-0 z-40"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (performance.now() - openedAt.current < 250) return
          setPos(null)
        }}
        onContextMenu={(e) => { e.preventDefault(); setPos(null) }}
      />
      <div
        className="fixed z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[200px]"
        style={{ left: pos.x, top: pos.y }}
      >
        {items.map((it) => {
          if (it.kind === 'separator') return <div key={it.key} className="my-1 border-t border-border" />
          if (it.kind === 'header') {
            return (
              <div key={it.key} className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                {it.icon}
                {it.label}
              </div>
            )
          }
          if (it.kind === 'split') {
            return (
              <div key={it.key} className="flex items-stretch my-1 border-y border-border/60">
                {it.segments?.map((seg, i) => (
                  <button
                    key={seg.key}
                    disabled={seg.disabled}
                    onClick={() => { seg.onSelect(); setPos(null) }}
                    className={`flex-1 min-h-[44px] px-3 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      seg.tint === 'yellow' ? 'bg-yellow/15 text-text-primary hover:bg-yellow/25'
                        : seg.tint === 'red' ? 'bg-red/25 text-text-primary hover:bg-red/35'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    } ${i > 0 ? 'border-l border-border/60' : ''}`}
                  >
                    {seg.label}
                  </button>
                ))}
              </div>
            )
          }
          return (
            <button
              key={it.key}
              onClick={() => { it.onSelect?.(); setPos(null) }}
              className={`flex items-center justify-between gap-2 w-full min-h-[44px] px-3 text-sm transition-colors ${
                it.checked ? 'text-accent' : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <span className="flex items-center gap-2">
                {it.icon}
                {it.label}
              </span>
              {it.checked && <Check className="w-4 h-4" />}
            </button>
          )
        })}
      </div>
    </>
  ) : null

  return {
    bind, openMenu, consumeLongPress, consumeSwipe, menuNode,
    longPressActive: () => longFired.current,
    cancelLongPress: clearTimer,
  }
}

// ── Select mode ───────────────────────────────────────────────────────────────
// A group owns the mode for its rows:
//   normal    → tap activates, long-press enters selecting
//   selecting → tap toggles selection, long-press opens the actions menu
//   menu      → the actions popup is open; closing returns to selecting
// While selecting, the whole list gets a yellow dotted border.

type SelectMode = 'normal' | 'selecting' | 'menu'

interface SelectModeValue {
  mode: SelectMode
  setMode: (mode: SelectMode) => void
  showMenuSelectMode: boolean
  selectedCount: number
}

const SelectModeContext = createContext<SelectModeValue | null>(null)

// Only one selectable group may be in select mode at a time. When another
// group starts selecting, the previous one is cancelled through this slot.
let activeSelectionCancel: (() => void) | null = null

export interface SelectableGroupProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  selectedCount?: number
  showMenuSelectMode?: boolean
  onCancelSelection?: () => void
}

export function SelectableGroup({ children, className = '', style, selectedCount = 0, showMenuSelectMode = true, onCancelSelection }: SelectableGroupProps) {
  const [mode, setMode] = useState<SelectMode>('normal')
  const [cancelPos, setCancelPos] = useState<{ top: number; right: number } | null>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const prevCount = useRef(selectedCount)
  const onCancelRef = useRef(onCancelSelection)

  useEffect(() => { onCancelRef.current = onCancelSelection }, [onCancelSelection])

  // Leave select mode when the last item is deselected (but not on the initial
  // render, before the long-press has had a chance to select anything).
  useEffect(() => {
    if (prevCount.current > 0 && selectedCount === 0 && mode === 'selecting') setMode('normal')
    prevCount.current = selectedCount
  }, [selectedCount, mode])

  const updateCancelPos = useCallback(() => {
    const el = groupRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCancelPos({
      top: Math.max(4, r.top + 4),
      right: Math.max(4, window.innerWidth - r.right + 4),
    })
  }, [])

  const cancelSelection = useCallback(() => {
    onCancelRef.current?.()
    setMode('normal')
  }, [])

  const enterMode = useCallback((next: SelectMode) => {
    if (next === 'selecting') updateCancelPos()
    setMode(next)
  }, [updateCancelPos])

  useEffect(() => {
    if (mode !== 'selecting') return
    if (activeSelectionCancel && activeSelectionCancel !== cancelSelection) activeSelectionCancel()
    activeSelectionCancel = cancelSelection
    return () => {
      if (activeSelectionCancel === cancelSelection) activeSelectionCancel = null
    }
  }, [mode, cancelSelection])

  useEffect(() => {
    if (mode !== 'selecting') return
    const onDocClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (!el) return
      if (el.closest('[data-selection-cancel]')) return
      const item = el.closest('[data-selectable-item]')
      if (item && groupRef.current?.contains(item)) return
      cancelSelection()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelSelection()
    }
    document.addEventListener('click', onDocClick, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [mode, cancelSelection])

  useEffect(() => {
    if (mode !== 'selecting') return
    window.addEventListener('resize', updateCancelPos)
    window.addEventListener('scroll', updateCancelPos, true)
    return () => {
      window.removeEventListener('resize', updateCancelPos)
      window.removeEventListener('scroll', updateCancelPos, true)
    }
  }, [mode, updateCancelPos])

  const value = useMemo(() => ({ mode, setMode: enterMode, showMenuSelectMode, selectedCount }), [mode, enterMode, showMenuSelectMode, selectedCount])

  return (
    <SelectModeContext.Provider value={value}>
      <div
        ref={groupRef}
        data-reorder-group
        className={`no-callout relative select-none ${className} ${
          mode === 'selecting' ? 'outline outline-2 outline-dotted outline-yellow -outline-offset-2' : ''
        }`}
        style={style}
      >
        {children}
        {mode === 'selecting' && cancelPos && (
          <button
            type="button"
            aria-label="Cancel selection"
            title="Cancel selection"
            data-selection-cancel
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              cancelSelection()
            }}
            className="fixed z-[60] px-1.5 h-6 rounded-md border border-border bg-bg-elevated text-[10px] font-mono font-bold text-text-secondary shadow-lg hover:text-text-primary hover:bg-bg-hover active:bg-bg-active"
            style={{ top: cancelPos.top, right: cancelPos.right }}
          >
            [x]
          </button>
        )}
      </div>
    </SelectModeContext.Provider>
  )
}

export interface SelectableProps {
  checked: boolean
  locked?: boolean
  onToggle: () => void
  onActivate?: () => void
  onDoubleClick?: () => void
  menu?: MenuEntry[]
  className?: string
  style?: CSSProperties
  label?: string
  tabIndex?: number
  itemRef?: (el: HTMLDivElement | null) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  onMiddleClick?: () => void
  tone?: Tone
  // Pointer-based reordering (desktop mouse). Drag a tab onto another tab to
  // move it; drop it outside the group to fire onDragAway (close it).
  dragId?: string
  onReorder?: (from: string, to: string) => void
  onDragAway?: (id: string) => void
  // Native HTML5 drag-and-drop (kept for the legacy editor tab strip).
  draggable?: boolean
  onDragStart?: (e: ReactDragEvent<HTMLDivElement>) => void
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: ReactDragEvent<HTMLDivElement>) => void
  children: ReactNode
}

// Selectable — wraps a row (file, search hit, editor tab, terminal tab, view
// tab). Long-press enters the group's select mode; long-press again opens the
// row's actions menu. There is no swipe-to-select. Selected rows get a yellow
// inset ring (red when locked).
export default function Selectable({
  checked, locked, onToggle, onActivate, onDoubleClick,
  menu = [], className = '', style, label,
  tabIndex, itemRef, onKeyDown, onMiddleClick, tone,
  dragId, onReorder, onDragAway,
  draggable, onDragStart, onDragOver, onDrop, onDragEnd, children,
}: SelectableProps) {
  const group = useContext(SelectModeContext)
  const [dragging, setDragging] = useState(false)
  const suppressClick = useRef(false)
  const toneKey: Tone = tone || 'yellow'
  const selectedStyle = checked
    ? { backgroundColor: `color-mix(in srgb, var(${TONE_VAR[toneKey]}) 30%, transparent)` }
    : undefined
  const { bind, openMenu, consumeLongPress, consumeSwipe, cancelLongPress, menuNode } = useRowMenu(menu, {
    onLongPress: (x, y) => {
      if (!group) { openMenu(x, y); return }
      if (group.mode === 'normal') {
        group.setMode('selecting')
        if (!checked) onToggle()
      } else if (group.mode === 'selecting') {
        if (menu.length > 0) {
          group.setMode('menu')
          openMenu(x, y)
        } else {
          group.setMode('normal')
        }
      } else {
        group.setMode('selecting')
      }
    },
    onContextMenu: () => { if (group) group.setMode('menu') },
    onMenuClose: () => { if (group) group.setMode(group.selectedCount > 0 ? 'selecting' : 'normal') },
  })

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    suppressClick.current = false
    bind.onPointerDown(e)
    if (!dragId || !onReorder) return
    if (group?.mode === 'menu') return
    // Mouse drags work everywhere; touch drags are enabled once the group is
    // in selecting mode (long-press first, then drag). In normal mode a touch
    // drag must remain a scroll gesture.
    if (e.pointerType !== 'mouse' && group?.mode !== 'selecting') return
    const root = e.currentTarget
    const groupEl = root.closest('[data-reorder-group]')
    const startX = e.clientX
    const startY = e.clientY
    const dragThreshold = e.pointerType === 'touch' ? 20 : 12
    let active = false
    let overId: string | null = null

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.abs(ev.clientX - startX) < dragThreshold && Math.abs(ev.clientY - startY) < dragThreshold) return
        active = true
        cancelLongPress()
        setDragging(true)
        suppressClick.current = true
        document.body.style.cursor = 'grabbing'
      }
      ev.preventDefault()
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const row = el?.closest('[data-reorder-id]') as HTMLElement | null
      overId = row && groupEl?.contains(row) ? row.dataset.reorderId ?? null : null
    }

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      setDragging(false)
      if (!active) return
      if (overId && overId !== dragId) onReorder?.(dragId, overId)
      else if (!overId) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
        if (!groupEl || !el || !groupEl.contains(el)) onDragAway?.(dragId)
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      ref={itemRef}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={bind.onPointerMove}
      onPointerUp={bind.onPointerUp}
      onPointerLeave={bind.onPointerLeave}
      onPointerCancel={bind.onPointerCancel}
      onContextMenu={bind.onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      data-reorder-id={dragId}
      data-selectable-item
      aria-selected={checked}
      aria-label={label}
      className={`no-callout relative select-none ${className}${
        checked ? ` ring-1 ring-inset ${TONE_RING[toneKey]}` : ''
      }${dragging ? ' opacity-50' : ''}`}
      style={{
        // In selecting mode the row is a drag handle (touch included), so stop
        // the browser from turning the gesture into a scroll.
        touchAction: group?.mode === 'selecting' ? 'none' : 'manipulation',
        ...selectedStyle,
        ...style,
      }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return }
        if (consumeLongPress() || consumeSwipe()) return
        if (group && group.mode !== 'normal') { onToggle(); return }
        onActivate?.()
      }}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMiddleClick ? (e) => { if (e.button === 1) e.preventDefault() } : undefined}
      onAuxClick={onMiddleClick ? (e) => {
        if (e.button !== 1) return
        e.preventDefault()
        e.stopPropagation()
        onMiddleClick()
      } : undefined}
    >
      {locked && <span className="absolute top-0 left-0 right-0 z-20 h-[2px] bg-red" />}
      {children}
      {menuNode}
    </div>
  )
}
