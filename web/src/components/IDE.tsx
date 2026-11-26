import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Files, GitBranch, TerminalSquare, Save, FolderOpen,
  Globe, Settings as SettingsIcon, ChevronLeft, Search as SearchIcon,
  MessageSquare, Webhook, ScrollText, Boxes,
  HelpCircle, Menu, Code2, Minimize2, GripVertical, Radio, Users,
} from 'lucide-react'
import { useMobile } from '../hooks/useMobile'
import { useDesktopMode } from '../hooks/useDesktopMode'
import { useUiScale } from '../hooks/useUiScale'
import { useTheme } from '../hooks/useTheme'
import type { ViewMode } from '../lib/viewTypes'
import Logo from './Logo'
import FileExplorer from './FileExplorer'
import Editor, { type CursorPos } from './Editor'
import TerminalPanel from './TerminalPanel'
import GitPanels from './GitPanels'
import Browser from './Browser'
import Settings from './Settings'
import HelpView from './HelpView'
import SearchPanel from './SearchPanel'
import CommandPalette from './CommandPalette'
import QuickOpen from './QuickOpen'
import Breadcrumbs from './Breadcrumbs'
import MarkdownPreview from './MarkdownPreview'
import { ImagePreview, BinaryNotice } from './ImagePreview'
import { PdfPreview, VideoPreview } from './MediaPreview'
import { useLSP } from '../hooks/useLSP'
import { useCollab } from '../hooks/useCollab'
import { useYDoc } from '../hooks/useYDoc'
import Chat from './Chat'
import ApiClient from './ApiClient'
import { ApiInstance } from './ApiView'
import LogView from './LogView'
import { useApiClient } from '../hooks/useApiClient'
import GitGraphView from './GitGraphView'
import FloatingTerminals from './FloatingTerminals'
import RemoteCursors from './RemoteCursors'
import ViewTabs, { type ViewTab } from './ViewTabs'
import Tabbed from './Tabbed'
import { formatTabLocation } from '../lib/tabPath'
import ViewMenu from './ViewMenu'
import ChooseWorkspaceAndTabSession from './ChooseWorkspaceAndTabSession'
import SessionTabs from './SessionTabs'
import { navigateToSession, type SessionChoice } from '../lib/sessionNav'
import { useTerminals } from '../hooks/useTerminals'
import { useDap } from '../hooks/useDap'
import { basePath, workspaceUrl, rawFileUrl } from '../api'
import { fileKey, parseFileKey, normalizeTabIdentity } from '../lib/fileKey'
import { followTargetFromPeer, targetSelectionKey } from '../lib/followSelection'
import { decodeCollabPointer, encodeCollabPointer } from '../lib/collabPointerDom'
import { elementScale } from '../lib/uiScale'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useTabSession, type LayoutRoot, type LayoutContainer, type LayoutTab } from '../hooks/useTabSession'
import { logLayoutSave, logLayoutRestore, logInitPath, logInitRestore, logCursorMove, logDragDrop } from '../lib/clientLog'
import type { AuthFetch, Tab, FileEntry, EditorSettings, Task, ExplorerActions, EditorActions, DapAvailableInfo, CollabPointer } from '../types'

// colorFromName derives a stable per-user color for collaboration cursors.
const COLLAB_PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6']
function colorFromName(name: string | null | undefined): string {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + (name as string).charCodeAt(i)) | 0
  return COLLAB_PALETTE[Math.abs(h) % COLLAB_PALETTE.length]
}

let browserIdCounter = 0

// File/code tabs are the ones that can be hidden. Special tabs (web, git
// graph, API) use their own view-kind visibility instead.
function isFileTab(t: Tab): boolean {
  return !t.type || t.type === 'gitgraph'
}

export interface IDEProps {
  token: string
  authFetch: AuthFetch
  onLogout: () => void
  workspace: string | null
  home: string | null
  allowCustomDirectory: boolean
  workspacesApi: ReturnType<typeof useWorkspaces>
  workspaceId: string | null
  username: string
  onUsernameChange: (name: string) => void
  role: string
  guest?: boolean
  teacher?: boolean
  rrControlMode?: string | null
  debug?: boolean
  collabContext?: string | null
  tabViewState?: string | null
}

export type MenuPlacement =
  | 'left-icons'
  | 'left-icons-and-text'
  | 'bottom-icons'
  | 'left-of-tabs'
  | 'right-of-tabs'

export interface ContainerInfo {
  id: number
  visible: boolean
  // Show the container's own `Cont N` tab in a dock strip so the whole
  // container can be grabbed and moved.
  ownTab?: boolean
}

type ViewKind = 'files' | 'search' | 'code' | 'web' | 'git' | 'api' | 'settings' | 'log' | 'help' | 'terminals' | 'chat' | 'session-tabs' | 'rrcontrol'

// The layout a fresh install starts with (and what "Reset view" restores).
const DEFAULT_VISIBLE: Record<ViewKind, boolean> = {
  files: true, search: false, code: true, web: false, git: false, api: false,
  settings: false, log: false, help: false, terminals: false, chat: false,
  'session-tabs': false, rrcontrol: false,
}

// Geometry of a `float` tab: it stays on top of the main container and is moved
// by dragging its title bar.
interface FloatGeom {
  x: number
  y: number
  w: number
  h: number
  z: number
}

// Single source of truth for all IDE layout state.
// One setState call restores everything from the server — no race conditions.
interface WorkspaceLayout {
  tabs: Tab[]
  activeTab: string | null
  visible: Record<ViewKind, boolean>
  tabOrder: string[]
  fileIds: number[]
  activeFileId: number
  activeShell: string
  menuPlacement: MenuPlacement
  containers: ContainerInfo[]
  containerOf: Record<string, string>
  containerActive: Record<number, string>
  lockedShells: string[]
  viewModes: Record<string, ViewMode>
  floatGeom: Record<string, FloatGeom>
  dockSizes: { left: number; right: number; bottom: number }
  tabContentStates: Record<string, { line: number; col: number }>
  apiIds: number[]
  activeApiId: number
  searchIds: number[]
  activeSearchId: number
  logIds: number[]
  activeLogId: number
}

function makeDefaultLayout(desktopMode: boolean): WorkspaceLayout {
  return {
    tabs: [],
    activeTab: null,
    visible: { ...DEFAULT_VISIBLE },
    tabOrder: [],
    fileIds: [1],
    activeFileId: 1,
    activeShell: 'files:1',
    menuPlacement: desktopMode ? 'left-icons-and-text' : 'left-of-tabs',
    containers: [{ id: 1, visible: false }],
    containerOf: {},
    containerActive: {},
    lockedShells: [],
    viewModes: {},
    floatGeom: {},
    dockSizes: { left: 32, right: 32, bottom: 30 },
    tabContentStates: {},
    apiIds: [],
    activeApiId: 0,
    searchIds: [],
    activeSearchId: 0,
    logIds: [],
    activeLogId: 0,
  }
}

interface FloatWindowProps {
  geom: FloatGeom
  onChange: (g: FloatGeom) => void
  onRaise: () => void
  children: ReactNode
  disabled?: boolean // when true, ignore pointer events (e.g. during mode drag)
}

function FloatWindow({ geom, onChange, onRaise, children, disabled = false }: FloatWindowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number; rect: DOMRect; scaleX: number; scaleY: number } | null>(null)

  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-reorder-id]') || !target.closest('[data-reorder-group]')) return
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return
    e.preventDefault()
    e.stopPropagation()
    const rect = parent.getBoundingClientRect()
    const scaleX = elementScale(el, 'x')
    const scaleY = elementScale(el, 'y')
    drag.current = {
      dx: (e.clientX - rect.left) / scaleX - geom.x,
      dy: (e.clientY - rect.top) / scaleY - geom.y,
      rect, scaleX, scaleY,
    }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const layoutW = d.rect.width / d.scaleX
      const layoutH = d.rect.height / d.scaleY
      const maxX = Math.max(0, layoutW - Math.min(geom.w, layoutW))
      const maxY = Math.max(0, layoutH - 40 / d.scaleY)
      onChange({
        ...geom,
        x: Math.max(0, Math.min((ev.clientX - d.rect.left) / d.scaleX - d.dx, maxX)),
        y: Math.max(0, Math.min((ev.clientY - d.rect.top) / d.scaleY - d.dy, maxY)),
      })
    }
    const up = () => {
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const handlePointerDown = (e: ReactPointerEvent) => {
    onRaise()
    startDrag(e)
  }

  const startResize = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    const el = ref.current
    const parent = el?.parentElement
    if (!el || !parent) return
    e.preventDefault()
    e.stopPropagation()
    onRaise()
    const sx = e.clientX
    const sy = e.clientY
    const startW = geom.w
    const startH = geom.h
    const rect = parent.getBoundingClientRect()
    const scaleX = elementScale(el, 'x')
    const scaleY = elementScale(el, 'y')
    const layoutW = rect.width / scaleX
    const layoutH = rect.height / scaleY
    const move = (ev: PointerEvent) => {
      const w = Math.max(260 / scaleX, Math.min(startW + (ev.clientX - sx) / scaleX, layoutW - geom.x))
      const h = Math.max(160 / scaleY, Math.min(startH + (ev.clientY - sy) / scaleY, layoutH - geom.y))
      onChange({ ...geom, w, h })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      ref={ref}
      data-float
      onPointerDown={handlePointerDown}
      style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: geom.z, maxWidth: 'calc(100% - 16px)', maxHeight: 'calc(100% - 16px)', pointerEvents: disabled ? 'none' : 'auto' }}
      className="absolute flex flex-col rounded-lg border border-border shadow-2xl overflow-hidden bg-bg-primary"
    >
      <div className="flex-1 min-h-0">{children}</div>
      <div
        onPointerDown={startResize}
        className="absolute bottom-0 right-0 z-10 w-4 h-4 cursor-nwse-resize touch-none"
        title="Resize">
        <svg viewBox="0 0 16 16" className="w-4 h-4 text-text-muted/70" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M6 14 L14 6 M10 14 L14 10" />
        </svg>
      </div>
    </div>
  )
}

interface FileReadResponse {
  content?: string
  fileType?: 'image' | 'binary' | 'pdf' | 'video'
  dataUrl?: string
  size?: number
}

export default function IDE({ token, authFetch, onLogout, workspace, home, allowCustomDirectory, workspacesApi, workspaceId, username, onUsernameChange, role, guest = false, teacher = false, rrControlMode = null, debug = false, collabContext = null, tabViewState = null }: IDEProps) {
  const isMobile = useMobile()
  const { desktopMode, setDesktopMode } = useDesktopMode()
  const { scale: uiScale, orientation: uiOrientation, active: activeUiScale, isSet: uiScaleIsSet, enabled: uiScaleEnabled, setEnabled: setUiScaleEnabled, updateScale: updateUiScale } = useUiScale()
  const { isDark, toggle: toggleTheme } = useTheme()
  const rrControlEnabled = rrControlMode !== null && rrControlMode !== 'off'

  // Single state object — the only source of truth for all IDE layout.
  // One setState call restores everything from the server, no race conditions.
  const [layout, setLayout] = useState<WorkspaceLayout>(() => makeDefaultLayout(desktopMode))
  const { tabs, activeTab, visible, tabOrder, fileIds, activeFileId, activeShell,
    menuPlacement, containers, containerOf, containerActive, lockedShells,
    viewModes, floatGeom, dockSizes, tabContentStates,
    apiIds, activeApiId, searchIds, activeSearchId, logIds, activeLogId } = layout

  const tabSession = useTabSession({ workspaceId, authFetch, username, collabContext, tabViewState })
  const { saveLayout: saveLayoutToServer, stopSaving } = tabSession

  // Workspace/session chooser modal. showCancel is only set when there is a
  // previous selection to return to (i.e. a switch, not an initial pick).
  const [sessionPicker, setSessionPicker] = useState<{ showCancel: boolean } | null>(null)
  const [kicked, setKicked] = useState(false)
  const openSessionPicker = useCallback((showCancel = false) => setSessionPicker({ showCancel }), [])

  // Another device took this tab view state over (or it was removed). Stop the
  // delayed layout saves immediately and force a new choice; otherwise this tab
  // would overwrite the new owner's layout.
  const handleKicked = useCallback(() => {
    stopSaving()
    setKicked(true)
    openSessionPicker(false)
  }, [stopSaving, openSessionPicker])

  // Collaboration presence + layout init.
  // The WebSocket is the single path: connects → server sends init packet → layout set once.
  // The initReceived gate prevents the save effect from running before init arrives.
  const [initReceived, setInitReceived] = useState(false)
  const { selfId, roster: collabRoster, presenter, visibleTabTypes, startLead, stopLead, setViewing: setCollabViewing, setTabs: setCollabTabs, pointers: collabPointers, sendPointer, sendWindow, onWindow, sendTerminals, onTerminals, setPushTabs } = useCollab(workspaceId, token, username, tabSession.name, collabContext, handleKicked, (data) => {
    // Server always sends init. For existing sessions: data contains the saved layout.
    // For new sessions: data is null, client uses default layout.

    // New session — no saved layout, use defaults
    if (data == null) {
      if (debug) logInitPath('new-session')
      setInitReceived(true)
      return
    }

    // Existing session — restore saved layout
    const raw = data as any
    const l = (raw?.data && typeof raw.data === 'object' && 'layout' in raw.data) ? raw.data : raw
    if (!l || !l.layout || !l.layout.main) {
      return
    }

    if (debug) {
      logLayoutRestore('initialize', true)
      logInitPath('restore-from-server')
    }

    // Mark init as received so the save effect can proceed after this callback completes
    setInitReceived(true)

    let nextCid = 1
    const restoredContainers: Array<{ id: number; visible: boolean; ownTab?: boolean }> = []
    const restoredContainerOf: Record<string, string> = {}
    const restoredContainerActive: Record<number, string> = {}
    const restoredViewModes: Record<string, ViewMode> = {}
    const restoredFloatGeom: Record<string, FloatGeom> = {}

    // Map layout tab names to entry IDs for containerOf lookups.
    // Must match the IDs generated by the entries memo.
    function tabEntryId(lt: { type?: string; name: string }): string {
      if (lt.type === 'files') return lt.name
      if (lt.type === 'search') return lt.name
      if (lt.type === 'api') return lt.name
      if (lt.type === 'log') return lt.name
      // Terminal tabs: name is "term-1", entry ID is "term:1" to match entries memo
      if (lt.type === 'term') {
        const num = lt.name.replace('term-', '')
        return `term:${num}`
      }
      if (lt.type === 'web') return lt.name
      // View tabs: name is the kind, entry ID is "view:kind"
      if (lt.type === 'settings' || lt.type === 'git' || lt.type === 'help' || lt.type === 'rrcontrol' ||
          lt.type === 'chat' || lt.type === 'session-tabs' || lt.type === 'code') {
        return `view:${lt.name}`
      }
      // File tabs: entry ID is "file:<fileKey>" to match the entries memo
      return `file:${fileKey(workspaceId, lt.name)}`
    }

    // Restore attached/nested containers (left/bottom/right docks).
    // The main container's tabs are root entries — no container wrapper needed.
    function restoreAttached(container: LayoutContainer): void {
      if (container.attached) {
        if (container.attached.left) {
          const cid = nextCid++
          restoredContainers.push({ id: cid, visible: true, ownTab: true })
          restoredViewModes[`container:${cid}`] = 'docked-left'
          for (const lt of container.attached.left.container.tabs) {
            restoredContainerOf[tabEntryId(lt)] = `container:${cid}`
          }
          const leftC = container.attached!.left!.container
          if (leftC.selected_tab) {
            const sel = leftC.tabs.find((t: LayoutTab) => t.id === leftC.selected_tab)
            if (sel) restoredContainerActive[cid] = tabEntryId(sel)
            else if (leftC.tabs.length > 0) restoredContainerActive[cid] = tabEntryId(leftC.tabs[0])
          }
          restoreAttached(container.attached.left.container)
        }
        if (container.attached.right) {
          const cid = nextCid++
          restoredContainers.push({ id: cid, visible: true, ownTab: true })
          restoredViewModes[`container:${cid}`] = 'docked-right'
          for (const lt of container.attached.right.container.tabs) {
            restoredContainerOf[tabEntryId(lt)] = `container:${cid}`
          }
          const rightC = container.attached!.right!.container
          if (rightC.selected_tab) {
            const sel = rightC.tabs.find((t: LayoutTab) => t.id === rightC.selected_tab)
            if (sel) restoredContainerActive[cid] = tabEntryId(sel)
            else if (rightC.tabs.length > 0) restoredContainerActive[cid] = tabEntryId(rightC.tabs[0])
          }
          restoreAttached(container.attached.right.container)
        }
        if (container.attached.bottom) {
          const cid = nextCid++
          restoredContainers.push({ id: cid, visible: true, ownTab: true })
          restoredViewModes[`container:${cid}`] = 'docked-bottom'
          for (const lt of container.attached.bottom.container.tabs) {
            restoredContainerOf[tabEntryId(lt)] = `container:${cid}`
          }
          const bottomC = container.attached!.bottom!.container
          if (bottomC.selected_tab) {
            const sel = bottomC.tabs.find((t: LayoutTab) => t.id === bottomC.selected_tab)
            if (sel) restoredContainerActive[cid] = tabEntryId(sel)
            else if (bottomC.tabs.length > 0) restoredContainerActive[cid] = tabEntryId(bottomC.tabs[0])
          }
          restoreAttached(container.attached.bottom.container)
        }
      }
    }
    restoreAttached(l.layout.main)

    if (l.layout.floating) {
      for (const fw of l.layout.floating) {
        const cid = nextCid++
        restoredContainers.push({ id: cid, visible: true, ownTab: true })
        restoredViewModes[`container:${cid}`] = 'float'
        restoredFloatGeom[`container:${cid}`] = { x: fw.left, y: fw.top, w: fw.width, h: fw.height, z: 30 }
        for (const lt of fw.container.tabs) {
          const entryId = tabEntryId(lt)
          restoredContainerOf[entryId] = `container:${cid}`
        }
        if (fw.container.selected_tab) {
          const sel = fw.container.tabs.find((t: LayoutTab) => t.id === fw.container.selected_tab)
          if (sel) restoredContainerActive[cid] = tabEntryId(sel)
          else if (fw.container.tabs.length > 0) restoredContainerActive[cid] = tabEntryId(fw.container.tabs[0])
        } else if (fw.container.tabs.length > 0) {
          restoredContainerActive[cid] = tabEntryId(fw.container.tabs[0])
        }
        function flattenFloatContainer(container: LayoutContainer, parentCid: number): number {
          const childCid = nextCid++
          restoredContainers.push({ id: childCid, visible: true, ownTab: true })
          for (const lt of container.tabs) {
            const entryId = tabEntryId(lt)
            restoredContainerOf[entryId] = `container:${childCid}`
          }
          if (container.selected_tab) {
            const sel = container.tabs.find((t) => t.id === container.selected_tab)
            if (sel) restoredContainerActive[childCid] = tabEntryId(sel)
            else if (container.tabs.length > 0) restoredContainerActive[childCid] = tabEntryId(container.tabs[0])
          } else if (container.tabs.length > 0) {
            restoredContainerActive[childCid] = tabEntryId(container.tabs[0])
          }
          if (container.attached) {
            if (container.attached.left) {
              const gc = flattenFloatContainer(container.attached.left.container, childCid)
              restoredViewModes[`container:${gc}`] = 'docked-left'
              restoredContainerOf[`container:${gc}`] = `container:${childCid}`
            }
            if (container.attached.right) {
              const gc = flattenFloatContainer(container.attached.right.container, childCid)
              restoredViewModes[`container:${gc}`] = 'docked-right'
              restoredContainerOf[`container:${gc}`] = `container:${childCid}`
            }
            if (container.attached.bottom) {
              const gc = flattenFloatContainer(container.attached.bottom.container, childCid)
              restoredViewModes[`container:${gc}`] = 'docked-bottom'
              restoredContainerOf[`container:${gc}`] = `container:${childCid}`
            }
          }
          return childCid
        }
        if (fw.container.attached) {
          if (fw.container.attached.left) flattenFloatContainer(fw.container.attached.left.container, cid)
          if (fw.container.attached.right) flattenFloatContainer(fw.container.attached.right.container, cid)
          if (fw.container.attached.bottom) flattenFloatContainer(fw.container.attached.bottom.container, cid)
        }
      }
    }

    containerIdRef.current = Math.max(containerIdRef.current, nextCid)

    // Collect file tabs and file IDs from the layout tree.
    // Terminal IDs are imported by useTerminals server reconciliation, not here.
    const restoredTabs: Tab[] = []
    const restoredFileIds: number[] = []
    function collectTabs(container: LayoutContainer) {
      for (const lt of container.tabs) {
        if (lt.type === 'files') {
          const match = lt.name.match(/^files:(\d+)$/)
          if (match) restoredFileIds.push(parseInt(match[1], 10))
          continue
        }
        if (lt.type === 'search' || lt.type === 'api' || lt.type === 'log' ||
            lt.type === 'term' || lt.type === 'settings' || lt.type === 'git' ||
            lt.type === 'help' || lt.type === 'chat' || lt.type === 'session-tabs' || lt.type === 'rrcontrol') continue
        const tab: Tab = { id: lt.id, path: fileKey(workspaceId, lt.name), name: lt.name, rel: lt.name, workspaceId }
        if (lt.type === 'browser') { tab.type = 'browser'; tab.url = lt.name }
        restoredTabs.push(tab)
      }
      if (container.attached) {
        if (container.attached.left) collectTabs(container.attached.left.container)
        if (container.attached.right) collectTabs(container.attached.right.container)
        if (container.attached.bottom) collectTabs(container.attached.bottom.container)
      }
    }
    collectTabs(l.layout.main)
    if (l.layout.floating) {
      for (const fw of l.layout.floating) collectTabs(fw.container)
    }

    if (restoredFileIds.length) {
      nextFileId.current = Math.max(nextFileId.current, ...restoredFileIds.map((id) => id + 1))
    }

    // Find the focused tab from focused_tab_id
    let focusedTabEntryId: string | null = null
    const layoutRoot = l.layout
    if (layoutRoot.focused_tab_id) {
      function findTabById(container: LayoutContainer) {
        for (const lt of container.tabs) {
          if (lt.id === layoutRoot.focused_tab_id) {
            focusedTabEntryId = tabEntryId(lt)
            return
          }
        }
        if (container.attached) {
          if (container.attached.left) findTabById(container.attached.left.container)
          if (container.attached.right) findTabById(container.attached.right.container)
          if (container.attached.bottom) findTabById(container.attached.bottom.container)
        }
      }
      findTabById(layoutRoot.main)
      if (layoutRoot.floating && !focusedTabEntryId) {
        for (const fw of layoutRoot.floating) findTabById(fw.container)
      }
    }

    // Derive activeTab from focused tab entry
    const restoredActiveTab = focusedTabEntryId ? focusedTabEntryId : null
    // Derive activeShell from focused tab entry
    const restoredActiveShell = focusedTabEntryId || ''

    if (debug) {
      logInitRestore({ tabs: restoredTabs.length, containers: restoredContainers.length, activeTab: restoredActiveTab })
    }
    setLayout(prev => ({
      ...prev,
      tabs: restoredTabs,
      activeTab: restoredActiveTab,
      visible: l.visible ? { ...DEFAULT_VISIBLE, ...(l.visible as Partial<Record<ViewKind, boolean>>) } : prev.visible,
      tabOrder: prev.tabOrder,
      fileIds: restoredFileIds.length ? restoredFileIds : prev.fileIds,
      activeFileId: restoredFileIds.length ? restoredFileIds[0] : prev.activeFileId,
      activeShell: restoredActiveShell,
      menuPlacement: prev.menuPlacement,
      containers: restoredContainers,
      containerOf: restoredContainerOf,
      containerActive: restoredContainerActive,
      lockedShells: prev.lockedShells,
      viewModes: restoredViewModes,
      floatGeom: restoredFloatGeom,
      dockSizes: prev.dockSizes,
      tabContentStates: l.tabContentStates ? (l.tabContentStates as Record<string, { line: number; col: number }>) : prev.tabContentStates,
    }))
  })

  const applySessionChoice = useCallback((choice: SessionChoice) => {
    navigateToSession(choice)
  }, [])

  // Built-in API client — shared between the sidebar collections and the editor tab.
  const apiClient = useApiClient(workspaceId, authFetch)

  // Terminal sessions — shared between the docked panel and the floating windows,
  // and synced across collaborators (list + window positions).
  const terminalsApi = useTerminals(authFetch, workspaceId, { sendTerminals, onTerminals })

  // ── Unified flat tabs ──
  // Every open thing is a sibling tab in one container: the explorer, search,
  // each file, each web view, git, each API client, settings, log, help, each
  // terminal, chat. The hamburger menu controls which types are visible; it is
  // the only place that adds instances (swipe right) or hides a type.
  const VIEW_TABS: ViewTab[] = [
    { kind: 'files', label: 'Files', icon: Files },
    { kind: 'search', label: 'Search', icon: SearchIcon },
    { kind: 'code', label: 'Code', icon: Code2 },
    { kind: 'terminals', label: 'Terminals', icon: TerminalSquare },
    { kind: 'web', label: 'Web', icon: Globe },
    { kind: 'git', label: 'Git', icon: GitBranch },
    { kind: 'api', label: 'API', icon: Webhook },
    { kind: 'log', label: 'Log', icon: ScrollText },
    { kind: 'help', label: 'Help', icon: HelpCircle },
    { kind: 'chat', label: 'Chat', icon: MessageSquare },
    { kind: 'session-tabs', label: 'Session tabs', icon: Users },
    { kind: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  // Helper refs for ID generation (not part of layout state)
  const nextFileId = useRef((fileIds[fileIds.length - 1] || 0) + 1)
  const containerIdRef = useRef(2)
  const floatZ = useRef(30)
  const [menuOpen, setMenuOpen] = useState(false)

  // Wrapper setters — each updates the single layout state object.
  // These replace the old individual setState calls throughout the component.
  const setTabs = useCallback((up: React.SetStateAction<Tab[]>) => setLayout(p => ({ ...p, tabs: typeof up === 'function' ? up(p.tabs) : up })), [])
  const setActiveTab = useCallback((up: React.SetStateAction<string | null>) => setLayout(p => ({ ...p, activeTab: typeof up === 'function' ? up(p.activeTab) : up })), [])
  const setVisible = useCallback((up: React.SetStateAction<Record<ViewKind, boolean>>) => setLayout(p => ({ ...p, visible: typeof up === 'function' ? up(p.visible) : up })), [])
  const setTabOrder = useCallback((up: React.SetStateAction<string[]>) => setLayout(p => ({ ...p, tabOrder: typeof up === 'function' ? up(p.tabOrder) : up })), [])
  const setFileIds = useCallback((up: React.SetStateAction<number[]>) => setLayout(p => ({ ...p, fileIds: typeof up === 'function' ? up(p.fileIds) : up })), [])
  const setActiveFileId = useCallback((up: React.SetStateAction<number>) => setLayout(p => ({ ...p, activeFileId: typeof up === 'function' ? up(p.activeFileId) : up })), [])
  const setActiveShell = useCallback((up: React.SetStateAction<string>) => setLayout(p => ({ ...p, activeShell: typeof up === 'function' ? up(p.activeShell) : up })), [])
  const setMenuPlacement = useCallback((up: React.SetStateAction<MenuPlacement>) => setLayout(p => ({ ...p, menuPlacement: typeof up === 'function' ? up(p.menuPlacement) : up })), [])
  const setContainers = useCallback((up: React.SetStateAction<ContainerInfo[]>) => setLayout(p => ({ ...p, containers: typeof up === 'function' ? up(p.containers) : up })), [])
  const setContainerOf = useCallback((up: React.SetStateAction<Record<string, string>>) => setLayout(p => ({ ...p, containerOf: typeof up === 'function' ? up(p.containerOf) : up })), [])
  const setContainerActive = useCallback((up: React.SetStateAction<Record<number, string>>) => setLayout(p => ({ ...p, containerActive: typeof up === 'function' ? up(p.containerActive) : up })), [])
  const setLockedShells = useCallback((up: React.SetStateAction<string[]>) => setLayout(p => ({ ...p, lockedShells: typeof up === 'function' ? up(p.lockedShells) : up })), [])
  const setViewModes = useCallback((up: React.SetStateAction<Record<string, ViewMode>>) => setLayout(p => ({ ...p, viewModes: typeof up === 'function' ? up(p.viewModes) : up })), [])
  const setFloatGeom = useCallback((up: React.SetStateAction<Record<string, FloatGeom>>) => setLayout(p => ({ ...p, floatGeom: typeof up === 'function' ? up(p.floatGeom) : up })), [])
  const setDockSizes = useCallback((up: React.SetStateAction<{ left: number; right: number; bottom: number }>) => setLayout(p => ({ ...p, dockSizes: typeof up === 'function' ? up(p.dockSizes) : up })), [])
  const setTabContentStates = useCallback((up: React.SetStateAction<Record<string, { line: number; col: number }>>) => setLayout(p => ({ ...p, tabContentStates: typeof up === 'function' ? up(p.tabContentStates) : up })), [])
  const setApiIds = useCallback((up: React.SetStateAction<number[]>) => setLayout(p => ({ ...p, apiIds: typeof up === 'function' ? up(p.apiIds) : up })), [])
  const setActiveApiId = useCallback((up: React.SetStateAction<number>) => setLayout(p => ({ ...p, activeApiId: typeof up === 'function' ? up(p.activeApiId) : up })), [])
  const setSearchIds = useCallback((up: React.SetStateAction<number[]>) => setLayout(p => ({ ...p, searchIds: typeof up === 'function' ? up(p.searchIds) : up })), [])
  const setActiveSearchId = useCallback((up: React.SetStateAction<number>) => setLayout(p => ({ ...p, activeSearchId: typeof up === 'function' ? up(p.activeSearchId) : up })), [])
  const setLogIds = useCallback((up: React.SetStateAction<number[]>) => setLayout(p => ({ ...p, logIds: typeof up === 'function' ? up(p.logIds) : up })), [])
  const setActiveLogId = useCallback((up: React.SetStateAction<number>) => setLayout(p => ({ ...p, activeLogId: typeof up === 'function' ? up(p.activeLogId) : up })), [])

  // Save layout to server on every change.
  // Waits for initReceived before the first save to avoid saving default state
  // before the WebSocket init message arrives.
  useEffect(() => {
    if (!initReceived) return // wait for WebSocket init message
    // Global tab ID counter — each tab gets a unique sequential ID
    let nextTabId = 1
    // Map entry ID -> assigned tab ID so we can find selected_tab / focused_tab_id
    const entryIdToTabId = new Map<string, number>()

    function assignTabId(entry: typeof entries[0]): number {
      const tabId = nextTabId++
      entryIdToTabId.set(entry.id, tabId)
      return tabId
    }

    // Convert flat state to recursive LayoutRoot tree
    function buildContainer(containerId: number): LayoutContainer {
      // Exclude container entries — they are structural, not tabs
      const childEntries = entries.filter((e) => containerOf[e.id] === `container:${containerId}` && e.kind !== 'container')
      const activeChild = containerActive[containerId]

      const layoutTabs: LayoutTab[] = childEntries.map((e) => {
        const tabId = assignTabId(e)
        if (e.filePath) return { id: tabId, type: 'file', name: e.filePath.split(String.fromCharCode(0))[1] }
        if (e.termId != null) return { id: tabId, type: 'term', name: `term-${e.termId}` }
        if (e.fileId != null) return { id: tabId, type: 'files', name: `files:${e.fileId}` }
        if (e.searchId != null) return { id: tabId, type: 'search', name: `search:${e.searchId}` }
        if (e.apiId != null) return { id: tabId, type: 'api', name: `api:${e.apiId}` }
        if (e.logId != null) return { id: tabId, type: 'log', name: `log:${e.logId}` }
        if (e.webPath) return { id: tabId, type: 'web', name: e.webPath }
        if (e.kind === 'settings') return { id: tabId, type: 'settings', name: 'settings' }
        if (e.kind === 'git') return { id: tabId, type: 'git', name: 'git' }
        if (e.kind === 'help') return { id: tabId, type: 'help', name: 'help' }
        if (e.kind === 'chat') return { id: tabId, type: 'chat', name: 'chat' }
        if (e.kind === 'session-tabs') return { id: tabId, type: 'session-tabs', name: 'session-tabs' }
        if (e.kind === 'rrcontrol') return { id: tabId, type: 'rrcontrol', name: 'rrcontrol' }
        if (e.kind === 'code') return { id: tabId, type: 'code', name: 'code' }
        return { id: tabId, type: e.kind || 'code', name: e.id }
      })

      const attached: LayoutContainer['attached'] = {}
      // Check for nested containers attached to this container
      const nestedContainers = containers.filter((c) => containerOf[`container:${c.id}`] === `container:${containerId}`)
      for (const nc of nestedContainers) {
        const mode = viewModes[`container:${nc.id}`]
        if (mode === 'docked-left') attached.left = { width: dockSizes.left, container: buildContainer(nc.id) }
        else if (mode === 'docked-right') attached.right = { width: dockSizes.right, container: buildContainer(nc.id) }
        else if (mode === 'docked-bottom') attached.bottom = { height: dockSizes.bottom, container: buildContainer(nc.id) }
      }

      // selected_tab: the entry active in this container
      const selectedTab = activeChild ? entryIdToTabId.get(activeChild) : undefined
      const result: LayoutContainer = { tabs: layoutTabs }
      if (selectedTab) result.selected_tab = selectedTab
      if (Object.keys(attached).length > 0) result.attached = attached
      return result
    }

    // Build main container (root entries with no parent container)
    // Exclude container entries — they are structural, not tabs
    const rootTabs: LayoutTab[] = rootEntries.filter((e) => e.kind !== 'container').map((e) => {
      const tabId = assignTabId(e)
      if (e.filePath) return { id: tabId, type: 'file', name: e.filePath.split(String.fromCharCode(0))[1] }
      if (e.termId != null) return { id: tabId, type: 'term', name: `term-${e.termId}` }
      if (e.fileId != null) return { id: tabId, type: 'files', name: `files:${e.fileId}` }
      if (e.kind === 'settings') return { id: tabId, type: 'settings', name: 'settings' }
      if (e.kind === 'git') return { id: tabId, type: 'git', name: 'git' }
      if (e.kind === 'help') return { id: tabId, type: 'help', name: 'help' }
      if (e.kind === 'chat') return { id: tabId, type: 'chat', name: 'chat' }
      if (e.kind === 'session-tabs') return { id: tabId, type: 'session-tabs', name: 'session-tabs' }
      if (e.kind === 'code') return { id: tabId, type: 'code', name: 'code' }
      return { id: tabId, type: e.kind || 'code', name: e.id }
    })
    const rootActiveEntry = rootEntries.filter((e) => e.kind !== 'container').find((e) => e.id === activeTab)
    const rootSelectedTab = rootActiveEntry ? entryIdToTabId.get(rootActiveEntry.id) : undefined
    const rootContainer: LayoutContainer = { tabs: rootTabs }
    if (rootSelectedTab) rootContainer.selected_tab = rootSelectedTab

    // Build attached sides for main container
    const mainAttached: LayoutContainer['attached'] = {}
    for (const c of containers) {
      const mode = viewModes[`container:${c.id}`]
      if (mode === 'docked-left' && !containerOf[`container:${c.id}`]) {
        mainAttached.left = { width: dockSizes.left, container: buildContainer(c.id) }
      } else if (mode === 'docked-right' && !containerOf[`container:${c.id}`]) {
        mainAttached.right = { width: dockSizes.right, container: buildContainer(c.id) }
      } else if (mode === 'docked-bottom' && !containerOf[`container:${c.id}`]) {
        mainAttached.bottom = { height: dockSizes.bottom, container: buildContainer(c.id) }
      }
    }
    if (Object.keys(mainAttached).length > 0) rootContainer.attached = mainAttached

    // Build floating windows — includes both floating containers and floating view tabs.
    // A floating view tab is wrapped in a minimal container for the LayoutRoot tree.
    const floating: Array<{ top: number; left: number; width: number; height: number; container: LayoutContainer }> = []
    for (const [key, mode] of Object.entries(viewModes)) {
      if (mode === 'float' && key.startsWith('container:')) {
        const cid = Number(key.slice('container:'.length))
        const geom = floatGeom[key]
        if (geom) {
          floating.push({
            top: geom.y,
            left: geom.x,
            width: geom.w,
            height: geom.h,
            container: buildContainer(cid)
          })
        }
      } else if (mode === 'float' && key.startsWith('view:')) {
        // Floating view tab — wrap in a minimal container
        const geom = floatGeom[key]
        if (geom) {
          const entry = entries.find((e) => e.id === key)
          if (entry) {
            const tabId = assignTabId(entry)
            let lt: LayoutTab
            if (entry.kind === 'session-tabs') lt = { id: tabId, type: 'session-tabs', name: 'session-tabs' }
            else if (entry.kind === 'settings') lt = { id: tabId, type: 'settings', name: 'settings' }
            else if (entry.kind === 'git') lt = { id: tabId, type: 'git', name: 'git' }
            else if (entry.kind === 'help') lt = { id: tabId, type: 'help', name: 'help' }
            else if (entry.kind === 'chat') lt = { id: tabId, type: 'chat', name: 'chat' }
            else lt = { id: tabId, type: entry.kind || 'code', name: entry.id }
            floating.push({
              top: geom.y,
              left: geom.x,
              width: geom.w,
              height: geom.h,
              container: { tabs: [lt], selected_tab: tabId }
            })
          }
        }
      }
    }

    const layoutRoot: LayoutRoot = { next_tab_id: nextTabId, main: rootContainer }
    if (floating.length > 0) layoutRoot.floating = floating
    // focused_tab_id: the globally focused tab across all containers
    const focusedEntry = entries.find((e) => e.id === activeTab)
    const focusedTabId = focusedEntry ? entryIdToTabId.get(focusedEntry.id) : undefined
    if (focusedTabId) layoutRoot.focused_tab_id = focusedTabId

    if (debug) {
      logLayoutSave('full', layoutRoot)
    }
    // Save only what the spec says: layout tree + visible + tabContentStates
    saveLayoutToServer({
      layout: layoutRoot,
      visible,
      tabContentStates,
    })
  }, [initReceived, tabs, activeTab, visible, tabOrder, fileIds, activeFileId, activeShell, menuPlacement, containers, containerOf, containerActive, lockedShells, viewModes, floatGeom, dockSizes, tabContentStates, saveLayoutToServer, debug])
  const [modeDrag, setModeDrag] = useState<string | null>(null)
  const [dockActive, setDockActive] = useState<{ left: string | null; right: string | null; bottom: string | null }>({ left: null, right: null, bottom: null })
  const [nestedDockActive, setNestedDockActive] = useState<Record<string, string>>({})
  const nextApiId = useRef(1)
  const nextSearchId = useRef(1)
  const nextLogId = useRef(1)
  // Debounce ref: prevents double-fire of onAdd from swipe gestures
  const addingViewRef = useRef<string | null>(null)

  const addWeb = useCallback((url = 'https://wede.vulos.org') => {
    const id = `browser:${++browserIdCounter}`
    setLayout(prev => ({
      ...prev,
      tabs: [...prev.tabs, { path: id, name: urlToName(url), type: 'browser', url, content: '', originalContent: '', modified: false }],
      visible: { ...prev.visible, web: true },
      activeTab: id,
      activeShell: `web:${id}`,
    }))
    return id
  }, [])

  const addFiles = useCallback(() => {
    const id = nextFileId.current++
    setLayout(prev => ({
      ...prev,
      fileIds: [...prev.fileIds, id],
      activeFileId: id,
      visible: { ...prev.visible, files: true },
      activeShell: `files:${id}`,
    }))
    return id
  }, [])

  const addApi = useCallback(() => {
    const id = nextApiId.current++
    setLayout(prev => ({
      ...prev,
      apiIds: [...prev.apiIds, id],
      activeApiId: id,
      visible: { ...prev.visible, api: true },
      activeShell: `api:${id}`,
    }))
    return id
  }, [])

  const addSearch = useCallback(() => {
    const id = nextSearchId.current++
    setLayout(prev => ({
      ...prev,
      searchIds: [...prev.searchIds, id],
      activeSearchId: id,
      visible: { ...prev.visible, search: true },
      activeShell: `search:${id}`,
    }))
    return id
  }, [])

  const addLog = useCallback(() => {
    const id = nextLogId.current++
    setLayout(prev => ({
      ...prev,
      logIds: [...prev.logIds, id],
      activeLogId: id,
      visible: { ...prev.visible, log: true },
      activeShell: `log:${id}`,
    }))
    return id
  }, [])

  const addTerminalTab = useCallback(async () => {
    const id = await terminalsApi.addTerminal()
    setLayout(prev => ({
      ...prev,
      visible: { ...prev.visible, terminals: true },
      activeShell: `term:${id}`,
    }))
    return id
  }, [terminalsApi])

  // Single-instance view tabs: settings, session-tabs, git, help, chat.
  // When enabling, check if already in the layout; if not, add to main container.
  // When disabling, just hide — location is preserved.
  const SINGLE_INSTANCE_TABS = new Set(['settings', 'session-tabs', 'git', 'help', 'chat'])
  const addSingleTab = useCallback((kind: ViewKind) => {
    setLayout(prev => {
      const entryId = `view:${kind}`
      // Already visible — just activate
      if (prev.visible[kind]) {
        return { ...prev, activeShell: entryId }
      }
      // Check if already placed somewhere in the layout (in a container or as root)
      const inLayout = prev.containerOf[entryId] !== undefined
      // If not in layout, it will be added as a root entry when visible is true
      // (the entries memo pushes it, and rootEntries picks it up)
      return { ...prev, visible: { ...prev.visible, [kind]: true }, activeShell: inLayout ? entryId : entryId }
    })
  }, [])

  const toggleVisible = useCallback((kind: ViewKind) => {
    setLayout(prev => {
      const noInstances =
        (kind === 'files' && prev.fileIds.length === 0) ||
        (kind === 'web' && !prev.tabs.some((t) => t.type === 'browser')) ||
        (kind === 'api' && prev.apiIds.length === 0) ||
        (kind === 'terminals' && terminalsApi.terminals.length === 0) ||
        (kind === 'search' && prev.searchIds.length === 0) ||
        (kind === 'log' && prev.logIds.length === 0)
      const turningOn = !prev.visible[kind] || noInstances
      if (turningOn) {
        if (kind === 'files') {
          if (prev.fileIds.length === 0) {
            const id = nextFileId.current++
            return { ...prev, fileIds: [...prev.fileIds, id], activeFileId: id, visible: { ...prev.visible, files: true }, activeShell: `files:${id}` }
          }
          return { ...prev, activeShell: `files:${prev.activeFileId}`, visible: { ...prev.visible, [kind]: true } }
        } else if (kind === 'web') {
          const existing = prev.tabs.find((t) => t.type === 'browser')
          if (!existing) {
            const id = `browser:${++browserIdCounter}`
            return { ...prev, tabs: [...prev.tabs, { path: id, name: urlToName('https://wede.vulos.org'), type: 'browser', url: 'https://wede.vulos.org', content: '', originalContent: '', modified: false }], visible: { ...prev.visible, web: true }, activeTab: id, activeShell: `web:${id}` }
          }
          return { ...prev, activeTab: existing.path, activeShell: `web:${existing.path}`, visible: { ...prev.visible, [kind]: true } }
        } else if (kind === 'api') {
          if (prev.apiIds.length === 0) {
            const id = nextApiId.current++
            return { ...prev, apiIds: [...prev.apiIds, id], activeApiId: id, visible: { ...prev.visible, api: true }, activeShell: `api:${id}` }
          }
          return { ...prev, activeShell: `api:${prev.activeApiId}`, visible: { ...prev.visible, [kind]: true } }
        } else if (kind === 'terminals') {
          if (terminalsApi.terminals.length === 0) {
            return { ...prev, visible: { ...prev.visible, [kind]: true } }
          }
          const id = terminalsApi.activeId ?? terminalsApi.terminals[0].id
          terminalsApi.setActiveId(id)
          return { ...prev, activeShell: `term:${id}`, visible: { ...prev.visible, [kind]: true } }
        } else if (kind === 'search') {
          if (prev.searchIds.length === 0) {
            const id = nextSearchId.current++
            return { ...prev, searchIds: [...prev.searchIds, id], activeSearchId: id, visible: { ...prev.visible, search: true }, activeShell: `search:${id}` }
          }
          return { ...prev, activeShell: `search:${prev.activeSearchId}`, visible: { ...prev.visible, [kind]: true } }
        } else if (kind === 'log') {
          if (prev.logIds.length === 0) {
            const id = nextLogId.current++
            return { ...prev, logIds: [...prev.logIds, id], activeLogId: id, visible: { ...prev.visible, log: true }, activeShell: `log:${id}` }
          }
          return { ...prev, activeShell: `log:${prev.activeLogId}`, visible: { ...prev.visible, [kind]: true } }
        } else {
          // Single-instance view tab: settings, session-tabs, git, help, chat
          const entryId = `view:${kind}`
          if (prev.visible[kind]) return { ...prev, activeShell: entryId }
          return { ...prev, visible: { ...prev.visible, [kind]: true }, activeShell: entryId }
        }
      }
      return { ...prev, visible: { ...prev.visible, [kind]: turningOn } }
    })
  }, [terminalsApi])

  const showView = useCallback((kind: ViewKind) => {
    setLayout(prev => {
      if (kind === 'files') {
        if (prev.fileIds.length === 0) {
          const id = nextFileId.current++
          return { ...prev, fileIds: [...prev.fileIds, id], activeFileId: id, visible: { ...prev.visible, files: true }, activeShell: `files:${id}` }
        }
        return { ...prev, activeShell: `files:${prev.activeFileId}`, visible: { ...prev.visible, [kind]: true } }
      } else if (kind === 'search') {
        if (prev.searchIds.length === 0) {
          const id = nextSearchId.current++
          return { ...prev, searchIds: [...prev.searchIds, id], activeSearchId: id, visible: { ...prev.visible, search: true }, activeShell: `search:${id}` }
        }
        return { ...prev, activeShell: `search:${prev.activeSearchId}`, visible: { ...prev.visible, [kind]: true } }
      } else if (kind === 'log') {
        if (prev.logIds.length === 0) {
          const id = nextLogId.current++
          return { ...prev, logIds: [...prev.logIds, id], activeLogId: id, visible: { ...prev.visible, log: true }, activeShell: `log:${id}` }
        }
        return { ...prev, activeShell: `log:${prev.activeLogId}`, visible: { ...prev.visible, [kind]: true } }
      } else if (kind === 'web') {
        const existing = prev.tabs.find((t) => t.type === 'browser')
        if (!existing) {
          const id = `browser:${++browserIdCounter}`
          return { ...prev, tabs: [...prev.tabs, { path: id, name: urlToName('https://wede.vulos.org'), type: 'browser', url: 'https://wede.vulos.org', content: '', originalContent: '', modified: false }], visible: { ...prev.visible, web: true }, activeTab: id, activeShell: `web:${id}` }
        }
        return { ...prev, activeTab: existing.path, activeShell: `web:${existing.path}`, visible: { ...prev.visible, [kind]: true } }
      } else if (kind === 'api') {
        if (prev.apiIds.length === 0) {
          const id = nextApiId.current++
          return { ...prev, apiIds: [...prev.apiIds, id], activeApiId: id, visible: { ...prev.visible, api: true }, activeShell: `api:${id}` }
        }
        return { ...prev, activeShell: `api:${prev.activeApiId}`, visible: { ...prev.visible, [kind]: true } }
      } else if (kind === 'terminals') {
        if (terminalsApi.terminals.length === 0) {
          return { ...prev, visible: { ...prev.visible, [kind]: true } }
        }
        const id = terminalsApi.activeId ?? terminalsApi.terminals[0].id
        terminalsApi.setActiveId(id)
        return { ...prev, activeShell: `term:${id}`, visible: { ...prev.visible, [kind]: true } }
      } else {
        // Single-instance view tab: settings, session-tabs, git, help, chat
        const entryId = `view:${kind}`
        if (prev.visible[kind]) return { ...prev, activeShell: entryId }
        return { ...prev, visible: { ...prev.visible, [kind]: true }, activeShell: entryId }
      }
    })
  }, [terminalsApi])

  interface ShellEntry {
    id: string
    kind: ViewKind | 'container'
    title: string
    icon: ViewTab['icon']
    filePath?: string
    webPath?: string
    fileId?: number
    apiId?: number
    termId?: number
    searchId?: number
    logId?: number
    containerId?: number
  }

  const entries = useMemo<ShellEntry[]>(() => {
    const list: ShellEntry[] = []
    const pushView = (kind: ViewKind, title: string, icon: ViewTab['icon']) =>
      list.push({ id: `view:${kind}`, kind, title, icon })
    if (visible.files) for (const id of fileIds) list.push({ id: `files:${id}`, kind: 'files', title: id === 1 ? 'Files' : `Files ${id}`, icon: Files, fileId: id })
    if (visible.search) for (const id of searchIds) list.push({ id: `search:${id}`, kind: 'search', title: `Search ${id}`, icon: SearchIcon, searchId: id })
    if (visible.code) {
      const fileTabs = tabs.filter((t) => isFileTab(t) && !t.hidden)
      if (debug && fileTabs.length > 0) {
        console.debug('[IDE-entries] file tabs:', fileTabs.map(t => ({ path: t.path, name: t.name, hidden: t.hidden })))
      }
      for (const t of fileTabs) list.push({ id: `file:${t.path}`, kind: 'code', title: t.name || 'Editor', icon: Code2, filePath: t.path })
    }
    if (visible.terminals) {
      for (const t of terminalsApi.terminals) list.push({ id: `term:${t.id}`, kind: 'terminals', title: t.name, icon: TerminalSquare, termId: t.id })
    }
    if (visible.web) {
      for (const t of tabs.filter((t) => t.type === 'browser')) {
        list.push({ id: `web:${t.path}`, kind: 'web', title: t.name || 'Web', icon: Globe, webPath: t.path })
      }
    }
    if (visible.git) pushView('git', 'Git', GitBranch)
    if (visible.api) for (const id of apiIds) list.push({ id: `api:${id}`, kind: 'api', title: `API ${id}`, icon: Webhook, apiId: id })
    if (visible.log) for (const id of logIds) list.push({ id: `log:${id}`, kind: 'log', title: `Log ${id}`, icon: ScrollText, logId: id })
    if (visible.help) pushView('help', 'Help', HelpCircle)
    if (visible.chat) pushView('chat', 'Chat', MessageSquare)
    if (visible['session-tabs']) pushView('session-tabs', 'Session tabs', Users)
    for (const c of containers.filter((x) => x.visible)) {
      list.push({ id: `container:${c.id}`, kind: 'container', title: `Cont ${c.id}`, icon: Boxes, containerId: c.id })
    }
    if (visible.settings) pushView('settings', 'Settings', SettingsIcon)
    const order = (id: string) => {
      const i = tabOrder.indexOf(id)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    return list.sort((a, b) => order(a.id) - order(b.id))
  }, [visible, tabs, fileIds, apiIds, searchIds, logIds, containers, terminalsApi.terminals, tabOrder])

  const shellMode = (id: string): ViewMode => viewModes[id] || 'center'
  const rootAncestorId = (id: string): string => {
    let cur = id
    const seen = new Set<string>()
    while (containerOf[cur] && !seen.has(cur)) {
      seen.add(cur)
      cur = containerOf[cur]
    }
    return cur
  }
  const directChildOnPath = (containerId: number, id: string): string | null => {
    let cur = id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const parent = containerOf[cur]
      if (!parent) return null
      if (parent === `container:${containerId}`) return cur
      cur = parent
    }
    return null
  }
  const childrenOfContainer = (containerId: number) => entries.filter((e) => containerOf[e.id] === `container:${containerId}`)
  // Root-container entries only; nested tabs live in their container's strip.
  const rootEntries = entries.filter((e) => !containerOf[e.id])
  const activeRootId = activeShell ? rootAncestorId(activeShell) : null
  const activeRootEntry = entries.find((e) => e.id === activeRootId) ?? null
  const activeMode: ViewMode = activeRootEntry ? shellMode(activeRootEntry.id) : 'center'
  const centerEntry = activeRootEntry && (activeMode === 'center' || activeMode === 'max')
    ? activeRootEntry
    : rootEntries.find((e) => shellMode(e.id) === 'center') ?? null
  const dockedLeft = rootEntries.filter((e) => shellMode(e.id) === 'docked-left')
  const dockedRight = rootEntries.filter((e) => shellMode(e.id) === 'docked-right')
  const dockedBottom = rootEntries.filter((e) => shellMode(e.id) === 'docked-bottom')
  const isDockedMode = (mode: ViewMode) => mode === 'docked-left' || mode === 'docked-right' || mode === 'docked-bottom'
  const mainTabs = rootEntries.filter((e) => !isDockedMode(shellMode(e.id)) && shellMode(e.id) !== 'float')
  const mainActive = activeRootEntry && mainTabs.some((e) => e.id === activeRootEntry.id) ? activeRootEntry.id : centerEntry?.id ?? ''


  // No restore useEffect needed — layout comes from WebSocket onInit callback.
  // The server is the single source of truth.

  // Remove empty containers so no ghost strip/window remains.
  // Runs after any state change (including drag & drop) to clean up ghosts.
  useEffect(() => {
    // A container is empty if it has no child entries and no child containers,
    // or all child containers are themselves empty.
    const hasChildEntry = (cid: number) =>
      entries.some((e) => containerOf[e.id] === `container:${cid}`)

    const hasChildContainer = (cid: number) =>
      Object.values(containerOf).some((v) => v === `container:${cid}`)

    // Recursively check if a container has any real content
    const containerHasContent = (cid: number, visited: Set<number>): boolean => {
      if (visited.has(cid)) return false
      visited.add(cid)
      if (hasChildEntry(cid)) return true
      // Check attached sub-containers via containerOf
      for (const [childKey, parentKey] of Object.entries(containerOf)) {
        if (parentKey === `container:${cid}`) {
          const childCidMatch = childKey.match(/^container:(\d+)$/)
          if (childCidMatch) {
            const childCid = parseInt(childCidMatch[1], 10)
            if (containerHasContent(childCid, visited)) return true
          }
        }
      }
      return false
    }

    const empty = containers.filter((c) => {
      if (!c.visible) return false
      if (containerHasContent(c.id, new Set())) return false
      return true
    })
    if (empty.length === 0) return
    const ids = new Set(empty.map((c) => c.id))
    const keys = new Set(empty.map((c) => `container:${c.id}`))
    setLayout(prev => {
      const nextViewModes = { ...prev.viewModes }
      for (const key of keys) delete nextViewModes[key]
      const nextContainerActive = { ...prev.containerActive }
      for (const id of ids) delete nextContainerActive[id]
      for (const [cid, child] of Object.entries(nextContainerActive)) if (keys.has(child)) delete nextContainerActive[Number(cid)]
      const nextContainerOf = { ...prev.containerOf }
      for (const key of keys) { if (nextContainerOf[key]) delete nextContainerOf[key] }
      // Also clean up floatGeom for removed containers
      const nextFloatGeom = { ...prev.floatGeom }
      for (const key of keys) delete nextFloatGeom[key]
      return { ...prev, containers: prev.containers.filter((c) => !ids.has(c.id)), viewModes: nextViewModes, containerActive: nextContainerActive, containerOf: nextContainerOf, floatGeom: nextFloatGeom }
    })
    setNestedDockActive((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [scope, child] of Object.entries(next)) {
        if (keys.has(child) || Array.from(keys).some((k) => scope.startsWith(`${k}:`))) {
          delete next[scope]; changed = true
        }
      }
      return changed ? next : prev
    })
    setDockActive((prev) => {
      let changed = false
      const next = { ...prev }
      for (const side of ['left', 'right', 'bottom'] as const) {
        if (next[side] && keys.has(next[side])) { next[side] = null; changed = true }
      }
      return changed ? next : prev
    })
  }, [containers, containerOf, entries, viewModes, containerActive])

  // Tasks (global + trusted project .wede/tasks.json) — run in a new terminal.
  const [tasks, setTasks] = useState<Task[]>([])
  const fetchTasks = useCallback(() => {
    if (!authFetch) return
    authFetch('/api/tasks').then((r) => r.json()).then((d: { tasks?: Task[] }) => setTasks(d.tasks || [])).catch(() => {})
  }, [authFetch])
  useEffect(() => { fetchTasks() }, [fetchTasks, workspaceId])
  const runTask = useCallback(async (task: Task) => {
    if (role === 'viewer' || !task?.command) return
    const cmd = task.cwd ? `cd '${task.cwd}' && ${task.command}` : task.command
    const id = await terminalsApi.addTerminal(task.name || 'Task', cmd)
    setLayout(prev => ({ ...prev, visible: { ...prev.visible, terminals: true }, activeShell: `term:${id}` }))
  }, [role, terminalsApi])


  // Debugging (DAP) — adapter availability, breakpoints, and the live session.
  const dap = useDap({ workspaceId, token })
  const [dapAvailable, setDapAvailable] = useState<DapAvailableInfo>({ available: {}, extensions: {} })
  useEffect(() => {
    if (!authFetch) return
    authFetch('/api/dap/available').then((r) => r.json())
      .then((d: Partial<DapAvailableInfo>) => setDapAvailable({ available: d.available || {}, extensions: d.extensions || {} }))
      .catch(() => {})
  }, [authFetch, workspaceId])
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({}) // { absolutePath: number[] }
  // The active tab's path relative to its own workspace root (activeTab is a
  // composite workspaceId+rel key; the DAP/lang helpers below want the rel part).
  const activeRel = parseFileKey(activeTab || '').rel
  const wsRoot = (workspace || '').replace(/\/+$/, '')
  const absPath = useCallback((rel: string) => (wsRoot && rel ? `${wsRoot}/${rel}` : rel), [wsRoot])
  const langForPath = useCallback((rel: string): string | null => {
    if (!rel) return null
    const ext = (rel.split('.').pop() || '').toLowerCase()
    const lang = dapAvailable.extensions[ext]
    return lang && dapAvailable.available[lang] ? lang : null
  }, [dapAvailable])
  const toggleBreakpoint = useCallback((rel: string, lines: number[]) => {
    const abs = absPath(rel)
    setBreakpoints((prev) => ({ ...prev, [abs]: lines }))
    if (dap.status === 'running' || dap.status === 'stopped') dap.syncBreakpoints(abs, lines)
  }, [absPath, dap])
  const startDebug = useCallback(() => {
    const rel = activeRel
    const lang = langForPath(rel)
    if (!lang || role === 'viewer') return
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    const program = lang === 'go' ? absPath(dir || '.') : absPath(rel)
    dap.start({ program, lang, breakpoints })
  }, [activeRel, langForPath, role, absPath, dap, breakpoints])
  const debugLang = langForPath(activeRel)
  const hasDebugAdapters = Object.keys(dapAvailable.available).length > 0
  const currentStopLine = (dap.stopLine && activeRel &&
    (dap.stopLine.path === absPath(activeRel) || dap.stopLine.path?.endsWith('/' + activeRel)))
    ? dap.stopLine.line : null
  // Terminals live in their own view tab; floating windows are an overlay.
  const [floatingTerminals, setFloatingTerminals] = useState(false)
  const toggleTerminal = useCallback(() => { toggleVisible('terminals') }, [toggleVisible])
  const dockTerminal = useCallback(() => {
    setFloatingTerminals(false)
    const first = terminalsApi.terminals[0]
    setLayout(prev => ({
      ...prev,
      visible: { ...prev.visible, terminals: true },
      activeShell: first ? `term:${first.id}` : prev.activeShell,
    }))
  }, [terminalsApi.terminals])
  const floatTerminal = useCallback(() => { setFloatingTerminals(true) }, [])

  const [termFullscreen, setTermFullscreen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'' | 'saving' | 'saved'>('') // 'saving'|'saved'|''
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [mdPreviewPaths, setMdPreviewPaths] = useState<Set<string>>(() => new Set())
  const toggleMdPreview = useCallback((path: string) => {
    setMdPreviewPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }, [])

  const DEFAULT_EDITOR_SETTINGS: EditorSettings = { fontSize: 13, tabWidth: 2, wordWrap: false, autoSave: true, minimap: false, lsp: true, formatOnSave: false, numbering: 'smart' }

  // Editor settings — persisted to localStorage
  const [editorSettings, setEditorSettings] = useState<EditorSettings>(() => {
    const saved = localStorage.getItem('wede_editor_settings')
    if (!saved) return DEFAULT_EDITOR_SETTINGS
    try {
      const s: EditorSettings = JSON.parse(saved)
      // Back-fill new keys for users upgrading from older localStorage state.
      if (s.minimap === undefined) s.minimap = false
      if (s.lsp === undefined) s.lsp = true
      if (s.formatOnSave === undefined) s.formatOnSave = false
      if (s.collab === undefined) s.collab = false
      if (s.numbering === undefined) s.numbering = 'smart'
      return s
    } catch {
      return DEFAULT_EDITOR_SETTINGS
    }
  })

  const handleEditorSettingsChange = useCallback((s: EditorSettings) => {
    setEditorSettings(s)
    try { localStorage.setItem('wede_editor_settings', JSON.stringify(s)) } catch (_ignored) { void _ignored }
  }, [])

  // Local visible tab type overrides — merged with server-side config.
  // When the server sends visibleTabTypes, we merge with local overrides.
  const [localVisibleTabTypes, setLocalVisibleTabTypesState] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('wede_visible_tab_types')
      if (saved) return JSON.parse(saved) as Record<string, boolean>
    } catch { /* ignore */ }
    return {}
  })
  const prevLocalVisibleTabTypesRef = useRef<Record<string, boolean>>({})
  const setLocalVisibleTabTypes = useCallback((types: Record<string, boolean>) => {
    setLocalVisibleTabTypesState(types)
    try { localStorage.setItem('wede_visible_tab_types', JSON.stringify(types)) } catch (_ignored) { void _ignored }
    // For single-instance view tabs, also update the layout visible state.
    // When enabling: add to layout if not already present.
    // When disabling: just hide — location preserved.
    const prev = prevLocalVisibleTabTypesRef.current
    prevLocalVisibleTabTypesRef.current = types
    for (const [kind, shown] of Object.entries(types)) {
      if (SINGLE_INSTANCE_TABS.has(kind) && prev[kind] !== shown) {
        const vk = kind as ViewKind
        setLayout(p => {
          const entryId = `view:${kind}`
          if (shown) {
            // Enabling: if already visible, just activate; otherwise make visible
            if (p.visible[vk]) return { ...p, activeShell: entryId }
            return { ...p, visible: { ...p.visible, [vk]: true }, activeShell: entryId }
          } else {
            // Disabling: just hide, preserve layout position
            return { ...p, visible: { ...p.visible, [vk]: false } }
          }
        })
      }
    }
  }, [])

  // Merge server config with local overrides: local overrides take precedence.
  // Always returns a full map (defaults true) so the Settings "Tab visibility"
  // section is available even when the server sends no config.
  const mergedVisibleTabTypes = useMemo(() => {
    const merged: Record<string, boolean> = {}
    const hiddenByDefault = new Set(['api', 'log', 'chat'])
    for (const kind of VIEW_TABS.map(v => v.kind)) merged[kind] = !hiddenByDefault.has(kind)
    // Apply server config
    if (visibleTabTypes) {
      for (const [k, v] of Object.entries(visibleTabTypes)) {
        merged[k] = v
      }
    }
    // Apply local overrides
    for (const [k, v] of Object.entries(localVisibleTabTypes)) {
      merged[k] = v
    }
    // Keep RR Control available to teachers whenever enabled; it is not a
    // user-toggleable tab, and old saved visibility preferences must not hide it.
    if (rrControlEnabled && teacher) merged['rrcontrol'] = true
    return merged
  }, [visibleTabTypes, localVisibleTabTypes, rrControlEnabled, teacher])

  // Expose FileExplorer's refresh + new-file/folder triggers for the command palette and SSE watcher.
  const explorerActionsRef = useRef<ExplorerActions | null>(null)
  // Stable ref used by the SSE watcher to trigger explorer reload without re-subscribing.
  const sseExplorerRefreshRef = useRef<(() => void) | undefined>(undefined)
  const handleRegisterExplorerActions = useCallback((actions: ExplorerActions | null) => {
    explorerActionsRef.current = actions
    sseExplorerRefreshRef.current = actions?.refresh
  }, [])

  // Expose Editor actions (goToLine) registered by the active Editor instance.
  const editorActionsRef = useRef<EditorActions | null>(null)
  const handleRegisterEditorActions = useCallback((actions: EditorActions) => {
    editorActionsRef.current = actions
  }, [])

  const [terminalKey, setTerminalKey] = useState(0)

  // Status bar info
  const [gitBranch, setGitBranch] = useState('')
  const [gitChanges, setGitChanges] = useState(0)
  const [cursor, setCursor] = useState<CursorPos>({ line: 1, col: 1 })

  // Publish the local file + cursor line + selection range so peers (and a teacher
  // leading the session) can follow. The collab hook throttles these updates.
  // Include the active tab's unique ID so the server stores cursor in tab_content_states.
  useEffect(() => {
    const rel = parseFileKey(activeTab || '').rel
    const activeTabEntry = tabs.find((t) => t.path === activeTab)
    const activeTabId = activeTabEntry?.id ?? 0
    const hasSel = cursor.anchorLine && cursor.headLine && cursor.anchorLine !== cursor.headLine
      || cursor.anchorLine && cursor.headLine && cursor.anchorLine === cursor.headLine && cursor.anchorCol && cursor.headCol && cursor.anchorCol !== cursor.headCol
    const anchorLine = hasSel ? (cursor.anchorLine || 0) : 0
    const anchorCol = hasSel ? (cursor.anchorCol || 0) : 0
    const headLine = hasSel ? (cursor.headLine || 0) : 0
    const headCol = hasSel ? (cursor.headCol || 0) : 0
    setCollabViewing(rel, activeTabId, rel ? cursor.line : 0, anchorLine, anchorCol, headLine, headCol)
    // Also track per-tab cursor position for tab_content_states persistence.
    // Keyed by tab ID so multiple instances of the same file are distinguished.
    if (activeTab && rel && activeTabId) {
      setTabContentStates((prev) => {
        const key = `id:${activeTabId}`
        const existing = prev[key]
        if (existing && existing.line === cursor.line && existing.col === cursor.col) return prev
        if (debug) {
          logCursorMove(rel, cursor.line, cursor.col)
        }
        return { ...prev, [key]: { line: cursor.line, col: cursor.col } }
      })
    }
  }, [activeTab, cursor.line, cursor.anchorLine, cursor.anchorCol, cursor.headLine, cursor.headCol, setCollabViewing, selfId, debug, tabs])

  // Publish the open file tabs + terminal IDs for this workspace so peers can
  // see who has which files and terminals open (used by SessionTabs).
  const lastSentTabsRef = useRef('')
  useEffect(() => {
    const fileTabs = tabs.filter((t) => t.workspaceId === workspaceId && t.rel && !t.type)
    const fileRelPaths = fileTabs.map((t) => t.rel as string)
    // Include terminal IDs so peers know which terminals this user has open.
    const termIds = terminalsApi.terminals.map((t) => `term-${t.id}`)
    const list = [...fileRelPaths, ...termIds]
    // Include selfId so the inventory is re-sent after a reconnect, while
    // ordinary keystrokes (which replace the tabs array) stay quiet.
    const key = `${selfId}:${JSON.stringify(list)}`
    if (lastSentTabsRef.current === key) return
    lastSentTabsRef.current = key
    setCollabTabs(list)
  }, [tabs, terminalsApi.terminals, workspaceId, setCollabTabs, selfId])

  // Tell the server whether this client wants its tab changes broadcast to peers.
  // When off (default), the user's tabs are stored but not pushed — peers only
  // see them on manual refresh. When on, every tab change triggers a broadcast.
  useEffect(() => {
    const enabled = editorSettings.sessionTabAutoRefresh ?? false
    setPushTabs(enabled)
  }, [editorSettings.sessionTabAutoRefresh, setPushTabs])

  // Personal follow is client-local; a teacher's lead overrides it with a
  // forced live follow. Keeping the personal target lets us return to it when
  // the lead ends.
  const [followTargetId, setFollowTargetId] = useState<string | null>(null)
  const [followMode, setFollowMode] = useState<'open' | 'live' | null>(null)
  const presenterIsMe = !!presenter && presenter.id === selfId
  const forcedPresenter = presenter && !presenterIsMe ? presenter : null
  // A leading teacher is the source of the follow stream; pause their own
  // personal follow until the lead ends.
  const effectiveFollowId = forcedPresenter ? forcedPresenter.id : presenterIsMe ? null : followTargetId
  const effectiveFollowMode = forcedPresenter ? 'live' : presenterIsMe ? null : followMode

  // Layout state (tabs, activeTab, etc.) is saved to the server only via saveLayout.
  // No localStorage persistence — the server is the single source of truth.

  // Re-fetch content for restored tabs on mount
  useEffect(() => {
    if (tabs.length === 0) return
    const needsContent = tabs.filter(t => t.type !== 'browser' && t.content === undefined)
    if (needsContent.length === 0) return
    void Promise.all(needsContent.map(async (t) => {
      const wsId = t.workspaceId || workspaceId
      const rel = t.rel ?? parseFileKey(t.path).rel
      try {
        const res = await authFetch(workspaceUrl(wsId as string, `/files/read?path=${encodeURIComponent(rel)}`))
        const data: FileReadResponse = await res.json()
        if (data.fileType === 'image') return { path: t.path, content: '', fileType: 'image' as const, dataUrl: data.dataUrl }
        if (data.fileType === 'binary') return { path: t.path, content: '', fileType: 'binary' as const, size: data.size }
        if (data.fileType === 'pdf') return { path: t.path, content: '', fileType: 'pdf' as const, size: data.size }
        if (data.fileType === 'video') return { path: t.path, content: '', fileType: 'video' as const, size: data.size }
        return { path: t.path, content: data.content }
      } catch { return { path: t.path, content: '' } }
    })).then(results => {
      setTabs(prev => prev.map(t => {
        const r = results.find(r => r.path === t.path)
        if (r) return { ...t, content: r.content, originalContent: r.content, modified: false, fileType: 'fileType' in r ? r.fileType : undefined, dataUrl: 'dataUrl' in r ? r.dataUrl : undefined, size: 'size' in r ? r.size : undefined }
        return t
      }))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch git branch + change count for status bar
  useEffect(() => {
    let active = true
    const fetchGit = async () => {
      try {
        const res = await authFetch('/api/git/status')
        const data: { branch?: string, files?: unknown[] } = await res.json()
        if (active) {
          setGitBranch(data.branch || '')
          setGitChanges(data.files?.length || 0)
        }
      } catch { /* ignore */ }
    }
    void fetchGit()
    // Fallback poll at 30 s — the SSE watcher below provides faster updates.
    const interval = setInterval(fetchGit, 30000)
    return () => { active = false; clearInterval(interval) }
  }, [authFetch, workspace])

  // ── File watching SSE — workspace change events ──
  // When the server detects a file change it sends {"type":"change"} which
  // triggers a git-status refresh and signals the explorer to reload.
  useEffect(() => {
    if (!workspace) return
    let es: EventSource | null = null
    let active = true

    const connect = () => {
      if (!active) return
      // SSE can't use custom headers, so pass the token as a query param.
      // The auth middleware already supports ?token= for WS/SSE routes.
      // Scope to the active workspace so the watcher follows workspace switches.
      const base = workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/watch` : '/api/watch'
      const url = `${base}?token=${encodeURIComponent(token)}`
      es = new EventSource(url)
      es.onmessage = (e: MessageEvent) => {
        try {
          const msg: { type?: string } = JSON.parse(e.data)
          if (msg.type === 'change') {
            // Refresh git status badge.
            authFetch('/api/git/status').then(r => r.json()).then((data: { branch?: string, files?: unknown[] }) => {
              setGitBranch(data.branch || '')
              setGitChanges(data.files?.length || 0)
            }).catch(() => {})
            // Signal explorer to reload.
            sseExplorerRefreshRef.current?.()
          }
        } catch { /* ignore */ }
      }
      es.onerror = () => {
        es?.close()
        if (active) setTimeout(connect, 5000) // reconnect after 5 s
      }
    }

    connect()
    return () => {
      active = false
      es?.close()
    }
  }, [workspace, token, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save ──
  // After a configurable debounce (1.5 s by default) auto-save dirty tabs.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const triggerAutoSave = useCallback((tab: Tab, content: string) => {
    if (!editorSettings.autoSave) return
    clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        await authFetch(workspaceUrl(tab.workspaceId as string, '/files/write'), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: tab.rel, content }),
        })
        setTabs((prev) => prev.map((t) =>
          t.path === tab.path ? { ...t, originalContent: content, modified: t.content !== content } : t
        ))
        setAutoSaveStatus('saved')
        setTimeout(() => setAutoSaveStatus(''), 2000)
      } catch {
        setAutoSaveStatus('')
      }
    }, 1500)
  }, [authFetch, editorSettings.autoSave])

  // ── Close tab ── (defined here so it is reachable by the keyboard-shortcut
  // useEffect below — Vite/Rolldown's const hoisting can trigger a TDZ when
  // a const binding is referenced before its declaration in the same scope.)
  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      // Locked tabs refuse to close until unlocked.
      if (prev.find((t) => t.path === path)?.locked) return prev
      const next = prev.filter((t) => t.path !== path)
      if (activeTab === path) {
        const idx = prev.findIndex((t) => t.path === path)
        const after = next.slice(idx + 1).find((t) => isFileTab(t) && !t.hidden)
        const before = [...next.slice(0, idx)].reverse().find((t) => isFileTab(t) && !t.hidden)
        setActiveTab((after ?? before)?.path || null)
      }
      return next
    })
  }, [activeTab])

  // hideTab preserves the tab (content/scroll/order) but removes it from the
  // main strip. Closing is the destructive action; hiding is the reversible one.
  const hideTab = useCallback((path: string) => {
    setTabs((prev) => {
      const target = prev.find((t) => t.path === path)
      if (!target || target.hidden || target.locked) return prev
      const next = prev.map((t) => (t.path === path ? { ...t, hidden: true } : t))
      if (activeTab === path) {
        const idx = prev.findIndex((t) => t.path === path)
        const after = next.slice(idx + 1).find((t) => isFileTab(t) && !t.hidden)
        const before = [...next.slice(0, idx)].reverse().find((t) => isFileTab(t) && !t.hidden)
        const nextActive = after ?? before ?? null
        setActiveTab(nextActive?.path ?? null)
        if (activeShell === `file:${path}`) setActiveShell(nextActive ? `file:${nextActive.path}` : '')
      }
      return next
    })
  }, [activeTab, activeShell])

  // showTab reopens a hidden tab and focuses it.
  const showTab = useCallback((path: string) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, hidden: false } : t)))
    setVisible((v) => ({ ...v, code: true }))
    setActiveTab(path)
    setActiveShell(`file:${path}`)
  }, [])

  const toggleTabHidden = useCallback((path: string) => {
    const tab = tabs.find((t) => t.path === path)
    if (!tab) return
    if (tab.hidden) showTab(path)
    else hideTab(path)
  }, [tabs, showTab, hideTab])

  // closeSelectedTabs closes the given tabs, skipping locked ones unless
  // includeLocked is set.
  const closeSelectedTabs = useCallback((paths: string[], includeLocked: boolean) => {
    const set = new Set(paths)
    const next = tabs.filter((t) => !set.has(t.path) || (!includeLocked && t.locked))
    if (next.length === tabs.length) return
    setTabs(next)
    if (activeTab && !next.some((t) => t.path === activeTab)) {
      const nextActive = [...next].reverse().find((t) => isFileTab(t) && !t.hidden)
      setActiveTab(nextActive?.path ?? null)
    }
  }, [tabs, activeTab])

  // setTabsLocked locks/unlocks the given tab paths.
  const setTabsLocked = useCallback((paths: string[], locked: boolean) => {
    const set = new Set(paths)
    setTabs((prev) => prev.map((t) => (set.has(t.path) ? { ...t, locked } : t)))
  }, [])

  // reorderTabs moves tab `from` to `to`'s position (drag & drop). The order is
  // persisted by the existing tabs effect, so it survives a reload.
  const reorderTabs = useCallback((from: string, to: string) => {
    setTabs((prev) => {
      const fromIdx = prev.findIndex((t) => t.path === from)
      const toIdx = prev.findIndex((t) => t.path === to)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  // ── Flat shell tab handlers ──
  const selectShell = useCallback((id: string) => {
    setActiveShell(id)
    // Remember the active tab at every container level on the path.
    let cur = id
    const seen = new Set<string>()
    while (containerOf[cur] && !seen.has(cur)) {
      seen.add(cur)
      const parent = containerOf[cur]
      const containerId = Number(parent.replace('container:', ''))
      if (Number.isFinite(containerId)) setContainerActive((prev) => ({ ...prev, [containerId]: cur }))
      cur = parent
    }
    const e = entries.find((x) => x.id === id)
    if (!e) return
    if (e.filePath) setActiveTab(e.filePath)
    else if (e.webPath) setActiveTab(e.webPath)
    else if (e.fileId != null) setActiveFileId(e.fileId)
    else if (e.apiId != null) setActiveApiId(e.apiId)
    else if (e.searchId != null) setActiveSearchId(e.searchId)
    else if (e.logId != null) setActiveLogId(e.logId)
    else if (e.termId != null) terminalsApi.setActiveId(e.termId)
    else setActiveTab(null)
    if (!desktopMode) setMenuOpen(false)
  }, [entries, terminalsApi, desktopMode, containerOf])

  const setShellLock = useCallback((ids: string[], locked: boolean) => {
    setLockedShells((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (locked) next.add(id)
        else next.delete(id)
      }
      return Array.from(next)
    })
  }, [])

  const placeFloatAt = useCallback((rootId: string, at: { x: number; y: number }) => {
    const parent = document.querySelector('[data-dock-area]')
    const rect = parent?.getBoundingClientRect()
    if (!rect) return
    setFloatGeom((prev) => {
      const base = prev[rootId] ?? { x: 40, y: 40, w: 620, h: 420, z: 30 }
      const w = Math.min(base.w, Math.max(260, rect.width))
      const h = Math.min(base.h, Math.max(160, rect.height))
      const x = Math.max(0, Math.min(at.x - rect.left - w / 2, Math.max(0, rect.width - w)))
      const y = Math.max(0, Math.min(at.y - rect.top - 16, Math.max(0, rect.height - 40)))
      return { ...prev, [rootId]: { ...base, w, h, x, y } }
    })
  }, [])

  const setShellViewMode = useCallback((ids: string[], mode: ViewMode, at?: { x: number; y: number }) => {
    // A float or a dock is a container: moving a plain tab there wraps it in a
    // new container. Drag & drop into an existing container uses
    // dropIntoContainer instead.
    const dockTarget = mode === 'docked-left' || mode === 'docked-right' || mode === 'docked-bottom'
    const wrapped = (mode === 'float' || dockTarget)
      ? ids.filter((id) => !id.startsWith('container:')).map((child) => ({ id: containerIdRef.current++, child, mode }))
      : []
    if (wrapped.length) {
      setContainers((prev) => [...prev, ...wrapped.map((c) => ({ id: c.id, visible: true, ownTab: c.mode === 'float' }))])
      setContainerOf((prev) => {
        const next = { ...prev }
        for (const c of wrapped) next[c.child] = `container:${c.id}`
        return next
      })
      setContainerActive((prev) => {
        const next = { ...prev }
        for (const c of wrapped) next[c.id] = c.child
        return next
      })
    }
    const wrappedIds = new Set(wrapped.map((c) => c.child))
    const directIds = ids.filter((id) => !wrappedIds.has(id))
    const directContainers = new Set(directIds.filter((id) => id.startsWith('container:')))
    if (dockTarget && directContainers.size > 0) {
      setContainers((prev) => prev.map((c) => (
        directContainers.has(`container:${c.id}`) ? { ...c, ownTab: true } : c
      )))
    }
    // A tab assigned a root view mode leaves its container (containers keep
    // their own children when the container itself is moved).
    setContainerOf((prev) => {
      if (!directIds.some((id) => prev[id])) return prev
      const next = { ...prev }
      for (const id of directIds) delete next[id]
      return next
    })
    setViewModes((prev) => {
      const next = { ...prev }
      for (const id of directIds) next[id] = mode
      for (const c of wrapped) {
        delete next[c.child]
        next[`container:${c.id}`] = c.mode
      }
      return next
    })
    if (mode === 'float' && at) {
      for (const c of wrapped) placeFloatAt(`container:${c.id}`, at)
      for (const id of directIds) if (id.startsWith('container:')) placeFloatAt(id, at)
    }
    const lastId = ids[ids.length - 1]
    setDockActive((prev) => {
      const next = { ...prev }
      for (const side of ['left', 'right', 'bottom'] as const) {
        if (next[side] && ids.includes(next[side])) next[side] = null
      }
      if (mode === 'docked-left') next.left = lastId
      else if (mode === 'docked-right') next.right = lastId
      else if (mode === 'docked-bottom') next.bottom = lastId
      return next
    })
    if (mode === 'center' || mode === 'max') {
      if (lastId) setActiveShell(lastId)
    } else if (ids.includes(activeShell)) {
      const next = rootEntries.find((e) => !ids.includes(e.id) && (viewModes[e.id] || 'center') === 'center')
      if (next) setActiveShell(next.id)
    }
  }, [activeShell, rootEntries, viewModes, placeFloatAt])

  const handleDragAway = useCallback((id: string, at: { x: number; y: number }) => {
    setModeDrag(null)
    // A container's own tab moves/detaches that container. Any child tab —
    // including one in a floating container — becomes a new floating window.
    if (id.startsWith('container:')) {
      if ((viewModes[id] || 'center') === 'float') placeFloatAt(id, at)
      else setShellViewMode([id], 'float', at)
      return
    }
    setShellViewMode([id], 'float', at)
  }, [viewModes, placeFloatAt, setShellViewMode])

  // Place a shell next to another tab in the global order. Container and dock
  // strips filter this order, so this controls front/back within a strip too.
  const moveShellNear = useCallback((id: string, nearId?: string, after = false) => {
    if (!nearId || nearId === id) return
    setTabOrder((prev) => {
      const ids = entries.map((e) => e.id)
      const base = [...new Set([...prev.filter((x) => ids.includes(x)), ...ids])]
      const a = base.indexOf(id)
      if (a < 0 || !base.includes(nearId)) return prev
      const next = base.slice()
      next.splice(a, 1)
      let target = next.indexOf(nearId)
      if (target < 0) return prev
      if (after) target += 1
      next.splice(target, 0, id)
      return next
    })
  }, [entries])

  // Move a tab into a specific (possibly nested) container. Docking a tab
  // drops its old container membership; moving a container keeps its children.
  const dropIntoContainer = useCallback((id: string, containerId: number, nearId?: string, after = false) => {
    setModeDrag(null)
    if (!Number.isFinite(containerId) || id === `container:${containerId}`) return
    // Refuse to put a container inside itself or one of its descendants.
    let cur: string | undefined = `container:${containerId}`
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      if (cur === id) return
      cur = containerOf[cur]
    }
    setContainerOf((prev) => ({ ...prev, [id]: `container:${containerId}` }))
    setContainerActive((prev) => ({ ...prev, [containerId]: id }))
    setViewModes((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setContainers((prev) => prev.map((c) => (c.id === containerId ? { ...c, visible: true } : c)))
    const targetKids = entries.filter((e) => e.id !== id && containerOf[e.id] === `container:${containerId}`)
    const lastKid = targetKids[targetKids.length - 1]
    moveShellNear(id, nearId ?? lastKid?.id, nearId ? after : true)
    setActiveShell(id)
  }, [containerOf, entries, moveShellNear])

  // Place a tab (or a whole container) into a dock slot belonging to a
  // specific container. Plain tabs are wrapped so every dock slot hosts a
  // container; containers move with their children intact.
  const placeIntoSlot = useCallback((id: string, parentKey: string | null, mode: ViewMode) => {
    setModeDrag(null)
    const isContainer = id.startsWith('container:')
    if (isContainer) {
      // Refuse to nest a container inside itself or one of its descendants.
      let cur = parentKey
      const seen = new Set<string>()
      while (cur && !seen.has(cur)) {
        seen.add(cur)
        if (cur === id) return
        cur = containerOf[cur]
      }
      const cid = Number(id.slice('container:'.length))
      setContainerOf((prev) => {
        const next = { ...prev }
        if (parentKey) next[id] = parentKey
        else delete next[id]
        return next
      })
      setViewModes((prev) => ({ ...prev, [id]: mode }))
      setContainers((prev) => prev.map((c) => (c.id === cid ? { ...c, visible: true, ownTab: true } : c)))
      if (parentKey) setNestedDockActive((prev) => ({ ...prev, [`${parentKey}:${mode.replace('docked-', '')}`]: id }))
      setActiveShell(id)
      return
    }
    const cid = containerIdRef.current++
    setContainers((prev) => [...prev, { id: cid, visible: true, ownTab: true }])
    setContainerOf((prev) => {
      const next = { ...prev, [id]: `container:${cid}` }
      if (parentKey) next[`container:${cid}`] = parentKey
      return next
    })
    setContainerActive((prev) => ({ ...prev, [cid]: id }))
    setViewModes((prev) => ({ ...prev, [id]: 'center', [`container:${cid}`]: mode }))
    if (parentKey) setNestedDockActive((prev) => ({ ...prev, [`${parentKey}:${mode.replace('docked-', '')}`]: `container:${cid}` }))
    setActiveShell(id)
  }, [containerOf])

  const dropViewMode = useCallback((id: string, mode: string, nearId?: string, after = false) => {
    setModeDrag(null)
    if (mode.startsWith('slot:')) {
      const rest = mode.slice('slot:'.length)
      const cut = rest.lastIndexOf('#')
      const parentKey = cut >= 0 ? rest.slice(0, cut) || null : null
      const side = rest.slice(cut + 1)
      if (side === 'docked-left' || side === 'docked-right' || side === 'docked-bottom') {
        placeIntoSlot(id, parentKey, side)
      }
      return
    }
    if (mode.startsWith('container:')) {
      dropIntoContainer(id, Number(mode.slice('container:'.length)), nearId, after)
      return
    }
    if (mode === 'center' || mode === 'docked-left' || mode === 'docked-right' || mode === 'docked-bottom' || mode === 'float' || mode === 'max') {
      setShellViewMode([id], mode)
      if (mode !== 'float') {
        const last = !nearId
          ? [...entries].reverse().find((e) => e.id !== id && e.id !== `container:${id}` && (viewModes[e.id] || 'center') === mode)
          : undefined
        moveShellNear(id, nearId ?? last?.id, nearId ? after : true)
      }
    }
  }, [entries, moveShellNear, setShellViewMode, dropIntoContainer, placeIntoSlot, viewModes])

  // Resize a docked container by dragging the divider next to it.
  const beginDockResize = useCallback((side: 'left' | 'right' | 'bottom', e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const start = dockSizes[side]
    const horizontal = side !== 'bottom'
    const span = (e.currentTarget.parentElement?.getBoundingClientRect()[horizontal ? 'width' : 'height']) || 1
    const move = (ev: PointerEvent) => {
      const delta = (horizontal ? ev.clientX - sx : ev.clientY - sy) / span * 100
      const raw = side === 'right' || side === 'bottom' ? start - delta : start + delta
      setDockSizes((prev) => ({ ...prev, [side]: Math.max(15, Math.min(65, raw)) }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [dockSizes])

  // Drag a tab or a docked header onto one of the visible drop handles.
  const beginModeDrag = useCallback((id: string, e: ReactPointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    const sx = e.clientX
    const sy = e.clientY
    let active = false
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    const move = (ev: PointerEvent) => {
      if (active) return
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return
      active = true
      setModeDrag(id)
      if (debug) logDragDrop('start', { id })
    }
    const up = (ev: PointerEvent) => {
      cleanup()
      if (!active) return
      // Use elementFromPoint first, then fallback to bounding rect scan
      // when pointerEvents:none blocks hit testing (floating containers during drag)
      let el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      if (!el) {
        const all = document.querySelectorAll('[data-reorder-id]') as NodeListOf<HTMLElement>
        for (let i = 0; i < all.length; i++) {
          const r = all[i].getBoundingClientRect()
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            el = all[i]
            break
          }
        }
      }

      // Check if dropped on an individual tab — allows inserting at a specific
      // position within another container's tab strip.
      const tabEl = el?.closest('[data-reorder-id]') as HTMLElement | null
      if (tabEl) {
        const nearId = tabEl.dataset.reorderId
        // Find the parent container's drop mode (e.g. "container:1", "center", etc.)
        const dropModeEl = tabEl.closest('[data-drop-mode]') as HTMLElement | null
        const mode = dropModeEl?.getAttribute('data-drop-mode') || null
        if (debug) logDragDrop('drop-tab', { id, nearId, mode, el: el?.tagName, elClass: el?.className })
        if (mode && nearId) {
          // Determine whether to insert before or after the target tab
          // based on mouse position relative to the tab's center.
          const rect = tabEl.getBoundingClientRect()
          const after = ev.clientX > rect.left + rect.width / 2
          dropViewMode(id, mode, nearId, after)
          return
        }
      }

      // Otherwise check for container boundary drop handles.
      const mode = el?.closest('[data-drop-mode]')?.getAttribute('data-drop-mode') || null
      if (debug) logDragDrop('drop', { id, mode, el: el?.tagName, elClass: el?.className, elDataDropMode: el?.dataset?.dropMode })
      if (mode) dropViewMode(id, mode)
      else setModeDrag(null)
    }
    const cancel = () => {
      cleanup()
      setModeDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }, [dropViewMode, debug])

  // Reset view restores the fresh-install layout: every open tab is closed,
  // optional views are hidden, and per-tab modes/locks/positions are cleared.
  // Terminal sessions keep running (just hidden) so a layout reset never kills
  // a process.
  const resetView = useCallback(() => {
    setTabs([])
    setActiveTab(null)
    setVisible({ ...DEFAULT_VISIBLE })
    setViewModes({})
    setFloatGeom({})
    setLockedShells([])
    setTabOrder([])
    setFileIds([1])
    setActiveFileId(1)
    nextFileId.current = 2
    setActiveShell('files:1')
    setApiIds([])
    setActiveApiId(0)
    nextApiId.current = 1
    setSearchIds([])
    setActiveSearchId(0)
    nextSearchId.current = 1
    setLogIds([])
    setActiveLogId(0)
    nextLogId.current = 1
    setContainers([{ id: 1, visible: false }])
    setContainerOf({})
    setContainerActive({})
    setDockSizes({ left: 32, right: 32, bottom: 30 })
    containerIdRef.current = 2
    setFloatingTerminals(false)
    setTermFullscreen(false)
    setMdPreviewPaths(new Set())
    terminalsApi.resetTerminals()
    setMenuOpen(false)
  }, [terminalsApi])

  // Flatten layout — collect all tabs from nested containers (floating, left,
  // bottom, right) and append them to the main container's tab list, then
  // remove the empty containers. Useful on mobile where nested containers
  // waste space.
  const flattenLayout = useCallback(() => {
    // Find all entries that are in non-main containers
    const nestedEntries = entries.filter((e) => {
      const containerKey = containerOf[e.id]
      if (!containerKey) return false // already in main container
      return true
    })

    if (nestedEntries.length === 0) return

    // Remove all container mappings for these entries (they go to main)
    setContainerOf((prev) => {
      const next = { ...prev }
      for (const e of nestedEntries) delete next[e.id]
      return next
    })

    // Remove all viewModes for nested containers and floating entries
    setViewModes((prev) => {
      const next = { ...prev }
      for (const c of containers) {
        if (c.id !== 1) delete next[`container:${c.id}`]
      }
      for (const e of nestedEntries) {
        if (e.kind && !e.filePath && !e.webPath && !e.fileId && !e.termId && !e.apiId && !e.searchId && !e.logId) {
          delete next[`view:${e.kind}`]
        }
      }
      return next
    })

    // Remove floatGeom for all floating containers
    setFloatGeom((prev) => {
      const next = { ...prev }
      for (const c of containers) {
        if (c.id !== 1) delete next[`container:${c.id}`]
      }
      return next
    })

    // Clear containerActive for removed containers
    setContainerActive((prev) => {
      const next = { ...prev }
      for (const c of containers) {
        if (c.id !== 1) delete next[c.id]
      }
      return next
    })

    // Remove all nested containers
    setContainers((prev) => prev.filter((c) => c.id === 1))

    // Make sure the kinds of moved entries are visible
    setVisible((prev) => {
      const next = { ...prev }
      for (const e of nestedEntries) {
        if (e.kind) next[e.kind] = true
      }
      return next
    })

    setMenuOpen(false)
  }, [entries, containers, containerOf])

  const forgetShellMapping = useCallback((id: string) => {
    setContainerOf((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setContainerActive((prev) => {
      if (!Object.values(prev).includes(id)) return prev
      const next = { ...prev }
      for (const [cid, active] of Object.entries(next)) if (active === id) delete next[Number(cid)]
      return next
    })
  }, [])

  const closeShell = useCallback((id: string) => {
    if (lockedShells.includes(id)) return
    const e = entries.find((x) => x.id === id)
    if (!e) return
    if (e.kind !== 'container') forgetShellMapping(id)
    if (e.filePath) { closeTab(e.filePath); return }
    if (e.webPath) { closeTab(e.webPath); return }
    if (e.fileId != null) {
      const next = fileIds.filter((x) => x !== e.fileId)
      setFileIds(next)
      if (next.length === 0) setVisible((v) => ({ ...v, files: false }))
      return
    }
    if (e.apiId != null) { setApiIds((prev) => prev.filter((x) => x !== e.apiId)); return }
    if (e.searchId != null) { setSearchIds((prev) => prev.filter((x) => x !== e.searchId)); return }
    if (e.logId != null) { setLogIds((prev) => prev.filter((x) => x !== e.logId)); return }
    if (e.containerId != null) {
      setContainers((prev) => prev.map((c) => (c.id === e.containerId ? { ...c, visible: false } : c)))
      return
    }
    if (e.termId != null) { terminalsApi.closeTerminal(e.termId, () => setVisible(v => ({ ...v, terminals: false }))); return }
    setVisible((v) => ({ ...v, [e.kind]: false }))
  }, [entries, closeTab, terminalsApi, lockedShells, forgetShellMapping, fileIds])

  const closeSelectedShells = useCallback((ids: string[], includeLocked = false) => {
    const closeFileIds = new Set<number>()
    for (const id of ids) {
      if (!includeLocked && lockedShells.includes(id)) continue
      const e = entries.find((x) => x.id === id)
      if (!e) continue
      if (e.kind !== 'container') forgetShellMapping(id)
      if (e.filePath) closeTab(e.filePath)
      else if (e.webPath) closeTab(e.webPath)
      else if (e.fileId != null) closeFileIds.add(e.fileId)
      else if (e.apiId != null) setApiIds((prev) => prev.filter((x) => x !== e.apiId))
      else if (e.searchId != null) setSearchIds((prev) => prev.filter((x) => x !== e.searchId))
      else if (e.logId != null) setLogIds((prev) => prev.filter((x) => x !== e.logId))
      else if (e.containerId != null) setContainers((prev) => prev.map((c) => (c.id === e.containerId ? { ...c, visible: false } : c)))
      else if (e.termId != null) terminalsApi.closeTerminal(e.termId, () => setVisible(v => ({ ...v, terminals: false })))
      else setVisible((v) => ({ ...v, [e.kind]: false }))
    }
    if (closeFileIds.size > 0) {
      const next = fileIds.filter((x) => !closeFileIds.has(x))
      setFileIds(next)
      if (next.length === 0) setVisible((v) => ({ ...v, files: false }))
    }
  }, [entries, closeTab, terminalsApi, lockedShells, forgetShellMapping, fileIds])

  // hideSelectedShells hides the given tabs by toggling their visibility off
  // instead of closing them — the layout position is preserved.
  const hideSelectedShells = useCallback((ids: string[]) => {
    const kindsToHide = new Set<string>()
    for (const id of ids) {
      const e = entries.find((x) => x.id === id)
      if (!e) continue
      if (e.kind === 'file') {
        // For file tabs, hide by setting the kind's visibility — but files
        // are individual tabs, so we hide the whole "files" view if all
        // selected are files, or we just hide the specific file's kind.
        // Since files share the "files" kind, we hide the files view.
        kindsToHide.add('files')
      } else if (e.kind === 'term') {
        kindsToHide.add('terminals')
      } else {
        kindsToHide.add(e.kind)
      }
    }
    setVisible((v) => {
      const next = { ...v }
      for (const kind of kindsToHide) next[kind] = false
      return next
    })
  }, [entries])

  const reorderShell = useCallback((from: string, to: string, after = false) => {
    setTabOrder((prev) => {
      const ids = entries.map((e) => e.id)
      const base = [...new Set([...prev.filter((id) => ids.includes(id)), ...ids])]
      const a = base.indexOf(from)
      const b = base.indexOf(to)
      if (a < 0 || b < 0 || a === b) return prev
      const next = base.slice()
      const [moved] = next.splice(a, 1)
      const insertAt = after ? b + 1 : b
      next.splice(insertAt, 0, moved)
      return next
    })
  }, [entries])

  // ── Global keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setShowCommandPalette((v) => !v)
      }
      // Cmd/Ctrl+P — Quick Open (fuzzy file finder).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setShowQuickOpen((v) => !v)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        showView('search')
      }
      // Ctrl+G — go to line (only when an editor tab is active; let the editor
      // keymap handle it when the editor has focus; this catches the case where
      // focus is outside the editor, e.g. in the sidebar).
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === 'g') {
        if (activeTab) {
          e.preventDefault()
          editorActionsRef.current?.goToLine()
        }
      }
      // Ctrl/Cmd+B — toggle the explorer (VS Code parity)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setVisible((v) => ({ ...v, files: !v.files }))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, showView])

  // Ctrl/Cmd+W — close active tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') {
        // Close the active flat tab (file, web, API, terminal or a whole view).
        if (activeShell) {
          e.preventDefault()
          closeShell(activeShell)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeShell, closeShell])

  // ── Save All modified tabs ──
  const saveAll = useCallback(async () => {
    const modifiedTabs = tabs.filter((t) => t.modified && t.type !== 'browser')
    await Promise.all(modifiedTabs.map(async (tab) => {
      try {
        await authFetch(workspaceUrl(tab.workspaceId as string, '/files/write'), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: tab.rel, content: tab.content }),
        })
        setTabs((prev) => prev.map((t) =>
          t.path === tab.path ? { ...t, originalContent: t.content, modified: false } : t
        ))
      } catch { /* ignore */ }
    }))
  }, [tabs, authFetch])

  // ── Git stage/unstage all via command palette ──
  // Both previously had no try/catch — invoked as onGitStageAll={gitStageAll}
  // (a fire-and-forget command-palette action), a 401 or network error would
  // reject silently with no feedback at all: nothing in the UI shows staging
  // failed, unlike saveFile where a failed save leaves the modified dot lit.
  const gitStageAll = useCallback(async () => {
    try {
      await authFetch('/api/git/stage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      })
    } catch {
      alert('Failed to stage all — check your connection and try again.')
    }
  }, [authFetch])

  const gitUnstageAll = useCallback(async () => {
    try {
      await authFetch('/api/git/unstage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      })
    } catch {
      alert('Failed to unstage all — check your connection and try again.')
    }
  }, [authFetch])

  // ── Open a web view tab ──
  const openBrowser = useCallback((url = 'https://wede.vulos.org') => addWeb(url), [addWeb])

  // Open the git graph + commit history as a flat code tab (VS Code-style).
  const openGitGraph = useCallback(() => {
    const existing = tabs.find((t) => t.type === 'gitgraph')
    if (existing) {
      setVisible((v) => ({ ...v, code: true }))
      setActiveTab(existing.path)
      setActiveShell(`file:${existing.path}`)
      return
    }
    const id = 'gitgraph:1'
    setTabs((prev) => [...prev, { path: id, name: 'Git Graph', type: 'gitgraph', content: '', originalContent: '', modified: false }])
    setVisible((v) => ({ ...v, code: true }))
    setActiveTab(id)
    setActiveShell(`file:${id}`)
  }, [tabs])

  // Open another API client instance (flat tab, like terminals).
  const openApiClient = useCallback(() => addApi(), [addApi])

  // Capture link clicks → open in preview browser
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const a = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href')
      if (!href) return
      // Let explicit external links / downloads / modified clicks use the real
      // browser instead of being hijacked into the in-app preview iframe.
      if (a.target === '_blank' || a.hasAttribute('download') ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      if (href.startsWith('http://') || href.startsWith('https://')) {
        e.preventDefault()
        e.stopPropagation()
        openBrowser(href)
      }
    }
    document.addEventListener('click', handler, true)
    document.addEventListener('auxclick', handler, true)
    return () => {
      document.removeEventListener('click', handler, true)
      document.removeEventListener('auxclick', handler, true)
    }
  }, [openBrowser])

  // Remove a folder root from the workspace: close its open tabs, then close the
  // backend workspace. Never closes the last remaining root.
  const handleCloseWorkspace = useCallback(async (id: string) => {
    if (!workspacesApi?.closeWorkspace) return
    if ((workspacesApi.workspaces || []).length <= 1) return
    setTabs((prev) => prev.filter((t) => t.workspaceId !== id))
    setActiveTab((cur) => (parseFileKey(cur || '').workspaceId === id ? null : cur))
    try { await workspacesApi.closeWorkspace(id) } catch { /* ignore */ }
  }, [workspacesApi])

  // openFile opens (or focuses) a real tab. Single clicks accumulate tabs; the
  // preview model is gone so browsing a folder does not replace the previous file.
  // `targetSelection: null` explicitly clears a previously-applied follow
  // selection (the followed peer collapsed their selection); `undefined` means
  // "leave whatever is there", which is what ordinary navigation passes.
  const openFile = useCallback(async (entry: FileEntry, { preview = false, activate = true, targetLine, targetSelection, targetPdf, targetImage }: {
    preview?: boolean
    activate?: boolean
    targetLine?: number
    targetSelection?: Tab['targetSelection'] | null
    targetPdf?: Tab['targetPdf']
    targetImage?: Tab['targetImage']
  } = {}) => {
    if (entry.isDir) return false
    // Entries from the file tree carry {workspaceId, rel}; entries from search /
    // quick-open (which target the active workspace) carry only {path} — default
    // those to the active workspace.
    const wsId = entry.workspaceId || workspaceId
    const rel = entry.rel ?? entry.path
    const name = entry.name || rel.split('/').pop()
    const key = fileKey(wsId, rel)
    const shouldActivate = activate
    const existing = tabs.find((t) => t.path === key)
    if (existing) {
      const hasTarget = targetLine != null || targetSelection !== undefined || targetPdf != null || targetImage != null
      if ((!preview && existing.preview) || hasTarget || existing.hidden) {
        setTabs((prev) => prev.map((t) => {
          if (t.path !== key) return t
          const next = { ...t }
          if (!preview) next.preview = false
          if (t.hidden) next.hidden = false
          if (targetLine != null) next.targetLine = targetLine
          if (targetSelection === null) next.targetSelection = undefined
          else if (targetSelection != null) next.targetSelection = targetSelection
          if (targetPdf != null) next.targetPdf = targetPdf
          if (targetImage != null) next.targetImage = targetImage
          // Re-clicking the same location must still reveal it.
          if (hasTarget) next.targetSeq = (t.targetSeq || 0) + 1
          return next
        }))
      }
      setVisible((v) => ({ ...v, code: true }))
      if (shouldActivate) {
        setActiveTab(key)
        setActiveShell(`file:${key}`)
      }
      return false
    }
    try {
      const res = await authFetch(workspaceUrl(wsId as string, `/files/read?path=${encodeURIComponent(rel)}`))
      const data: FileReadResponse = await res.json()
      const tab: Tab = {
        path: key, rel, workspaceId: wsId, name, preview,
        content: data.content || '', originalContent: data.content || '', modified: false,
      }
      if (targetLine != null) tab.targetLine = targetLine
      if (targetSelection != null) tab.targetSelection = targetSelection
      if (targetPdf != null) tab.targetPdf = targetPdf
      if (targetImage != null) tab.targetImage = targetImage
      if (targetLine != null || targetSelection != null || targetPdf != null || targetImage != null) tab.targetSeq = 1
      if (data.fileType === 'image') {
        tab.fileType = 'image'
        tab.dataUrl = data.dataUrl
      } else if (data.fileType === 'binary') {
        tab.fileType = 'binary'
        tab.size = data.size
      } else if (data.fileType === 'pdf') {
        tab.fileType = 'pdf'
        tab.size = data.size
      } else if (data.fileType === 'video') {
        tab.fileType = 'video'
        tab.size = data.size
      }
      setTabs((prev) => [...prev, tab])
      setVisible((v) => ({ ...v, code: true }))
      if (shouldActivate) {
        setActiveTab(key)
        setActiveShell(`file:${key}`)
      }
      return true
    } catch { /* ignore */ }
    return false
  }, [tabs, authFetch, workspaceId])

  // Open a tab listed in the session-tabs panel in the current view. Hidden
  // local tabs are revealed by openFile instead of being duplicated.
  const openTabFromSessionPanel = useCallback((t: { path?: string; rel?: string; workspaceId?: string | null; name?: string; type?: string }) => {
    if (t.type) return
    const parsed = parseFileKey(t.path)
    const rel = t.rel ?? parsed.rel
    const wsId = t.workspaceId ?? parsed.workspaceId ?? workspaceId
    if (!rel) return
    void openFile({ path: rel, rel, workspaceId: wsId, name: t.name })
  }, [openFile, workspaceId])

  // Clicking a collaborator's semantic cursor opens the target tab and, for
  // code, moves the local caret to the exact line/column.
  const jumpToCollabPointer = useCallback((pointer: CollabPointer) => {
    const parsed = parseFileKey(pointer.tab)
    if (!parsed.rel) return
    const targetWorkspaceId = parsed.workspaceId || workspaceId
    if (pointer.kind === 'code') {
      void openFile(
        { path: parsed.rel, rel: parsed.rel, workspaceId: targetWorkspaceId },
        {
          targetLine: pointer.line,
          targetSelection: {
            anchorLine: pointer.line, anchorCol: pointer.col,
            headLine: pointer.line, headCol: pointer.col,
          },
        },
      )
      return
    }
    if (pointer.kind === 'pdf') {
      void openFile(
        { path: parsed.rel, rel: parsed.rel, workspaceId: targetWorkspaceId },
        { targetPdf: { page: pointer.page, u: pointer.u, v: pointer.v } },
      )
      return
    }
    if (pointer.kind === 'image') {
      void openFile(
        { path: parsed.rel, rel: parsed.rel, workspaceId: targetWorkspaceId },
        { targetImage: { u: pointer.u, v: pointer.v } },
      )
      return
    }
    void openFile({ path: parsed.rel, rel: parsed.rel, workspaceId: targetWorkspaceId })
  }, [openFile, workspaceId])

  // LSP go-to-definition can point at another file. Map the file:// URI back to
  // one of the open workspace roots, then open/focus that tab at the target.
  const openDefinition = useCallback((uri: string, line: number, col: number) => {
    if (!uri.startsWith('file://')) return
    const abs = decodeURIComponent(uri.slice('file://'.length))
    const roots = (workspacesApi?.workspaces || [])
      .map((w) => ({ id: w.id, root: (w.root || '').replace(/\/+$/, '') }))
      .filter((w) => w.root)
      .sort((a, b) => b.root.length - a.root.length)
    const match = roots.find((w) => abs === w.root || abs.startsWith(w.root + '/'))
    const wsId = match?.id || workspaceId
    const root = match?.root || (workspace || '').replace(/\/+$/, '')
    if (!wsId || !root || !abs.startsWith(root + '/')) return
    const rel = abs.slice(root.length + 1)
    if (!rel) return
    void openFile(
      { path: rel, rel, workspaceId: wsId, name: rel.split('/').pop(), isDir: false },
      { targetSelection: { anchorLine: line, anchorCol: col, headLine: line, headCol: col } },
    )
  }, [workspacesApi?.workspaces, workspace, workspaceId, openFile])

  const lastFollowKeyRef = useRef('')
  const followOpenedRef = useRef<Map<string, Set<string>>>(new Map())
  useEffect(() => {
    if (!effectiveFollowId || !effectiveFollowMode) {
      lastFollowKeyRef.current = ''
      return
    }
    const target = collabRoster.find((m) => m.id === effectiveFollowId)
    if (!target) return
    const mode = effectiveFollowMode
    if (mode === 'open') {
      const list = target.tabs?.length ? target.tabs : target.file ? [target.file] : []
      const key = `${effectiveFollowId}:open:${JSON.stringify(list)}`
      if (lastFollowKeyRef.current === key) return
      lastFollowKeyRef.current = key
      const wanted = new Set(list)
      let tracked = followOpenedRef.current.get(effectiveFollowId)
      if (!tracked) {
        tracked = new Set()
        followOpenedRef.current.set(effectiveFollowId, tracked)
      }
      // Mirror the target's closes for tabs this follow opened. Never close a
      // tab the user modified or locked.
      for (const path of Array.from(tracked)) {
        const rel = parseFileKey(path).rel
        if (rel && wanted.has(rel)) continue
        tracked.delete(path)
        const local = tabs.find((t) => t.path === path)
        if (local && !local.modified && !local.locked) closeTab(path)
      }
      for (const rel of list) {
        const path = fileKey(workspaceId, rel)
        if (tabs.some((t) => t.path === path)) continue
        const fid = effectiveFollowId
        void openFile({ path: rel, rel, workspaceId }, { activate: false }).then((created) => {
          if (created) followOpenedRef.current.get(fid)?.add(path)
        })
      }
      return
    }
    if (!target.file) return
    const { line, selection: sel } = followTargetFromPeer(target)
    const selKey = targetSelectionKey(sel)
    // Live pointers carry page/point detail for PDFs and images; use it so the
    // follower reveals the same location instead of just the page top.
    const peerPointer = collabPointers[effectiveFollowId]
    const pointerKey = peerPointer && peerPointer.kind !== 'code' && peerPointer.tab === target.file
      ? `${peerPointer.kind}:${JSON.stringify(peerPointer)}`
      : ''
    const key = `${effectiveFollowId}:live:${target.file}:${line}:${selKey}:${pointerKey}`
    if (lastFollowKeyRef.current === key) return
    lastFollowKeyRef.current = key
    // `sel ?? null` is deliberate: when the followed peer collapses their
    // selection we must CLEAR ours, not leave the previous range highlighted.
    void openFile(
      { path: target.file, rel: target.file, workspaceId },
      {
        activate: true,
        targetLine: line,
        targetSelection: sel ?? null,
        targetPdf: peerPointer?.kind === 'pdf' && peerPointer.tab === target.file
          ? { page: peerPointer.page, u: peerPointer.u, v: peerPointer.v }
          : undefined,
        targetImage: peerPointer?.kind === 'image' && peerPointer.tab === target.file
          ? { u: peerPointer.u, v: peerPointer.v }
          : undefined,
      },
    )
  }, [effectiveFollowId, effectiveFollowMode, collabRoster, collabPointers, openFile, workspaceId, tabs, closeTab])

  useEffect(() => {
    if (!followTargetId) return
    if (collabRoster.some((m) => m.id === followTargetId)) return
    setFollowTargetId(null)
    setFollowMode(null)
    lastFollowKeyRef.current = ''
  }, [collabRoster, followTargetId])

  // Drop the peer's selection when live following stops (manual unfollow, the
  // followed member leaving, or switching to "open" mode). The selection is
  // stored on the tab, so leaving it behind makes the editor re-apply a stale
  // range every time the tab remounts.
  useEffect(() => {
    if (effectiveFollowMode === 'live') return
    setTabs((prev) => {
      if (!prev.some((t) => t.targetSelection != null)) return prev
      return prev.map((t) => (t.targetSelection != null ? { ...t, targetSelection: undefined } : t))
    })
  }, [effectiveFollowMode])

  const updateContent = useCallback((key: string, newContent: string) => {
    setTabs((prev) => prev.map((t) => {
      if (t.path !== key) return t
      const modified = newContent !== t.originalContent
      if (modified) triggerAutoSave({ ...t, content: newContent }, newContent)
      // Editing pins the tab (leaves preview mode), like VS Code.
      return { ...t, content: newContent, modified, preview: modified ? false : t.preview }
    }))
  }, [triggerAutoSave])

  const FORMAT_EXTS = new Set(['go', 'js', 'jsx', 'ts', 'tsx', 'css', 'json', 'html', 'md', 'py'])

  interface FormatResponse {
    formatted?: boolean
    content?: string
  }

  const formatCurrentFile = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activeTab)
    if (!tab || tab.type === 'browser') return
    const ext = (tab.name || '').split('.').pop()!.toLowerCase()
    if (!FORMAT_EXTS.has(ext)) return
    try {
      const res = await authFetch(workspaceUrl(tab.workspaceId as string, '/files/format'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.rel, content: tab.content }),
      })
      if (!res.ok) return
      const data: FormatResponse = await res.json()
      if (data.formatted && data.content !== tab.content) {
        setTabs((prev) => prev.map((t) =>
          t.path === tab.path ? { ...t, content: data.content, modified: data.content !== t.originalContent } : t
        ))
      }
    } catch { /* ignore — format failure should not block save */ }
  }, [tabs, activeTab, authFetch]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveFile = useCallback(async (key: string | null = activeTab) => {
    const tab = tabs.find((t) => t.path === key)
    if (!tab?.modified || tab.type === 'browser') return
    // Format on save — run before writing so the formatted content is persisted.
    if (editorSettings.formatOnSave) {
      const ext = (tab.name || '').split('.').pop()!.toLowerCase()
      if (FORMAT_EXTS.has(ext)) {
        try {
          const res = await authFetch(workspaceUrl(tab.workspaceId as string, '/files/format'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: tab.rel, content: tab.content }),
          })
          if (res.ok) {
            const data: FormatResponse = await res.json()
            if (data.formatted && data.content !== tab.content) {
              setTabs((prev) => prev.map((t) =>
                t.path === tab.path ? { ...t, content: data.content, modified: data.content !== t.originalContent } : t
              ))
              // Re-read the (now updated) tab for the write below.
              // We use a local variable so we don't need to wait for state flush.
              setSaving(true)
              try {
                await authFetch(workspaceUrl(tab.workspaceId as string, '/files/write'), {
                  method: 'PUT', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: tab.rel, content: data.content }),
                })
                setTabs((prev) => prev.map((t) =>
                  t.path === tab.path ? { ...t, originalContent: data.content, modified: false } : t
                ))
              } catch { /* ignore */ }
              setSaving(false)
              return
            }
          }
        } catch { /* ignore — fall through to normal save */ }
      }
    }
    setSaving(true)
    try {
      await authFetch(workspaceUrl(tab.workspaceId as string, '/files/write'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.rel, content: tab.content }),
      })
      setTabs((prev) => prev.map((t) =>
        t.path === tab.path ? { ...t, originalContent: t.content, modified: false } : t
      ))
    } catch { /* ignore */ }
    setSaving(false)
  }, [tabs, activeTab, authFetch, editorSettings.formatOnSave]) // eslint-disable-line react-hooks/exhaustive-deps

  const currentTab = tabs.find((t) => t.path === activeTab)
  const hasModified = tabs.some((t) => t.modified)

  // Multi-root: the "active workspace" (which scopes git status, search, LSP,
  // collab, terminals and the SSE watcher) follows the focused file's root, so
  // those panels always reflect the folder you're editing in.
  //
  // Keyed off the tab's OWN workspace changing (via a ref), not off workspaceId,
  // so a manual switch in the WorkspaceSwitcher isn't immediately reverted — the
  // switch stands until you focus a file in a different root.
  const setActiveWorkspaceId = workspacesApi?.setActiveWorkspaceId
  const knownWorkspaces = workspacesApi?.workspaces
  const lastTabWsRef = useRef<string | null>(null)
  useEffect(() => {
    const wsId = currentTab?.workspaceId
    if (wsId && wsId !== lastTabWsRef.current) {
      lastTabWsRef.current = wsId
      // Only follow to a workspace that still exists — a tab restored for a
      // since-closed root must not repoint the active id to a dead workspace.
      const known = (knownWorkspaces || []).some((w) => w.id === wsId)
      if (known && wsId !== workspaceId && setActiveWorkspaceId) setActiveWorkspaceId(wsId)
    }
  }, [currentTab?.workspaceId, workspaceId, setActiveWorkspaceId, knownWorkspaces])

  // Copy file path(s) with cursor location to clipboard.
  // Format: ~/foo.txt:20:17 (multiple paths joined by newlines).
  // Falls back to a temporary textarea when navigator.clipboard is unavailable
  // (e.g. on non-HTTPS origins where the Clipboard API is blocked).
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
      return
    }
    fallbackCopy(text)
  }
  const fallbackCopy = (text: string) => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch {}
    document.body.removeChild(ta)
  }

  const copyTabLocation = useCallback((shellIds: string[]) => {
    const lines: string[] = []
    for (const shellId of shellIds) {
      if (!shellId.startsWith('file:')) continue
      const tabPath = shellId.slice(5)
      const tab = tabs.find((t) => t.path === tabPath)
      if (!tab || tab.type || !tab.rel) continue
      const root = (knownWorkspaces || []).find((w) => w.id === tab.workspaceId)?.root
        || (tab.workspaceId === workspaceId ? workspace : null)
      const isActive = tab.path === activeTab
      const text = formatTabLocation({
        root,
        rel: tab.rel,
        home,
        line: isActive ? cursor.line : undefined,
        col: isActive ? cursor.col : undefined,
      })
      if (text) lines.push(text)
    }
    if (lines.length > 0) copyToClipboard(lines.join('\n'))
  }, [tabs, activeTab, cursor.line, cursor.col, knownWorkspaces, workspaceId, workspace, home])

  // LSP — provides diagnostics + hover for supported languages.
  // Degrades gracefully when language server binaries are not installed.
  const { extension: lspExtension, available: lspAvailable } = useLSP({
    // LSP identifies the document by relative path within the active workspace,
    // so hand it the rel path (not the composite tab key).
    file: currentTab ? { ...currentTab, path: currentTab.rel ?? '' } : null,
    token,
    authFetch,
    lspEnabled: editorSettings.lsp ?? true,
    workspaceId,
    workspaceRoot: wsRoot || undefined,
  })

  // Collaborative editing for the active text file (CRDT via the doc WS).
  // Gated on a workspace + a text file (no browser/image/binary) and the `collab`
  // setting. DEFAULT OFF: the full path (provider connect + y-protocols sync +
  // disk write-back) hasn't been verified against a live server yet, and a failed
  // connection would hide on-disk content. Opt in via editorSettings.collab=true;
  // a Settings toggle + live verification land in Wave 7. Single-user editing is
  // the safe default and is completely unaffected when this is off.
  const collabEnabled = (editorSettings.collab ?? false)
  const collabPath = (collabEnabled && currentTab && !currentTab.type && currentTab.fileType == null)
    ? currentTab.rel
    : null
  const collab = useYDoc({ workspaceId, path: collabPath, token, username, color: colorFromName(username) })

  // Live multiplayer cursors — publish a semantic location (code line/col,
  // image point, PDF page point) so peers can place it correctly on any layout.
  const shareCursors = (editorSettings.shareCursors ?? true)
  const lastPointerKeyRef = useRef('')
  const heldTouchRef = useRef(false)
  const lastPointerTargetRef = useRef<CollabPointer | null>(null)
  useEffect(() => {
    if (!shareCursors) { sendPointer(null); return undefined }
    let clearTimer: ReturnType<typeof setTimeout> | null = null
    const clearSoon = (ms: number) => {
      if (clearTimer) clearTimeout(clearTimer)
      clearTimer = setTimeout(() => {
        clearTimer = null
        lastPointerKeyRef.current = ''
        sendPointer(null)
      }, ms)
    }
    const publish = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const pane = target?.closest<HTMLElement>('[data-collab-tab]')
      if (!pane) {
        if (e.pointerType !== 'touch') clearSoon(80)
        return
      }
      const pointer = encodeCollabPointer(pane, e.clientX, e.clientY, target)
      if (!pointer) {
        if (e.pointerType !== 'touch') clearSoon(80)
        return
      }
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
      const key = JSON.stringify(pointer)
      if (key === lastPointerKeyRef.current) return
      lastPointerKeyRef.current = key
      lastPointerTargetRef.current = pointer
      heldTouchRef.current = e.pointerType === 'touch' || e.pointerType === 'pen'
      sendPointer(pointer)
    }
    const clearTouch = () => {
      if (!heldTouchRef.current) return
      heldTouchRef.current = false
      lastPointerKeyRef.current = ''
      lastPointerTargetRef.current = null
      sendPointer(null)
    }
    const onMove = (e: PointerEvent) => publish(e)
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') publish(e)
    }
    // Touch/pen pointers persist after lift so the peer can still see where the
    // finger was; they clear on the next tab switch or once the location has
    // scrolled out of its pane.
    const onScroll = () => {
      if (!heldTouchRef.current) return
      const target = lastPointerTargetRef.current
      const decoded = target ? decodeCollabPointer(target) : null
      if (!decoded || decoded.offscreen) clearTouch()
    }
    const onOut = (e: PointerEvent) => {
      // A lifted touch fires pointerout with relatedTarget=null. Keep the
      // published touch point until the tab changes or the pane scrolls.
      if (heldTouchRef.current) return
      if (e.relatedTarget) return
      lastPointerKeyRef.current = ''
      lastPointerTargetRef.current = null
      sendPointer(null)
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerout', onOut, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerout', onOut, true)
      window.removeEventListener('scroll', onScroll, true)
      if (clearTimer) clearTimeout(clearTimer)
      heldTouchRef.current = false
      lastPointerTargetRef.current = null
      sendPointer(null)
    }
  }, [shareCursors, sendPointer, activeTab])

  // Render one tab's editor/content. Defaults to the active tab; a floating
  // window passes its own tab so several floats can show different files.
  const renderTabContent = (tabArg?: Tab | null): ReactNode => {
    const editable = role !== 'viewer'
    const tab = tabArg ?? currentTab
    if (!tab) {
      return <Editor file={null} content={null} onChange={() => {}} onSave={() => {}} settings={editorSettings} editable={editable} />
    }
    const isActive = tab.path === activeTab
    const tabRel = parseFileKey(tab.path).rel
    const tabAbs = absPath(tabRel)
    const tabStopLine = (dap.stopLine && tabRel &&
      (dap.stopLine.path === tabAbs || dap.stopLine.path?.endsWith('/' + tabRel)))
      ? dap.stopLine.line : null
    if (tab.type === 'browser') {
      return (
        <Browser
          url={tab.url}
          onUrlChange={(newUrl) => {
            setTabs((prev) => prev.map((t) =>
              t.path === tab.path ? { ...t, url: newUrl, name: urlToName(newUrl) } : t
            ))
          }}
        />
      )
    }
    if (tab.type === 'apiclient') {
      return <ApiClient api={apiClient} authFetch={authFetch} readOnly={role === 'viewer'} />
    }
    if (tab.type === 'gitgraph') {
      return <GitGraphView authFetch={authFetch} readOnly={role === 'viewer'} />
    }
    const tabWsId = tab.workspaceId || workspaceId
    const mediaHref = tabRel && tabWsId ? rawFileUrl(tabWsId, tabRel, token) : undefined
    if (tab.fileType === 'image') {
      return <ImagePreview key={tab.path} dataUrl={tab.dataUrl} filename={tab.name} size={tab.size} href={mediaHref} focus={tab.targetImage} focusSeq={tab.targetSeq} />
    }
    if (tab.fileType === 'pdf') {
      return <PdfPreview href={mediaHref} filename={tab.name} size={tab.size} forceEmbed={!!presenter || effectiveFollowMode === 'live'} target={tab.targetPdf ? { ...tab.targetPdf, seq: tab.targetSeq } : undefined} />
    }
    if (tab.fileType === 'video') {
      return <VideoPreview href={mediaHref} filename={tab.name} size={tab.size} />
    }
    if (tab.fileType === 'binary') {
      return <BinaryNotice filename={tab.name} size={tab.size} />
    }
    const editorEl = (
      <Editor
        file={tab}
        content={tab.content ?? null}
        onChange={(c) => updateContent(tab.path, c)}
        onSave={() => { void saveFile(tab.path) }}
        onCursorChange={isActive ? setCursor : undefined}
        initialCursor={tab.id ? tabContentStates[`id:${tab.id}`] : tabContentStates[tab.path]}
        settings={editorSettings}
        lspExtension={isActive ? lspExtension : null}
        onRegisterActions={isActive ? handleRegisterEditorActions : undefined}
        onDefinition={openDefinition}
        collab={isActive ? collab : null}
        editable={editable}
        breakpoints={breakpoints[tabAbs] || []}
        onToggleBreakpoint={(ln, lines) => toggleBreakpoint(tabRel, lines)}
        stopLine={tabStopLine}
        following={effectiveFollowMode === 'live'}
      />
    )

    // Markdown: offer an Edit/Preview toggle that swaps the editor for rendered HTML.
    const isMarkdown = /\.(md|markdown)$/i.test(tab.path || '')
    if (isMarkdown) {
      const inPreview = mdPreviewPaths.has(tab.path)
      return (
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-end px-3 h-7 border-b border-border/50 bg-bg-primary shrink-0">
            <button
              onClick={() => toggleMdPreview(tab.path)}
              className="px-2 py-0.5 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
              {inPreview ? 'Edit' : 'Preview'}
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {inPreview ? <MarkdownPreview content={tab.content} /> : editorEl}
          </div>
        </div>
      )
    }

    return editorEl
  }

  // A dock slot is only offered while empty; when it already holds a
  // container, that container's own tab strip is the drop target.
  const dropSlot = (parentKey: string | null, side: ViewMode) => {
    const bottom = side === 'docked-bottom'
    const label = side === 'docked-left' ? 'Left' : side === 'docked-right' ? 'Right' : 'Bottom'
    // Nested containers get small, unobtrusive corner handles. The root keeps
    // the large edge strips because it is the primary dock target.
    if (parentKey) {
      const pos = side === 'docked-left'
        ? 'left-2 top-1/2 -translate-y-1/2'
        : side === 'docked-right'
          ? 'right-2 top-1/2 -translate-y-1/2'
          : 'bottom-2 left-1/2 -translate-x-1/2'
      return (
        <div
          data-drop-mode={`slot:${parentKey}#${side}`}
          className={`absolute z-20 w-16 h-16 rounded-lg border border-dashed border-border/70 bg-bg-elevated/80 flex items-center justify-center text-[9px] font-semibold text-text-muted/70 hover:border-accent hover:bg-accent/20 hover:text-text-primary transition-colors ${pos}`}
          title={`Dock ${label.toLowerCase()} in this container`}>
          {label}
        </div>
      )
    }
    return (
      <div
        data-drop-mode={side}
        className={`${bottom ? 'h-16 w-full shrink-0' : 'w-16 shrink-0 self-stretch'} rounded-lg border-2 border-dashed border-border bg-bg-elevated/90 flex items-center justify-center text-[11px] font-semibold text-text-secondary hover:border-accent hover:bg-accent/20 hover:text-text-primary transition-colors`}
        title={`Dock ${label.toLowerCase()} in this container`}>
        {label}
      </div>
    )
  }

  // Literal bottom-left / bottom-right drop handles. These sit inside the
  // container body so they work the same for the main container, nested
  // containers, and floating containers.
  const cornerDropSlot = (parentKey: string | null, side: 'docked-left' | 'docked-right') => {
    const label = side === 'docked-left' ? 'Left' : 'Right'
    const pos = side === 'docked-left' ? 'bottom-2 left-2' : 'bottom-2 right-2'
    return (
      <div
        key={`${parentKey ?? 'root'}-${side}-corner`}
        data-drop-mode={parentKey ? `slot:${parentKey}#${side}` : side}
        data-drop-corner={side === 'docked-left' ? 'left' : 'right'}
        className={`absolute z-30 w-14 h-14 rounded-lg border border-dashed border-border/70 bg-bg-elevated/85 flex items-center justify-center text-[9px] font-semibold text-text-muted/80 hover:border-accent hover:bg-accent/20 hover:text-text-primary transition-colors ${pos}`}
        title={`Dock ${label.toLowerCase()} in this container`}>
        {label}
      </div>
    )
  }

  const cornerDropSlots = (parentKey: string | null) => (
    <>
      {cornerDropSlot(parentKey, 'docked-left')}
      {cornerDropSlot(parentKey, 'docked-right')}
    </>
  )

  // One renderer per flat shell tab. Every tab fills the same content area;
  // there are no nested tab strips inside a view.
  const renderEntry = (e: ShellEntry): ReactNode => {
    switch (e.kind) {
      case 'files': {
        // Show only the active workspace's files, not all workspaces.
        const allWorkspaces = workspacesApi?.workspaces || []
        const activeWorkspaces = workspaceId ? allWorkspaces.filter(w => w.id === workspaceId) : allWorkspaces
        return <FileExplorer key={e.fileId} authFetch={authFetch} workspaces={activeWorkspaces} onFileSelect={(entry, opts) => { void openFile(entry, opts) }} selectedPath={activeTab} onRegisterActions={e.id === activeShell ? handleRegisterExplorerActions : undefined} onCloseWorkspace={(id) => { void handleCloseWorkspace(id) }} roster={collabRoster} showHiddenFiles={editorSettings.showHiddenFiles ?? false} />
      }
      case 'search':
        return <SearchPanel key={e.searchId} authFetch={authFetch} workspaces={workspacesApi?.workspaces || []} workspaceId={workspaceId} readOnly={role === 'viewer'} onOpenFile={(entry, line) => {
          const key = fileKey(entry.workspaceId || workspaceId, entry.rel ?? entry.path)
          void openFile(entry)
          setTimeout(() => {
            setTabs((prev) => prev.map((t) => t.path === key ? { ...t, targetLine: line } : t))
          }, 50)
        }} />
      case 'code':
      case 'web': {
        // Resolve this entry's own tab (floats render a specific file).
        const key = e.kind === 'web' ? e.webPath : e.filePath
        const tab = key ? tabs.find((t) => t.path === key) ?? null : currentTab ?? null
        return (
          <div className="h-full flex flex-col bg-bg-primary">
            {tab && tab.type !== 'browser' && tab.type !== 'apiclient' && tab.type !== 'gitgraph' && tab.fileType == null && (
              <Breadcrumbs path={tab.rel} />
            )}
            <div className="flex-1 min-h-0 relative" data-collab-tab={tab?.path || undefined}>{renderTabContent(tab)}</div>
          </div>
        )
      }
      case 'terminals':
        if (role === 'viewer') return <div className="h-full flex items-center justify-center text-[12px] text-text-muted">Terminals are disabled for viewers.</div>
        return (
          <div className={termFullscreen ? 'fixed inset-0 z-50 bg-bg-primary' : 'h-full'}>
            <TerminalPanel key={`${terminalKey}-${e.termId}`} token={token} workspaceId={workspaceId} term={terminalsApi} visible onlyId={e.termId}
              isFullscreen={termFullscreen} onToggleFullscreen={() => setTermFullscreen(!termFullscreen)}
              onPopOut={floatTerminal} />
          </div>
        )
      case 'git':
        return <GitPanels authFetch={authFetch} workspaces={workspacesApi?.workspaces || []} workspaceId={workspaceId} visible readOnly={role === 'viewer'} onOpenGraph={openGitGraph} />
      case 'chat':
        return <Chat workspaceId={workspaceId} workspaceName={(workspacesApi?.workspaces || []).find((w) => w.id === workspaceId)?.name} token={token} username={username} color={colorFromName(username)} readOnly={guest && role === 'viewer'} />
      case 'session-tabs':
        return (
          <SessionTabs
            workspaceId={workspaceId}
            authFetch={authFetch}
            collabContext={collabContext}
            currentState={tabSession.name}
            tabs={tabs}
            activeTab={activeTab}
            collabRoster={collabRoster}
            autoRefresh={editorSettings.sessionTabAutoRefresh ?? false}
            onOpenTab={(path: string) => openTabFromSessionPanel({ rel: path, path })}
            onActivateTerminal={(id: number) => {
              // If terminals container is hidden, show it first.
              setVisible((v) => (v.terminals ? v : { ...v, terminals: true }))
              terminalsApi.setActiveId(id)
              setActiveShell(`term:${id}`)
            }}
            onOpenFileWhere={(path: string, line?: number) => {
              openTabFromSessionPanel({ rel: path, path })
              if (line) {
                // Navigate to the user's line after opening
                setTimeout(() => {
                  editorActionsRef.current?.goToLine?.()
                }, 100)
              }
            }}
          />
        )
      case 'api':
        return <ApiInstance key={e.apiId} workspaceId={workspaceId} authFetch={authFetch} readOnly={role === 'viewer'} />
      case 'log':
        return <LogView key={e.logId} authFetch={authFetch} workspaceId={workspaceId} debug={debug} />
      case 'container': {
        const cid = e.containerId as number
        const ckey = `container:${cid}`
        const kids = childrenOfContainer(cid)
        const modeOf = (k: ShellEntry) => shellMode(k.id)
        const centerKids = kids.filter((k) => modeOf(k) === 'center' || modeOf(k) === 'max')
        const leftKids = kids.filter((k) => modeOf(k) === 'docked-left')
        const rightKids = kids.filter((k) => modeOf(k) === 'docked-right')
        const bottomKids = kids.filter((k) => modeOf(k) === 'docked-bottom')
        const pathChild = activeShell ? directChildOnPath(cid, activeShell) : null
        const activeKid = centerKids.find((k) => k.id === pathChild)
          ?? centerKids.find((k) => k.id === containerActive[cid])
          ?? centerKids[0]
          ?? null
        const floating = shellMode(e.id) === 'float'
        const ownDocked = isDockedMode(shellMode(e.id))
        // The container's own tab lives in its own strip so it can always be
        // grabbed and moved (docked, floated, or nested). Docked containers
        // keep only the icon to save space.
        const stripTabs = [
          { id: e.id, kind: 'container', label: ownDocked ? '' : e.title, ariaLabel: e.title, icon: Boxes },
          ...centerKids.map((k) => ({ id: k.id, kind: k.kind, label: k.title, icon: k.icon })),
        ]
        const stripActive = activeShell === e.id ? e.id : activeKid?.id ?? ''
        const dockChild = (side: 'left' | 'right' | 'bottom', list: ShellEntry[]) => {
          if (!list.length) return null
          if (list.length === 1 && list[0].kind === 'container') {
            return <div className="h-full min-h-0 min-w-0 overflow-hidden">{renderEntry(list[0])}</div>
          }
          return dockArea(side, list, ckey)
        }
        const sideWidth = (side: 'left' | 'right') => ({ width: `${dockSizes[side]}%` })
        return (
          <div className="h-full flex flex-col bg-bg-primary relative">
            {modeDrag && cornerDropSlots(ckey)}
            <Tabbed
              tabs={stripTabs}
              active={stripActive}
              lockedIds={lockedShells}
              size="small"
              dropMode={`container:${cid}`}
              dropActive={!!modeDrag}
              className={`shrink-0 ${floating ? 'cursor-move' : ''}`}
              onBackgroundPointerDown={floating ? undefined : (ev) => {
                if (ev.target !== ev.currentTarget) return
                beginModeDrag(e.id, ev)
              }}
              onActivate={selectShell}
              onClose={closeShell}
              onCloseSelected={closeSelectedShells}
              onHideSelected={hideSelectedShells}
              onToggleLock={setShellLock}
              onSetViewMode={setShellViewMode}
              onReorder={(from, to, after) => {
                if (from === e.id || to === e.id) return
                reorderShell(from, to, after)
              }}
              onDragAway={handleDragAway}
              onDragDetach={(id) => setModeDrag(id)}
              onDropViewMode={dropViewMode}
              onDragCancelViewMode={() => setModeDrag(null)}
            />
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 flex">
                {leftKids.length > 0 ? (
                  <div className="min-w-[120px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary" style={sideWidth('left')}>
                    {dockChild('left', leftKids)}
                  </div>
                ) : modeDrag ? dropSlot(ckey, 'docked-left') : null}
                <div className="flex-1 min-w-0 min-h-0 relative bg-bg-primary">
                  {activeKid ? renderEntry(activeKid) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-text-muted px-4 text-center">
                      <Boxes className="w-6 h-6" />
                      <span className="text-[12px]">Cont {cid}</span>
                      <span className="text-[10px]">drop tabs on this container's tabs</span>
                    </div>
                  )}
                </div>
                {rightKids.length > 0 ? (
                  <div className="min-w-[120px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary" style={sideWidth('right')}>
                    {dockChild('right', rightKids)}
                  </div>
                ) : modeDrag ? dropSlot(ckey, 'docked-right') : null}
              </div>
              {bottomKids.length > 0 ? (
                <div className="min-h-[80px] max-h-[70%] shrink-0 flex flex-col bg-bg-primary" style={{ height: `${dockSizes.bottom}%` }}>
                  {dockChild('bottom', bottomKids)}
                </div>
              ) : modeDrag ? dropSlot(ckey, 'docked-bottom') : null}
            </div>
          </div>
        )
      }
      case 'rrcontrol':
        return (
          <div className="h-full flex items-center justify-center">
            <button type="button" onClick={() => window.location.assign(`${basePath()}/remote-control`)}>
              Open standalone RR Control
            </button>
          </div>
        )
      case 'help':
        return <HelpView />
      case 'settings':
        return (
          <Settings
            onClose={() => setVisible((v) => ({ ...v, settings: false }))}
            authFetch={authFetch}
            username={username}
            onUsernameChange={onUsernameChange}
            onTrustChange={fetchTasks}
            role={role}
            workspaceId={workspaceId}
            visible
            workspace={workspace}
            editorSettings={editorSettings}
            onEditorSettingsChange={handleEditorSettingsChange}
            lspAvailable={lspAvailable}
            desktopMode={desktopMode}
            onDesktopModeChange={setDesktopMode}
            onLogout={onLogout}
            visibleTabTypes={mergedVisibleTabTypes}
            onVisibleTabTypesChange={setLocalVisibleTabTypes}
            uiScale={uiScale}
            onUiScaleChange={updateUiScale}
            uiScaleEnabled={uiScaleEnabled}
            onToggleUiScale={() => setUiScaleEnabled(!uiScaleEnabled)}
            uiOrientation={uiOrientation}
            workspacesApi={workspacesApi}
            allowCustomDirectory={allowCustomDirectory}
          />
        )
    }
  }

  // A dock area is itself a container. Containers docked into it are flattened
  // into that container's strip instead of rendering a second tab line.
  const flattenDockEntries = (list: ShellEntry[]): ShellEntry[] => {
    const out: ShellEntry[] = []
    const walk = (items: ShellEntry[], depth = 0) => {
      for (const e of items) {
        if (e.kind === 'container' && e.containerId != null && depth < 16) {
          const kids = childrenOfContainer(e.containerId)
          if (kids.length) {
            if (containers.find((c) => c.id === e.containerId)?.ownTab) out.push(e)
            walk(kids, depth + 1)
            continue
          }
        }
        out.push(e)
      }
    }
    walk(list)
    return out
  }

  // Clicking a docked container's own grab tab should show its active child,
  // not render the container inside the dock (which would add a second strip).
  const resolveDockActive = (list: ShellEntry[], activeId: string | null): ShellEntry | null => {
    const flat = flattenDockEntries(list)
    let active = flat.find((e) => e.id === activeId) ?? flat[0] ?? null
    if (active?.kind === 'container' && active.containerId != null) {
      const cid = active.containerId
      const info = containers.find((c) => c.id === cid)
      if (info?.ownTab) {
        const kids = childrenOfContainer(cid)
        active = kids.find((k) => k.id === containerActive[cid]) ?? kids[0] ?? null
      }
    }
    return active
  }

  // Each dock area has its own compact tab strip. Only the selected docked
  // window renders below it; other docked windows stay in the strip.
  function dockArea(side: 'left' | 'right' | 'bottom', list: ShellEntry[], parentKey: string | null = null) {
    const mode: ViewMode = `docked-${side}`
    const scope = parentKey ? `${parentKey}:${side}` : null
    const flat = flattenDockEntries(list)
    const active = resolveDockActive(list, scope ? nestedDockActive[scope] ?? null : dockActive[side])
    const dragRoot = active ? rootAncestorId(active.id) : list[0]?.id
    const dragContainer = dragRoot?.startsWith('container:') ? dragRoot : null
    const dropTarget = list.find((e) => e.kind === 'container')
    const stripDropMode = parentKey && dropTarget?.containerId != null ? `container:${dropTarget.containerId}` : mode
    return (
      <div data-view-mode={mode} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-bg-primary">
        <Tabbed
          tabs={flat.map((e) => ({ id: e.id, kind: e.kind, label: e.kind === 'container' ? '' : e.title, ariaLabel: e.title, icon: e.icon }))}
          active={active?.id ?? ''}
          lockedIds={lockedShells}
          size="small"
          dropMode={stripDropMode}
          dropActive={!!modeDrag}
          className="shrink-0"
          onBackgroundPointerDown={(ev) => {
            if (ev.target !== ev.currentTarget || !dragContainer) return
            beginModeDrag(dragContainer, ev)
          }}
          onActivate={(id) => {
            const entry = flat.find((e) => e.id === id)
            const cid = entry?.kind === 'container' ? entry.containerId : null
            const target = cid != null && containers.find((c) => c.id === cid)?.ownTab
              ? (childrenOfContainer(cid).find((k) => k.id === containerActive[cid])
                ?? childrenOfContainer(cid)[0])
              : entry
            if (!target) return
            if (scope) setNestedDockActive((prev) => ({ ...prev, [scope]: target.id }))
            else setDockActive((prev) => ({ ...prev, [side]: target.id }))
            selectShell(target.id)
          }}
          onClose={closeShell}
          onCloseSelected={closeSelectedShells}
          onHideSelected={hideSelectedShells}
          onToggleLock={setShellLock}
          onSetViewMode={setShellViewMode}
          onReorder={reorderShell}
          onDragAway={handleDragAway}
          onDragDetach={(id) => setModeDrag(id)}
          onDropViewMode={dropViewMode}
          onDragCancelViewMode={() => setModeDrag(null)}
        />
        <div className="flex-1 min-h-0 overflow-hidden" data-shell={active?.id ?? undefined}>
          {active ? renderEntry(active) : null}
        </div>
      </div>
    )
  }

	// Filter VIEW_TABS by merged visibleTabTypes config (server + local overrides).
	const filteredViews = useMemo(
		() => VIEW_TABS.filter((v) => mergedVisibleTabTypes[v.kind] !== false),
		[mergedVisibleTabTypes],
	)

   const activeWsForMenu = workspacesApi.sessions.find((s) => s.id === workspaceId)
   const sessionInfo = {
     workspace: activeWsForMenu?.name || '(no workspace)',
     collabContext: collabContext || activeWsForMenu?.name || '',
     directory: activeWsForMenu?.root || workspace || '',
     tabViewState: tabSession.name,
   }

   const viewMenu = (desktop: boolean) => (
     <ViewMenu
       views={filteredViews}
       visible={visible}
       onToggle={(kind) => toggleVisible(kind as ViewKind)}
      onAdd={(kind) => {
        // Debounce to prevent double-fire from swipe gestures
        if (addingViewRef.current === kind) return
        addingViewRef.current = kind
        window.setTimeout(() => { addingViewRef.current = null }, 300)

        if (kind === 'files') addFiles()
        else if (kind === 'web') addWeb()
        else if (kind === 'api') addApi()
        else if (kind === 'terminals') addTerminalTab()
        else if (kind === 'search') addSearch()
        else if (kind === 'log') addLog()
      }}
      onLogout={onLogout}
      onClose={() => setMenuOpen(false)}
      desktop={desktop}
      sessionInfo={sessionInfo}
      onOpenSessionPicker={() => openSessionPicker(true)}
      onToggleDesktop={() => setDesktopMode(!desktopMode)}
      pointers={collabPointers}
      onJumpToPointer={jumpToCollabPointer}
      uiScaleIsSet={uiScaleIsSet}
      uiScaleEnabled={uiScaleEnabled}
      onToggleUiScale={() => setUiScaleEnabled(!uiScaleEnabled)}
      placement={menuPlacement}
      onPlacement={setMenuPlacement}
      onResetView={resetView}
      flattenAvailable={containers.length > 1}
      onFlattenLayout={flattenLayout}
      username={username}
      users={collabRoster}
      onOpenSharedTab={(rel) => { void openFile({ path: rel, rel, workspaceId }) }}
      selfId={selfId}
      teacher={teacher}
      onOpenRemoteControl={rrControlEnabled && mergedVisibleTabTypes.rrcontrol !== false ? () => {
        const viewer = window.open(`${basePath()}/remote-control`, '_blank')
        if (viewer) viewer.opener = null
      } : undefined}
      presenter={presenter}
      followTargetId={followTargetId}
      followMode={followMode}
      onFollow={(id, mode) => { setFollowTargetId(id); setFollowMode(mode) }}
      onUnfollow={() => { setFollowTargetId(null); setFollowMode(null) }}
      onLeadChange={(on) => { if (on) startLead(); else stopLead() }}
    />
  )

  return (
    <div
      data-testid="app-root"
      className="flex bg-bg-base overflow-hidden"
      style={{
        width: `${100 / activeUiScale.x}vw`,
        height: `${100 / activeUiScale.y}dvh`,
        transform: `scale(${activeUiScale.x}, ${activeUiScale.y})`,
        transformOrigin: 'top left',
      }}
    >
      {desktopMode && viewMenu(true)}

      {sessionPicker && (
        <ChooseWorkspaceAndTabSession
          workspacesApi={workspacesApi}
          authFetch={authFetch}
          currentWorkspaceId={workspaceId}
          currentCollabContext={collabContext}
          currentTabViewState={kicked ? null : tabSession.name}
          username={username}
          showCancel={sessionPicker.showCancel}
          onCancel={() => setSessionPicker(null)}
          onApply={applySessionChoice}
          onLogout={onLogout}
          onCloseAllAndLogout={onLogout}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar: menu button (mobile) + view tabs + file actions */}
        <div className="flex items-center min-h-10 bg-bg-tertiary border-b border-border shrink-0 select-none">
          {!desktopMode && (
            <button onClick={() => setMenuOpen(true)}
              className="flex items-center justify-center w-10 h-10 shrink-0 text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              title="Menu">
              <Menu className="w-4 h-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            {mainTabs.length > 0 ? (
              <ViewTabs
                tabs={mainTabs.map((e) => ({ id: e.id, kind: e.kind, label: e.title, icon: e.icon }))}
                active={mainActive}
                lockedIds={lockedShells}
                dropActive={!!modeDrag}
                onSelect={selectShell}
                onClose={closeShell}
                onCloseSelected={closeSelectedShells}
                onHideSelected={hideSelectedShells}
                onToggleLock={setShellLock}
                onSetViewMode={setShellViewMode}
                onReorder={reorderShell}
                onDragDetach={(id) => setModeDrag(id)}
                onDropViewMode={dropViewMode}
                onDragCancelViewMode={() => setModeDrag(null)}
                onDragAway={handleDragAway}
                onCopyLocation={copyTabLocation}
              />
            ) : (
              <div
                data-drop-mode="center"
                className={`flex items-center h-10 min-h-10 px-3 text-[12px] transition-colors ${
                  modeDrag
                    ? 'outline outline-2 outline-dashed outline-accent -outline-offset-2 bg-accent/5 text-text-secondary'
                    : 'text-text-muted'
                }`}>
                {modeDrag ? 'Drop here to return a tab to the main container' : 'Drag a tab back here'}
              </div>
            )}
          </div>
          {!isMobile && (
            <div className="flex items-center gap-0.5 px-1.5 shrink-0">
              {autoSaveStatus && (
                <span className="text-[11px] text-text-muted px-1.5 animate-fade-in">
                  {autoSaveStatus === 'saving' ? 'saving…' : 'saved'}
                </span>
              )}
              {role !== 'viewer' && currentTab?.modified && currentTab.type !== 'browser' && (
                <button onClick={() => { void saveFile() }} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-all font-medium shadow-sm shadow-accent/20">
                  <Save className="w-3 h-3" />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          )}
        </div>

        {forcedPresenter && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border-b border-accent/30 text-[11px] text-text-primary shrink-0">
            <Radio className="w-3.5 h-3.5 text-accent animate-pulse" />
            <span><b>{forcedPresenter.username}</b> is leading — following live</span>
          </div>
        )}
        {presenterIsMe && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 border-b border-accent/30 text-[11px] text-text-primary shrink-0">
            <Radio className="w-3.5 h-3.5 text-accent" />
            <span>You are leading — everyone else follows you live</span>
          </div>
        )}

        {/* Content area: center tab + always-visible docked panes + floats. */}
        <div className="flex-1 min-h-0 relative bg-bg-primary" data-dock-area>
          {modeDrag && cornerDropSlots(null)}
          {entries.length === 0 && (
            <div className="h-full flex items-center justify-center px-6 text-center text-text-muted">
              <span className="text-[12px]">open the hamburger menu in the corner to open files</span>
            </div>
          )}

          {activeRootEntry && activeMode === 'max' && (
            <div data-shell={activeRootEntry.id} data-view-mode="max" className="fixed inset-0 z-40 bg-bg-primary flex flex-col">
              <div
                onPointerDown={(ev) => beginModeDrag(activeRootEntry.id, ev)}
                className="flex items-center gap-1.5 h-8 px-2 border-b border-border bg-bg-secondary shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
                title="Drag to dock, center, or float">
                <GripVertical className="w-3 h-3 shrink-0 text-text-muted" />
                <activeRootEntry.icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                <span className="text-[12px] font-medium text-text-secondary truncate">{activeRootEntry.title}</span>
                <span className="text-[9px] uppercase tracking-wide text-text-muted">max</span>
                <button
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={() => setShellViewMode([activeRootEntry.id], 'center')}
                  className="ml-auto p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
                  title="Restore to center">
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0">{renderEntry(activeRootEntry)}</div>
            </div>
          )}

          {activeMode !== 'max' && (
            <div className="absolute inset-0 flex flex-col min-h-0">
              <div className="flex-1 min-h-0 flex">
                {dockedLeft.length > 0 ? (
                  <>
                    <div
                      data-dock-side="left"
                      data-drop-mode="docked-left"
                      className="min-w-[180px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary relative"
                      style={{ width: `${dockSizes.left}%` }}>
                      {dockedLeft.length === 1 && dockedLeft[0].kind === 'container'
                        ? renderEntry(dockedLeft[0])
                        : dockArea('left', dockedLeft)}
                      {modeDrag && (
                        <div className="absolute inset-0 pointer-events-none z-20 outline outline-2 outline-dashed outline-accent/60 -outline-offset-1 rounded-sm" />
                      )}
                    </div>
                    <div
                      data-dock-resize="left"
                      onPointerDown={(e) => beginDockResize('left', e)}
                      className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors touch-none"
                      title="Resize left container" />
                  </>
                ) : modeDrag ? dropSlot(null, 'docked-left') : null}

                <div className="flex-1 min-w-0 min-h-0 relative bg-bg-primary" data-drop-mode="center">
                  {modeDrag && (
                    <div className="absolute inset-0 pointer-events-none z-20 outline outline-2 outline-dashed outline-accent/60 -outline-offset-1 rounded-sm" />
                  )}
                  {/* Keep panels with local UI state mounted while another center
                      tab is active. Search keeps results/scroll; Files keeps the
                      expanded-folder set and scroll position. */}
                  {mainTabs.filter((e) => e.kind === 'search' || e.kind === 'files').map((e) => (
                    <div key={e.id} className={centerEntry?.id === e.id ? 'absolute inset-0 flex flex-col' : 'hidden'}>
                      {renderEntry(e)}
                    </div>
                  ))}
                  {centerEntry && centerEntry.kind !== 'search' && centerEntry.kind !== 'files' ? (
                    <div className="absolute inset-0 flex flex-col">{renderEntry(centerEntry)}</div>
                  ) : !centerEntry ? (
                    <div className="h-full flex items-center justify-center px-6 text-center text-text-muted">
                      <span className="text-[12px]">select a tab to show it in the center</span>
                    </div>
                  ) : null}
                </div>

                {dockedRight.length > 0 ? (
                  <>
                    <div
                      data-dock-resize="right"
                      onPointerDown={(e) => beginDockResize('right', e)}
                      className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors touch-none"
                      title="Resize right container" />
                    <div
                      data-dock-side="right"
                      data-drop-mode="docked-right"
                      className="min-w-[180px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary relative"
                      style={{ width: `${dockSizes.right}%` }}>
                      {dockedRight.length === 1 && dockedRight[0].kind === 'container'
                        ? renderEntry(dockedRight[0])
                        : dockArea('right', dockedRight)}
                      {modeDrag && (
                        <div className="absolute inset-0 pointer-events-none z-20 outline outline-2 outline-dashed outline-accent/60 -outline-offset-1 rounded-sm" />
                      )}
                    </div>
                  </>
                ) : modeDrag ? dropSlot(null, 'docked-right') : null}
              </div>

              {dockedBottom.length > 0 ? (
                <>
                  <div
                    data-dock-resize="bottom"
                    onPointerDown={(e) => beginDockResize('bottom', e)}
                    className="h-1 shrink-0 cursor-row-resize bg-border hover:bg-accent transition-colors touch-none"
                    title="Resize bottom container" />
                  <div
                    data-dock-side="bottom"
                    data-drop-mode="docked-bottom"
                    className="min-h-[100px] max-h-[70%] shrink-0 flex flex-col bg-bg-primary relative"
                    style={{ height: `${dockSizes.bottom}%` }}>
                    {dockedBottom.length === 1 && dockedBottom[0].kind === 'container'
                      ? renderEntry(dockedBottom[0])
                      : dockArea('bottom', dockedBottom)}
                    {modeDrag && (
                      <div className="absolute inset-0 pointer-events-none z-20 outline outline-2 outline-dashed outline-accent/60 -outline-offset-1 rounded-sm" />
                    )}
                  </div>
                </>
              ) : modeDrag ? dropSlot(null, 'docked-bottom') : null}
            </div>
          )}
          {/* `float` tabs stay on the main container above the active tab and
              can be dragged by their title bar. */}
          {rootEntries.filter((e) => (viewModes[e.id] || 'center') === 'float').map((e, i) => {
            const g = floatGeom[e.id] ?? { x: 40 + (i % 6) * 28, y: 40 + (i % 6) * 28, w: 620, h: 420, z: 30 + i }
            return (
              <FloatWindow
                key={e.id}
                geom={g}
                disabled={!!modeDrag}
                onChange={(ng) => setFloatGeom((prev) => ({ ...prev, [e.id]: ng }))}
                onRaise={() => {
                  const z = ++floatZ.current
                  setFloatGeom((prev) => ({ ...prev, [e.id]: { ...(prev[e.id] ?? g), z } }))
                }}>
                {renderEntry(e)}
              </FloatWindow>
            )
          })}
          {floatingTerminals && role !== 'viewer' && (
            <FloatingTerminals token={token} workspaceId={workspaceId} term={terminalsApi} onDock={dockTerminal}
              sendWindow={sendWindow} onWindow={onWindow} />
          )}

        </div>

        {/* Status bar (desktop only — mobile has no space to waste) */}
        {!isMobile && (
          <div className="flex items-center justify-between px-1 h-6 bg-status-bar border-t border-border text-status-text text-[11px] font-medium shrink-0 select-none">
            <div className="flex items-center">
              {gitBranch && (
                <button onClick={() => showView('git')}
                  className="flex items-center gap-1 px-2 h-full hover:bg-bg-hover transition-colors rounded-sm">
                  <GitBranch className="w-3 h-3" />
                  <span className="font-mono">{gitBranch}</span>
                  {gitChanges > 0 && (
                    <span className="ml-0.5 px-1 py-px rounded text-[10px] bg-yellow/15 text-yellow font-semibold">
                      {gitChanges}
                    </span>
                  )}
                </button>
              )}
              {currentTab?.modified && currentTab.type !== 'browser' && (
                <span className="px-2 text-yellow/80 font-medium">●</span>
              )}
            </div>
            <div className="flex items-center">
              {currentTab && currentTab.type !== 'browser' && (
                <>
                  <span className="px-2 hover:bg-bg-hover rounded-sm cursor-default">Ln {cursor.line}, Col {cursor.col}</span>
                  <span className="px-2 hover:bg-bg-hover rounded-sm cursor-default opacity-80">{extToLang(currentTab.name)}</span>
                </>
              )}
              {currentTab?.type === 'browser' && <span className="px-2 opacity-70">Web View</span>}
              <span className="px-2 opacity-50">UTF-8</span>
            </div>
          </div>
        )}
      </div>

      {!desktopMode && menuOpen && viewMenu(false)}

      <QuickOpen visible={showQuickOpen} onClose={() => setShowQuickOpen(false)} authFetch={authFetch} workspaces={workspacesApi?.workspaces || []} workspaceId={workspaceId} onOpenFile={openFile} />
      <CommandPalette
        visible={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onSaveFile={() => { void saveFile() }}
        onSaveAll={() => { void saveAll() }}
        onNewFile={() => { showView('files'); explorerActionsRef.current?.newFile() }}
        onNewFolder={() => { showView('files'); explorerActionsRef.current?.newFolder() }}
        onToggleTerminal={() => role !== 'viewer' && toggleVisible('terminals')}
        onOpenSettings={() => showView('settings')}
        onFocusExplorer={() => showView('files')}
        onFocusGit={() => showView('git')}
        onOpenBrowser={() => openBrowser()}
        onCloseTab={() => activeTab && closeTab(activeTab)}
        onRefreshExplorer={() => explorerActionsRef.current?.refresh()}
        onGitStageAll={() => { void gitStageAll() }}
        onGitUnstageAll={() => { void gitUnstageAll() }}
        onToggleTheme={toggleTheme}
        onLogout={onLogout}
        onGoToLine={() => editorActionsRef.current?.goToLine()}
        onFormatFile={() => { void formatCurrentFile() }}
        isDark={isDark}
        hasActiveTab={!!activeTab}
        hasModified={hasModified}
      />

      {shareCursors && <RemoteCursors pointers={collabPointers} roster={collabRoster} onJump={jumpToCollabPointer} />}
    </div>
  )
}


const EXT_LANGS: Record<string, string> = {
  js: 'JavaScript', jsx: 'JavaScript JSX', ts: 'TypeScript', tsx: 'TypeScript JSX',
  go: 'Go', py: 'Python', rs: 'Rust', rb: 'Ruby', java: 'Java', php: 'PHP',
  c: 'C', cpp: 'C++', h: 'C Header', cs: 'C#',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
  json: 'JSON', xml: 'XML', svg: 'SVG', yaml: 'YAML', yml: 'YAML', toml: 'TOML',
  md: 'Markdown', sql: 'SQL', sh: 'Shell', bash: 'Bash', zsh: 'Shell',
  dockerfile: 'Dockerfile', makefile: 'Makefile',
  txt: 'Plain Text', env: 'Environment', gitignore: 'Git Ignore',
  mod: 'Go Module', sum: 'Go Checksum', lock: 'Lock File',
}

function extToLang(filename: string | null | undefined): string {
  if (!filename) return 'Plain Text'
  const name = filename.toLowerCase()
  if (name === 'dockerfile') return 'Dockerfile'
  if (name === 'makefile') return 'Makefile'
  const ext = name.split('.').pop() || ''
  return EXT_LANGS[ext] || 'Plain Text'
}

function urlToName(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname + (u.port ? ':' + u.port : '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || 'Browser'
  }
}
