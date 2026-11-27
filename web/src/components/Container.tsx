// Container — renders a recursive layout container.
// Each container has tabs and optional attached containers (left/right/bottom).
// The main container (main=true) fills the entire IDE area.
// Nested containers are docked to their parent's side.

import { useMemo, type ReactNode } from 'react'
import { Files, GitBranch, TerminalSquare, Globe, Settings as SettingsIcon,
  Search as SearchIcon, HelpCircle, Menu, Code2, Webhook, ScrollText,
  MessageSquare, Users } from 'lucide-react'
import Tabbed from './Tabbed'
import type { LayoutContainer, LayoutTab } from '../hooks/useTabSession'
import type { Tab } from '../types'

export interface ContainerProps {
  main: boolean
  container: LayoutContainer
  tabs: Tab[]
  activeTab: string | null
  visible: Record<string, boolean>
  workspaceId: string | null
  onSelect: (id: string) => void
  children?: ReactNode
}

// Map layout tab type to icon
function iconForType(type: string) {
  switch (type) {
    case 'files': return Files
    case 'search': return SearchIcon
    case 'code': return Code2
    case 'term': return TerminalSquare
    case 'web': return Globe
    case 'git': return GitBranch
    case 'api': return Webhook
    case 'log': return ScrollText
    case 'settings': return SettingsIcon
    case 'help': return HelpCircle
    case 'chat': return MessageSquare
    case 'session-tabs': return Users
    default: return Code2
  }
}

// Map layout tab to a tab entry for the Tabbed component
function layoutTabToEntry(lt: LayoutTab, workspaceId: string | null) {
  const Icon = iconForType(lt.type)
  if (lt.type === 'file') {
    const path = workspaceId ? `${workspaceId}\0${lt.name}` : lt.name
    return { id: `file:${path}`, kind: 'code', title: lt.name, label: lt.name, icon: Icon, filePath: path }
  }
  if (lt.type === 'term') {
    return { id: lt.name, kind: 'terminals', title: lt.name, label: lt.name, icon: TerminalSquare, termId: Number(lt.name.split('-')[1]) }
  }
  if (lt.type === 'files') {
    return { id: lt.name, kind: 'files', title: `Files`, label: `Files`, icon: Files, fileId: Number(lt.name.split(':')[1]) }
  }
  // View tabs
  const kind = lt.type as string
  return { id: `view:${kind}`, kind, title: lt.name, label: lt.name, icon: Icon }
}

export default function Container({ main, container, tabs, activeTab, visible, workspaceId }: ContainerProps) {
  // Build tab entries from the container's layout tabs
  const tabEntries = useMemo(() => {
    const entries = []
    for (const lt of container.tabs) {
      const entry = layoutTabToEntry(lt, workspaceId)
      entries.push(entry)
    }
    return entries
  }, [container.tabs, workspaceId])

  // Find selected tab from container's selected_tab
  const selectedEntry = useMemo(() => {
    if (!container.selected_tab) return null
    const lt = container.tabs.find(t => t.id === container.selected_tab)
    if (!lt) return null
    return layoutTabToEntry(lt, workspaceId)
  }, [container.tabs, container.selected_tab, workspaceId])

  const selectedId = selectedEntry?.id || null

  // Render attached containers
  const leftContainer = container.attached?.left?.container
  const rightContainer = container.attached?.right?.container
  const bottomContainer = container.attached?.bottom?.container

  return (
    <div className={`flex flex-col ${main ? 'flex-1 min-h-0' : ''}`}>
      {/* Tab strip */}
      {tabEntries.length > 0 && (
        <Tabbed
          tabs={tabEntries}
          active={selectedId ?? ''}
          onActivate={() => {}}
          onClose={() => {}}
          onReorder={() => {}}
          onDragDetach={() => {}}
          onDragAway={() => {}}
          onDropViewMode={() => {}}
          onDragCancelViewMode={() => {}}
        />
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 flex">
        {/* Left dock */}
        {leftContainer && (
          <>
            <div
              className="min-w-[180px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary"
              style={{ width: `${container.attached?.left?.width || 32}%` }}>
              <Container main={false} container={leftContainer} tabs={tabs} activeTab={activeTab} visible={visible} workspaceId={workspaceId} onSelect={() => {}} />
            </div>
            <div className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors touch-none" />
          </>
        )}

        {/* Center area - render active tab */}
        <div className="flex-1 min-w-0 min-h-0 relative bg-bg-primary">
          {selectedEntry && (
            <div className="absolute inset-0 flex flex-col">
              {/* Render the actual tab content based on kind */}
              {selectedEntry.kind === 'files' && <div>File Explorer</div>}
              {selectedEntry.kind === 'code' && <div>Editor: {selectedEntry.title}</div>}
              {selectedEntry.kind === 'terminals' && <div>Terminal: {selectedEntry.title}</div>}
              {selectedEntry.kind === 'settings' && <div>Settings</div>}
              {selectedEntry.kind === 'git' && <div>Git</div>}
              {selectedEntry.kind === 'help' && <div>Help</div>}
              {selectedEntry.kind === 'chat' && <div>Chat</div>}
              {selectedEntry.kind === 'session-tabs' && <div>Session Tabs</div>}
              {selectedEntry.kind === 'search' && <div>Search</div>}
              {selectedEntry.kind === 'api' && <div>API</div>}
              {selectedEntry.kind === 'log' && <div>Log</div>}
            </div>
          )}
        </div>

        {/* Right dock */}
        {rightContainer && (
          <>
            <div className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors touch-none" />
            <div
              className="min-w-[180px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary"
              style={{ width: `${container.attached?.right?.width || 32}%` }}>
              <Container main={false} container={rightContainer} tabs={tabs} activeTab={activeTab} visible={visible} workspaceId={workspaceId} onSelect={() => {}} />
            </div>
          </>
        )}
      </div>

      {/* Bottom dock */}
      {bottomContainer && (
        <>
          <div className="h-1 shrink-0 cursor-row-resize bg-border hover:bg-accent transition-colors touch-none" />
          <div
            className="min-h-[100px] max-h-[70%] shrink-0 flex flex-col bg-bg-primary"
            style={{ height: `${container.attached?.bottom?.height || 30}%` }}>
            <Container main={false} container={bottomContainer} tabs={tabs} activeTab={activeTab} visible={visible} workspaceId={workspaceId} onSelect={() => {}} />
          </div>
        </>
      )}
    </div>
  )
}
