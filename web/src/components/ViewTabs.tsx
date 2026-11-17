import type { LucideIcon } from 'lucide-react'
import type { ViewMode } from '../lib/viewTypes'
import Tabbed from './Tabbed'

// ViewTab is the menu row description (one per type).
export interface ViewTab {
  kind: string
  label: string
  icon: LucideIcon
}

// ShellTabItem is one flat tab in the container. Many tabs can share a kind
// (each file, web view, API client and terminal is its own tab).
export interface ShellTabItem {
  id: string
  kind: string
  label: string
  icon: LucideIcon
}

export interface ViewTabsProps {
  tabs: ShellTabItem[]
  active: string
  lockedIds?: string[]
  dropActive?: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseSelected: (ids: string[], includeLocked?: boolean) => void
  onToggleLock?: (ids: string[], locked: boolean) => void
  onSetViewMode?: (ids: string[], mode: ViewMode) => void
  onReorder?: (from: string, to: string) => void
  onDragDetach?: (id: string) => void
  onDragAway?: (id: string, at: { x: number; y: number }) => void
  onDropViewMode?: (id: string, mode: string, nearId?: string, after?: boolean) => void
  onDragCancelViewMode?: () => void
  onCopyLocation?: (ids: string[]) => void
}

// ViewTabs is the main center tab strip. It is the same Tabbed component used
// by the dock areas, at normal size and with multiline swipe support.
export default function ViewTabs({ tabs, active, lockedIds, dropActive = false, onSelect, onClose, onCloseSelected, onToggleLock, onSetViewMode, onReorder, onDragDetach, onDragAway, onDropViewMode, onDragCancelViewMode, onCopyLocation }: ViewTabsProps) {
  return (
    <Tabbed
      tabs={tabs}
      active={active}
      lockedIds={lockedIds}
      size="normal"
      multilineSwipe
      dropMode="center"
      dropActive={dropActive}
      onActivate={onSelect}
      onClose={onClose}
      onCloseSelected={onCloseSelected}
      onToggleLock={onToggleLock}
      onSetViewMode={onSetViewMode}
      onReorder={onReorder}
      onDragAway={onDragAway ?? ((id) => onClose(id))}
      onDragDetach={onDragDetach}
      onDropViewMode={onDropViewMode}
      onDragCancelViewMode={onDragCancelViewMode}
      onCopyLocation={onCopyLocation}
    />
  )
}
