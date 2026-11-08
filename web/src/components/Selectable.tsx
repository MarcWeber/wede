import {
  useEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react'
import { Check } from 'lucide-react'

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
export function useRowMenu(items: MenuEntry[]) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | null>(null)
  const longFired = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)

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

  const openMenu = (x: number, y: number) => setPos({
    x: Math.max(8, Math.min(x, window.innerWidth - 220)),
    y: Math.max(8, Math.min(y, window.innerHeight - 260)),
  })

  const consumeLongPress = () => {
    const v = longFired.current
    longFired.current = false
    return v
  }

  const bind = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      longFired.current = false
      const pt = { x: e.clientX, y: e.clientY }
      origin.current = pt
      clearTimer()
      if (items.length > 0) {
        timer.current = window.setTimeout(() => {
          longFired.current = true
          openMenu(pt.x, pt.y)
        }, LONG_PRESS_MS)
      }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!origin.current) return
      if (Math.abs(e.clientX - origin.current.x) > 10 || Math.abs(e.clientY - origin.current.y) > 10) clearTimer()
    },
    onPointerUp: clearTimer,
    onPointerLeave: clearTimer,
    onPointerCancel: clearTimer,
    onContextMenu: (e: ReactMouseEvent) => {
      if (items.length === 0) return
      e.preventDefault()
      clearTimer()
      openMenu(e.clientX, e.clientY)
    },
  }

  const menuNode = pos ? (
    <>
      <div
        className="fixed inset-0 z-40"
        onPointerDown={() => setPos(null)}
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

  return { bind, openMenu, consumeLongPress, menuNode }
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
  overlayOffset?: number
  label?: string
  tabIndex?: number
  itemRef?: (el: HTMLDivElement | null) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

// Selectable — wraps a row (file, search hit, editor tab, terminal tab).
//  * Renders a left overlay tap target that is always tinted 15% yellow so the
//    selection region is discoverable; a soft red overlay marks a locked row.
//    The checkbox is drawn when the row is selected (or locked). The overlay is
//    absolutely positioned, so it costs zero layout width.
//  * A long press / right-click anywhere on the row opens `menu`.
//  * A plain tap on the row calls `onActivate`; a tap on the overlay toggles
//    selection. Long-press never triggers either.
export default function Selectable({
  checked, locked, onToggle, onActivate, onDoubleClick,
  menu = [], className = '', style, overlayOffset = 0, label,
  tabIndex, itemRef, onKeyDown, children,
}: SelectableProps) {
  const { bind, consumeLongPress, menuNode } = useRowMenu(menu)

  return (
    <div
      {...bind}
      ref={itemRef}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      className={`relative ${className}`}
      style={style}
      onClick={() => { if (consumeLongPress()) return; onActivate?.() }}
      onDoubleClick={onDoubleClick}
    >
      <button
        type="button"
        aria-label={label || (checked ? 'Deselect' : 'Select')}
        aria-pressed={checked}
        onClick={(e) => {
          e.stopPropagation()
          if (consumeLongPress()) return
          onToggle()
        }}
        className={`absolute top-0 bottom-0 w-7 z-20 flex items-center justify-center select-none ${locked ? 'bg-red/25' : 'bg-yellow/15'}`}
        style={{ left: overlayOffset, WebkitTouchCallout: 'none' }}
      >
        {(checked || locked) && (
          <span
            className={`flex items-center justify-center w-4 h-4 -translate-y-[10px] rounded-[3px] border ${
              checked ? 'bg-yellow border-yellow text-black' : 'border-red/70 text-transparent'
            }`}
          >
            <Check className="w-3 h-3" strokeWidth={3} />
          </span>
        )}
      </button>

      {children}
      {menuNode}
    </div>
  )
}
