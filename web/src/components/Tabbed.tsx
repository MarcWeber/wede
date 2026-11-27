import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Lock, Unlock } from 'lucide-react'
import Selectable, { SelectableGroup, type MenuEntry } from './Selectable'
import { TONE_WEAK, TONE_VAR, toneForView, VIEW_MODES, type ViewMode } from '../lib/viewTypes'
import { useDragHints, offset_pos, type DragHintAction, type DragEndInfo } from './DragHint'
import { is_x_scroll, MAX_BUTTON_DISTANCE, TAB_DRAG_THRESHOLD } from '../lib/swipe-utilities'

export interface TabbedItem {
  id: string
  kind: string
  label: string
  ariaLabel?: string
  icon: LucideIcon
}

export interface TabbedProps {
  tabs: TabbedItem[]
  active: string
  lockedIds?: string[]
  size?: 'normal' | 'small'
  multilineSwipe?: boolean
  dropMode?: string
  dropActive?: boolean
  className?: string
  onBackgroundPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseSelected?: (ids: string[], includeLocked?: boolean) => void
  onHideSelected?: (ids: string[]) => void
  onToggleLock?: (ids: string[], locked: boolean) => void
  onSetViewMode?: (ids: string[], mode: ViewMode) => void
  onReorder?: (from: string, to: string, after: boolean) => void
  onDragAway?: (id: string, at: { x: number; y: number }) => void
  onDragDetach?: (id: string) => void
  onDropViewMode?: (id: string, mode: string, nearId?: string, after?: boolean) => void
  onDragCancelViewMode?: () => void
  onCopyLocation?: (ids: string[]) => void
}

// Tabbed — one reusable tab strip for the main center container and for each
// dock area. `small` keeps the same behavior but takes less room.
export default function Tabbed({
  tabs, active, lockedIds = [], size = 'normal', multilineSwipe = false, dropMode, dropActive = false, className = '', onBackgroundPointerDown,
  onActivate, onClose, onCloseSelected, onHideSelected, onToggleLock, onSetViewMode,
  onReorder, onDragAway, onDragDetach, onDropViewMode, onDragCancelViewMode,
  onCopyLocation,
}: TabbedProps) {
  const small = size === 'small'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [multiline, setMultiline] = useState(false)
  const [selectionMode, setSelectionMode] = useState<'normal' | 'selecting' | 'menu'>('normal')
  const [floatMenu, setFloatMenu] = useState<{ x: number; y: number; id: string; target: 'current' | 'selected' } | null>(null)
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // Shift-click range anchor: the last plainly clicked/selected tab. Unlike the
  // active tab it must not move when a shift-click extends the selection.
  const anchorRef = useRef<string | null>(null)

  // While not selecting, the anchor follows the active tab so a plain click
  // followed by a shift-click behaves like a browser.
  useEffect(() => {
    if (selectionMode === 'normal') anchorRef.current = active || null
  }, [active, selectionMode])

  // Keep the active tab visible. Followers open tabs programmatically and the
  // leader may click a tab that is scrolled out of the strip; both should scroll
  // the strip horizontally to reveal it (without scrolling the page).
  useEffect(() => {
    if (multiline) return
    const el = tabRefs.current[active]
    const strip = el?.parentElement
    if (!el || !strip) return
    const er = el.getBoundingClientRect()
    const sr = strip.getBoundingClientRect()
    if (er.left < sr.left) strip.scrollLeft -= sr.left - er.left
    else if (er.right > sr.right) strip.scrollLeft += er.right - sr.right
  }, [active, tabs, multiline])

  const gestureActions: DragHintAction[] = [
    // Mouse-only: horizontal drag scrolls the strip. Same predicate for touch,
    // which scrolls the strip natively.
    { type: 'chosen_by_mouse', position: (dx, dy) => is_x_scroll(dx, dy), label: 'Scroll', passive: true },
    // Top: expand/collapse tabs
    ...(multilineSwipe ? [{ type: 'button' as const, position: offset_pos('top'), label: multiline ? 'Collapse tabs' : 'Expand tabs' }] : []),
    // Bottom-right: close tab (near the thumb and easy to see).
    { type: 'button' as const, position: offset_pos('bottom-right'), label: 'Close tab' },
    // Down-left / bottom-left: select the tab, or cancel while selecting.
    { type: 'button' as const, position: offset_pos('bottom-left'), label: 'Cancel', modes: ['selecting'] },
    { type: 'button' as const, position: offset_pos('bottom-left'), label: 'Select', modes: ['normal'] },
    // Bottom: tab menu
    { type: 'button' as const, position: offset_pos('bottom'), label: 'Tab menu' },
    // Rest: start drag&drop
    { type: 'rest' as const, label: 'Drag' },
  ]
  const handleDragEnd = useCallback((info: DragEndInfo) => {
    const tabEl = info.target?.closest('[data-reorder-id]') as HTMLElement | null
    const tabId = tabEl?.dataset.reorderId ?? null
    if (!tabId) return

    // Reorder: dropped on another tab within the same group
    if (info.dropReorderId && info.dropReorderId !== tabId) {
      onReorder?.(tabId, info.dropReorderId, info.dropReorderAfter)
      onDragCancelViewMode?.()
      return
    }

    // Drop into a different view mode area (dock slot, another container, center).
    const sourceDropMode = info.target?.closest('[data-drop-mode]') as HTMLElement | null
    const sourceDropModeVal = sourceDropMode?.getAttribute('data-drop-mode')
    const dropModeEl = info.dropTarget?.closest('[data-drop-mode]') as HTMLElement | null
    const dropModeVal = dropModeEl?.getAttribute('data-drop-mode')
    if (dropModeVal && dropModeVal !== sourceDropModeVal) {
      // If dropped on a specific tab in the target container, preserve position
      if (info.dropReorderId) {
        onDropViewMode?.(tabId, dropModeVal, info.dropReorderId, info.dropReorderAfter)
      } else {
        onDropViewMode?.(tabId, dropModeVal)
      }
      return
    }

    // Dropped outside the strip, on the same strip without a target tab,
    // or on the same view mode area — float it.
    if (info.outsideGroup || !dropModeVal || dropModeVal === sourceDropModeVal) {
      onDragAway?.(tabId, { x: info.clientX, y: info.clientY })
      return
    }
    onDragCancelViewMode?.()
  }, [onReorder, onDropViewMode, onDragAway, onDragCancelViewMode])

  const { bind: gestureBind, overlay: gestureOverlay } = useDragHints({
    actions: gestureActions,
    mode: selectionMode,
    disabled: tabs.length === 0,
    restMinDistance: TAB_DRAG_THRESHOLD,
    buttonMaxDistance: MAX_BUTTON_DISTANCE,
    onHorizontalDrag: (dx, info) => {
      const group = info.target?.closest('[data-reorder-group]') as HTMLElement | null
      if (!group) return false
      const r = group.getBoundingClientRect()
      const inside = info.clientX >= r.left && info.clientX <= r.right
        && info.clientY >= r.top && info.clientY <= r.bottom
      if (!inside) return false
      group.scrollLeft -= dx
      return true
    },
    onDragStart: (info) => {
      const tabEl = info.target?.closest('[data-reorder-id]') as HTMLElement | null
      if (tabEl?.dataset.reorderId) onDragDetach?.(tabEl.dataset.reorderId)
    },
    onDragCancel: () => onDragCancelViewMode?.(),
    onDragEnd: handleDragEnd,
    onAction: (action, info) => {
      const tabEl = info.target?.closest('[data-reorder-id]') as HTMLElement | null
      const tabId = tabEl?.dataset.reorderId ?? null

      if (action.type === 'chosen_by_mouse') {
        // Horizontal scrolling is handled by onHorizontalDrag
        return
      }

      if (action.type === 'button' && typeof action.position === 'string') {
        if (action.position === 'top') {
          setMultiline((v) => !v)
        } else if (action.position === 'bottom-right') {
          if (tabId && !lockedIds.includes(tabId)) onClose(tabId)
        } else if (action.position === 'bottom-left') {
          if (selectionMode === 'selecting') {
            setSelected(new Set())
            setSelectionMode('normal')
          } else if (tabId) {
            anchorRef.current = tabId
            setSelected((prev) => {
              const next = new Set(prev)
              next.add(tabId)
              return next
            })
            setSelectionMode('selecting')
          }
        } else if (action.position === 'bottom' && tabEl) {
          tabEl.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: info.clientX,
            clientY: info.clientY,
          }))
        }
        onDragCancelViewMode?.()
      }
    },
  })

  if (tabs.length === 0) return null

  const toggle = (id: string) => {
    anchorRef.current = id
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectRange = (id: string) => {
    const anchor = anchorRef.current ?? active
    const anchorIndex = tabs.findIndex((tab) => tab.id === anchor)
    const targetIndex = tabs.findIndex((tab) => tab.id === id)
    if (anchorIndex < 0 || targetIndex < 0) {
      setSelected(new Set([id]))
      return
    }
    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    setSelected(new Set(tabs.slice(start, end + 1).map((tab) => tab.id)))
  }

  const openFloatMenu = (id: string, target: 'current' | 'selected') => {
    const rect = tabRefs.current[id]?.getBoundingClientRect()
    const x = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - 210)) : 40
    const y = rect ? Math.min(rect.bottom + 4, window.innerHeight - 300) : 80
    setFloatMenu({ x, y, id, target })
  }

  const rowHeight = small ? 'h-7' : 'h-10'
  const rowPad = small ? 'px-2' : 'px-3'
  const rowMin = small ? 'min-w-0' : 'min-w-[84px]'
  const rowGap = small ? 'gap-1' : 'gap-1.5'
  const iconSize = small ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const textSize = small ? 'text-[10px]' : 'text-[12px]'
  const textMax = small ? 'max-w-24' : 'max-w-32'
  const lineHeight = small ? 'h-[2px]' : 'h-[3px]'

  return (
    <div
      {...gestureBind}
      className="relative flex w-full min-w-0"
      onPointerDown={(e) => {
        // Container strips use a background drag to move the container. Do not
        // also treat that same press as a tab gesture.
        if (onBackgroundPointerDown && e.target instanceof Element && e.target.hasAttribute('data-reorder-group')) return
        gestureBind.onPointerDown(e)
      }}
    >
      {gestureOverlay}
      <SelectableGroup
        className={`flex w-full min-w-0 bg-bg-secondary border-b border-border compact-touch [-webkit-touch-callout:none] ${
          multilineSwipe && multiline ? 'flex-wrap' : 'overflow-x-auto touch-pan-x'
        } ${className}`}
        style={{ scrollbarWidth: 'none' }}
        selectedCount={selected.size}
        dropMode={dropMode}
        dropActive={dropActive}
        onBackgroundPointerDown={onBackgroundPointerDown}
        showMenuSelectMode
        mode={selectionMode}
        onCancelSelection={() => {
          setSelected(new Set())
          setSelectionMode('normal')
        }}
        onModeChange={setSelectionMode}
      >
      {tabs.map((tab) => {
        const isActive = active === tab.id
        const isChecked = selected.has(tab.id)
        const isLocked = lockedIds.includes(tab.id)
        const tone = toneForView(tab.kind)
        const targets = selected.size > 0 ? Array.from(selected) : [tab.id]
        const allTargets = tabs.map((t) => t.id)
        const menu: MenuEntry[] = [
          {
            key: 'closeSplit',
            kind: 'split',
            segments: [
              { key: 'close', label: 'Close', onSelect: () => onClose(tab.id) },
              { key: 'selected', label: 'Selected', tint: 'yellow', disabled: selected.size === 0, onSelect: () => onCloseSelected?.(targets) },
              { key: 'all', label: 'All', onSelect: () => onCloseSelected?.(allTargets) },
            ],
          },
          {
            key: 'hideSplit',
            kind: 'split',
            segments: [
              { key: 'hide', label: 'Hide', onSelect: () => onHideSelected?.([tab.id]) },
              { key: 'hideSelected', label: 'Selected', tint: 'yellow', disabled: selected.size === 0, onSelect: () => onHideSelected?.(targets) },
              { key: 'hideAll', label: 'All', onSelect: () => onHideSelected?.(allTargets) },
            ],
          },
          {
            key: 'lockSplit',
            kind: 'split',
            segments: [
              { key: 'lock', label: 'Lock', disabled: !onToggleLock || isLocked, onSelect: () => onToggleLock?.([tab.id], true) },
              { key: 'lockSel', label: 'Selected', tint: 'yellow', disabled: !onToggleLock || selected.size === 0, onSelect: () => onToggleLock?.(targets, true) },
            ],
          },
          {
            key: 'unlockSplit',
            kind: 'split',
            segments: [
              { key: 'unlock', label: 'Unlock', disabled: !onToggleLock || !isLocked, onSelect: () => onToggleLock?.([tab.id], false) },
              { key: 'unlockSel', label: 'Selected', tint: 'yellow', disabled: !onToggleLock || selected.size === 0, onSelect: () => onToggleLock?.(targets, false) },
            ],
          },
          ...(onSetViewMode ? [{
            key: 'viewSplit',
            kind: 'split' as const,
            segments: [
              { key: 'view', label: 'View', onSelect: () => openFloatMenu(tab.id, 'current') },
              { key: 'viewSelected', label: 'Selected', tint: 'yellow' as const, disabled: selected.size === 0, onSelect: () => openFloatMenu(tab.id, 'selected') },
            ],
          }] : []),
          ...(onCopyLocation ? [{
            key: 'copySplit',
            kind: 'split' as const,
            segments: [
              { key: 'copy', label: 'Copy file path', onSelect: () => onCopyLocation([tab.id]) },
              { key: 'copySelected', label: 'Selected', tint: 'yellow' as const, disabled: selected.size === 0, onSelect: () => onCopyLocation(Array.from(selected)) },
            ],
          }] : []),
          { key: 'sep2', kind: 'separator' },
          { key: 'selectAll', label: 'Select all', onSelect: () => setSelected(new Set(allTargets)) },
          { key: 'closeAlsoLocked', label: 'Close also locked', onSelect: () => onCloseSelected?.(allTargets, true) },
        ]
        const Icon = tab.icon
        return (
          <Selectable
            key={tab.id}
            itemRef={(el) => { tabRefs.current[tab.id] = el }}
            checked={isChecked}
            locked={isLocked}
            onToggle={() => toggle(tab.id)}
            onActivate={() => {
              anchorRef.current = tab.id
              onActivate(tab.id)
            }}
            onShiftClick={() => selectRange(tab.id)}
            onMiddleClick={() => onClose(tab.id)}
            menu={menu}
            label={`Select ${tab.ariaLabel ?? tab.label ?? tab.kind}`}
            tone={tone}
            dragId={tab.id}
            className={`flex items-center ${rowGap} ${rowPad} ${rowHeight} ${rowMin} border-r border-border shrink-0 select-none cursor-pointer transition-colors ${TONE_WEAK[tone]} ${
              isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {isActive && (
              <span className={`absolute bottom-0 left-0 right-0 ${lineHeight} z-10`}
                style={{ backgroundColor: `color-mix(in srgb, var(${TONE_VAR[tone]}) 50%, transparent)` }} />
            )}
            {tab.kind !== 'code' && <Icon className={`${iconSize} shrink-0`} />}
            {tab.label && <span className={`${textSize} truncate ${textMax} font-medium leading-none`}>{tab.label}</span>}
            {isLocked && <Lock className={`${small ? 'w-2 h-2' : 'w-2.5 h-2.5'} shrink-0 text-red`} />}
          </Selectable>
        )
      })}

      {floatMenu && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={(e) => { if (e.button === 0) setFloatMenu(null) }} />
          <div className="fixed z-50 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[190px]"
            style={{ left: floatMenu.x, top: floatMenu.y }}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <Unlock className="w-3 h-3" />
              View mode — {floatMenu.target === 'selected' ? 'all selected' : 'current'}
            </div>
            {VIEW_MODES.map((m) => (
              <button key={m.key}
                onClick={() => {
                  const ids = floatMenu.target === 'selected'
                    ? (selected.size > 0 ? Array.from(selected) : [floatMenu.id])
                    : [floatMenu.id]
                  onSetViewMode?.(ids, m.key)
                  setFloatMenu(null)
                }}
                className="flex items-center gap-2 w-full min-h-[36px] px-3 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors">
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
      </SelectableGroup>
    </div>
  )
}
