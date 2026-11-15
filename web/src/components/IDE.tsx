import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Files, GitBranch, TerminalSquare, Save, FolderOpen,
  Globe, Settings as SettingsIcon, ChevronLeft, Search as SearchIcon,
  MessageSquare, Webhook, ScrollText, Boxes,
  HelpCircle, Menu, Code2, Minimize2, GripVertical, Radio,
} from 'lucide-react'
import { useMobile } from '../hooks/useMobile'
import { useDesktopMode } from '../hooks/useDesktopMode'
import { useTheme } from '../hooks/useTheme'
import type { ViewMode } from '../lib/viewTypes'
import Logo from './Logo'
import FileExplorer from './FileExplorer'
import Editor, { type CursorPos } from './Editor'
import TerminalPanel from './TerminalPanel'
import GitPanels from './GitPanels'
import FolderPicker from './FolderPicker'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import Browser from './Browser'
import Settings from './Settings'
import HelpView from './HelpView'
import SearchPanel from './SearchPanel'
import CommandPalette from './CommandPalette'
import QuickOpen from './QuickOpen'
import Breadcrumbs from './Breadcrumbs'
import MarkdownPreview from './MarkdownPreview'
import { ImagePreview, BinaryNotice } from './ImagePreview'
import { useLSP } from '../hooks/useLSP'
import { useCollab } from '../hooks/useCollab'
import { useBranding } from '../hooks/useBranding'
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
import ViewMenu from './ViewMenu'
import { useTerminals } from '../hooks/useTerminals'
import { useDap } from '../hooks/useDap'
import { workspaceUrl } from '../api'
import { fileKey, parseFileKey, normalizeTabIdentity } from '../lib/fileKey'
import { followTargetFromPeer, targetSelectionKey } from '../lib/followSelection'
import { useWorkspaces } from '../hooks/useWorkspaces'
import type { AuthFetch, Tab, FileEntry, EditorSettings, Task, ExplorerActions, EditorActions, DapAvailableInfo } from '../types'

// colorFromName derives a stable per-user color for collaboration cursors.
const COLLAB_PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6']
function colorFromName(name: string | null | undefined): string {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + (name as string).charCodeAt(i)) | 0
  return COLLAB_PALETTE[Math.abs(h) % COLLAB_PALETTE.length]
}

let browserIdCounter = 0

export interface IDEProps {
  token: string
  authFetch: AuthFetch
  onLogout: () => void
  workspace: string | null
  recents: string[]
  onWorkspaceChange: (path: string) => void
  workspacesApi: ReturnType<typeof useWorkspaces>
  workspaceId: string | null
  username: string
  onUsernameChange: (name: string) => void
  role: string
  teacher?: boolean
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

type ViewKind = 'files' | 'search' | 'code' | 'web' | 'git' | 'api' | 'settings' | 'log' | 'help' | 'terminals' | 'chat'

// The layout a fresh install starts with (and what "Reset view" restores).
const DEFAULT_VISIBLE: Record<ViewKind, boolean> = {
  files: true, search: false, code: true, web: false, git: false, api: false,
  settings: false, log: false, help: false, terminals: false, chat: false,
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

interface FloatWindowProps {
  geom: FloatGeom
  onChange: (g: FloatGeom) => void
  onRaise: () => void
  children: ReactNode
}

function FloatWindow({ geom, onChange, onRaise, children }: FloatWindowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number; rect: DOMRect } | null>(null)

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
    drag.current = { dx: e.clientX - rect.left - geom.x, dy: e.clientY - rect.top - geom.y, rect }
    const move = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const maxX = Math.max(0, d.rect.width - Math.min(geom.w, d.rect.width))
      const maxY = Math.max(0, d.rect.height - 40)
      onChange({
        ...geom,
        x: Math.max(0, Math.min(ev.clientX - d.rect.left - d.dx, maxX)),
        y: Math.max(0, Math.min(ev.clientY - d.rect.top - d.dy, maxY)),
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
    const move = (ev: PointerEvent) => {
      const w = Math.max(260, Math.min(startW + ev.clientX - sx, rect.width - geom.x))
      const h = Math.max(160, Math.min(startH + ev.clientY - sy, rect.height - geom.y))
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
      style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: geom.z, maxWidth: 'calc(100% - 16px)', maxHeight: 'calc(100% - 16px)' }}
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
  fileType?: 'image' | 'binary'
  dataUrl?: string
  size?: number
}

export default function IDE({ token, authFetch, onLogout, workspace, recents, onWorkspaceChange, workspacesApi, workspaceId, username, onUsernameChange, role, teacher = false }: IDEProps) {
  const isMobile = useMobile()
  const { desktopMode, setDesktopMode } = useDesktopMode()
  const { isDark, toggle: toggleTheme } = useTheme()

  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const saved = localStorage.getItem('wede_tabs')
      const parsed: unknown = saved ? JSON.parse(saved) : []
      // Upgrade tabs persisted before multi-root composite keys (fills
      // rel/workspaceId so save/format don't POST to /workspaces/undefined/...).
      return Array.isArray(parsed) ? (parsed as Partial<Tab>[]).map((t) => normalizeTabIdentity(t, workspaceId) as Tab) : []
    } catch { return [] }
  })
  const [activeTab, setActiveTab] = useState<string | null>(() => {
    const saved = localStorage.getItem('wede_activeTab')
    return saved ? (normalizeTabIdentity({ path: saved }, workspaceId)?.path ?? null) : null
  })

  // Collaboration presence: who else is in this workspace and what they're viewing.
  const { selfId, roster: collabRoster, presenter, startLead, stopLead, setViewing: setCollabViewing, setTabs: setCollabTabs, mice: collabMice, sendMouse, sendWindow, onWindow, sendTerminals, onTerminals } = useCollab(workspaceId, token, username)

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
    { kind: 'settings', label: 'Settings', icon: SettingsIcon },
  ]
  const [visible, setVisible] = useState<Record<ViewKind, boolean>>(() => {
    try {
      const saved = localStorage.getItem('wede_visible')
      if (saved) return { ...DEFAULT_VISIBLE, ...(JSON.parse(saved) as Partial<Record<ViewKind, boolean>>) }
    } catch { /* ignore */ }
    return DEFAULT_VISIBLE
  })
  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wede_tab_order')
      if (saved) return JSON.parse(saved) as string[]
    } catch { /* ignore */ }
    return []
  })
  const [activeShell, setActiveShell] = useState<string>(() => localStorage.getItem('wede_active_shell') || 'view:files')
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPlacement, setMenuPlacement] = useState<MenuPlacement>(() => {
    const saved = localStorage.getItem('wede_menu_placement') as MenuPlacement | null
    return saved || (desktopMode ? 'left-icons-and-text' : 'left-of-tabs')
  })
  const [containers, setContainers] = useState<ContainerInfo[]>(() => {
    try {
      const saved = localStorage.getItem('wede_containers')
      if (saved) return JSON.parse(saved) as ContainerInfo[]
    } catch { /* ignore */ }
    return [{ id: 1, visible: false }]
  })
  // Which container (if any) owns each shell tab. Values are container ids
  // such as `container:2`; missing/empty means the root container. Containers
  // are tabs too, so this mapping supports nesting.
  const [containerOf, setContainerOf] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('wede_container_of')
      if (saved) return JSON.parse(saved) as Record<string, string>
    } catch { /* ignore */ }
    return {}
  })
  const [containerActive, setContainerActive] = useState<Record<number, string>>(() => {
    try {
      const saved = localStorage.getItem('wede_container_active')
      if (saved) return JSON.parse(saved) as Record<number, string>
    } catch { /* ignore */ }
    return {}
  })
  const containerIdRef = useRef((containers[containers.length - 1]?.id || 0) + 1)
  const [lockedShells, setLockedShells] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('wede_locked_shells')
      if (saved) return JSON.parse(saved) as string[]
    } catch { /* ignore */ }
    return []
  })
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>(() => {
    try {
      const saved = localStorage.getItem('wede_view_modes')
      if (saved) {
        const raw = JSON.parse(saved) as Record<string, string>
        const next: Record<string, ViewMode> = {}
        for (const [id, mode] of Object.entries(raw)) {
          next[id] = (
            mode === 'float-left' ? 'docked-left'
              : mode === 'float-right' ? 'docked-right'
                : mode === 'float-bottom' ? 'docked-bottom'
                  : mode
          ) as ViewMode
        }
        return next
      }
    } catch { /* ignore */ }
    return {}
  })
  const [floatGeom, setFloatGeom] = useState<Record<string, FloatGeom>>(() => {
    try {
      const saved = localStorage.getItem('wede_float_geom')
      if (saved) return JSON.parse(saved) as Record<string, FloatGeom>
    } catch { /* ignore */ }
    return {}
  })
  const floatZ = useRef(30)
  const [dockSizes, setDockSizes] = useState<{ left: number; right: number; bottom: number }>(() => {
    try {
      const saved = localStorage.getItem('wede_dock_sizes')
      if (saved) return JSON.parse(saved) as { left: number; right: number; bottom: number }
    } catch { /* ignore */ }
    return { left: 32, right: 32, bottom: 30 }
  })
  const [modeDrag, setModeDrag] = useState<string | null>(null)
  const [dockActive, setDockActive] = useState<{ left: string | null; right: string | null; bottom: string | null }>({ left: null, right: null, bottom: null })
  const [nestedDockActive, setNestedDockActive] = useState<Record<string, string>>({})
  const [apiIds, setApiIds] = useState<number[]>([1])
  const [activeApiId, setActiveApiId] = useState(1)
  const nextApiId = useRef(2)
  const [searchIds, setSearchIds] = useState<number[]>([1])
  const [activeSearchId, setActiveSearchId] = useState(1)
  const nextSearchId = useRef(2)
  const [logIds, setLogIds] = useState<number[]>([1])
  const [activeLogId, setActiveLogId] = useState(1)
  const nextLogId = useRef(2)

  const addWeb = useCallback((url = 'https://wede.vulos.org') => {
    const id = `browser:${++browserIdCounter}`
    setTabs((prev) => [...prev, { path: id, name: urlToName(url), type: 'browser', url, content: '', originalContent: '', modified: false }])
    setVisible((v) => ({ ...v, web: true }))
    setActiveTab(id)
    setActiveShell(`web:${id}`)
    return id
  }, [])

  const addApi = useCallback(() => {
    const id = nextApiId.current++
    setApiIds((prev) => [...prev, id])
    setActiveApiId(id)
    setVisible((v) => ({ ...v, api: true }))
    setActiveShell(`api:${id}`)
    return id
  }, [])

  const addSearch = useCallback(() => {
    const id = nextSearchId.current++
    setSearchIds((prev) => [...prev, id])
    setActiveSearchId(id)
    setVisible((v) => ({ ...v, search: true }))
    setActiveShell(`search:${id}`)
    return id
  }, [])

  const addLog = useCallback(() => {
    const id = nextLogId.current++
    setLogIds((prev) => [...prev, id])
    setActiveLogId(id)
    setVisible((v) => ({ ...v, log: true }))
    setActiveShell(`log:${id}`)
    return id
  }, [])

  const addTerminalTab = useCallback(() => {
    const id = terminalsApi.addTerminal()
    setVisible((v) => ({ ...v, terminals: true }))
    setActiveShell(`term:${id}`)
    return id
  }, [terminalsApi])

  const toggleVisible = useCallback((kind: ViewKind) => {
    const noInstances =
      (kind === 'web' && !tabs.some((t) => t.type === 'browser')) ||
      (kind === 'api' && apiIds.length === 0) ||
      (kind === 'terminals' && terminalsApi.terminals.length === 0) ||
      (kind === 'search' && searchIds.length === 0) ||
      (kind === 'log' && logIds.length === 0)
    const turningOn = !visible[kind] || noInstances
    if (turningOn) {
      if (kind === 'web') {
        const existing = tabs.find((t) => t.type === 'browser')
        if (!existing) { addWeb(); return }
        setActiveTab(existing.path)
        setActiveShell(`web:${existing.path}`)
      } else if (kind === 'api') {
        if (apiIds.length === 0) { addApi(); return }
        setActiveShell(`api:${activeApiId}`)
      } else if (kind === 'terminals') {
        if (terminalsApi.terminals.length === 0) { addTerminalTab(); return }
        const id = terminalsApi.activeId ?? terminalsApi.terminals[0].id
        terminalsApi.setActiveId(id)
        setActiveShell(`term:${id}`)
      } else if (kind === 'search') {
        if (searchIds.length === 0) { addSearch(); return }
        setActiveShell(`search:${activeSearchId}`)
      } else if (kind === 'log') {
        if (logIds.length === 0) { addLog(); return }
        setActiveShell(`log:${activeLogId}`)
      } else {
        setActiveShell(`view:${kind}`)
      }
    }
    setVisible((v) => ({ ...v, [kind]: turningOn }))
  }, [visible, tabs, apiIds, activeApiId, terminalsApi, searchIds, activeSearchId, logIds, activeLogId, addWeb, addApi, addTerminalTab, addSearch, addLog])

  const showView = useCallback((kind: ViewKind) => {
    setVisible((v) => ({ ...v, [kind]: true }))
    if (kind === 'search') {
      if (searchIds.length === 0) { addSearch(); return }
      setActiveShell(`search:${activeSearchId}`)
    } else if (kind === 'log') {
      if (logIds.length === 0) { addLog(); return }
      setActiveShell(`log:${activeLogId}`)
    } else if (kind === 'web') {
      const existing = tabs.find((t) => t.type === 'browser')
      if (!existing) { addWeb(); return }
      setActiveTab(existing.path)
      setActiveShell(`web:${existing.path}`)
    } else if (kind === 'api') {
      if (apiIds.length === 0) { addApi(); return }
      setActiveShell(`api:${activeApiId}`)
    } else if (kind === 'terminals') {
      if (terminalsApi.terminals.length === 0) { addTerminalTab(); return }
      const id = terminalsApi.activeId ?? terminalsApi.terminals[0].id
      terminalsApi.setActiveId(id)
      setActiveShell(`term:${id}`)
    } else {
      setActiveShell(`view:${kind}`)
    }
  }, [searchIds, activeSearchId, logIds, activeLogId, tabs, apiIds, activeApiId, terminalsApi, addSearch, addLog, addWeb, addApi, addTerminalTab])

  interface ShellEntry {
    id: string
    kind: ViewKind | 'container'
    title: string
    icon: ViewTab['icon']
    filePath?: string
    webPath?: string
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
    if (visible.files) pushView('files', 'Files', Files)
    if (visible.search) for (const id of searchIds) list.push({ id: `search:${id}`, kind: 'search', title: `Search ${id}`, icon: SearchIcon, searchId: id })
    if (visible.code) {
      const fileTabs = tabs.filter((t) => !t.type || t.type === 'gitgraph')
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
    for (const c of containers.filter((x) => x.visible)) {
      list.push({ id: `container:${c.id}`, kind: 'container', title: `Cont ${c.id}`, icon: Boxes, containerId: c.id })
    }
    if (visible.settings) pushView('settings', 'Settings', SettingsIcon)
    const order = (id: string) => {
      const i = tabOrder.indexOf(id)
      return i < 0 ? Number.MAX_SAFE_INTEGER : i
    }
    return list.sort((a, b) => order(a.id) - order(b.id))
  }, [visible, tabs, apiIds, searchIds, logIds, containers, terminalsApi.terminals, tabOrder])

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

  useEffect(() => {
    if (!entries.length || entries.some((e) => e.id === activeShell)) return
    const e = entries[0]
    setActiveShell(e.id)
    if (e.filePath) setActiveTab(e.filePath)
    else if (e.webPath) setActiveTab(e.webPath)
    else if (e.apiId != null) setActiveApiId(e.apiId)
    else if (e.termId != null) terminalsApi.setActiveId(e.termId)
    else setActiveTab(null)
  }, [entries, activeShell, setActiveTab, terminalsApi])
  useEffect(() => { try { localStorage.setItem('wede_visible', JSON.stringify(visible)) } catch { /* ignore */ } }, [visible])
  useEffect(() => { try { localStorage.setItem('wede_tab_order', JSON.stringify(tabOrder)) } catch { /* ignore */ } }, [tabOrder])
  useEffect(() => { try { localStorage.setItem('wede_active_shell', activeShell) } catch { /* ignore */ } }, [activeShell])
  useEffect(() => { try { localStorage.setItem('wede_menu_placement', menuPlacement) } catch { /* ignore */ } }, [menuPlacement])
  useEffect(() => { try { localStorage.setItem('wede_containers', JSON.stringify(containers)) } catch { /* ignore */ } }, [containers])
  useEffect(() => { try { localStorage.setItem('wede_container_of', JSON.stringify(containerOf)) } catch { /* ignore */ } }, [containerOf])
  useEffect(() => { try { localStorage.setItem('wede_container_active', JSON.stringify(containerActive)) } catch { /* ignore */ } }, [containerActive])
  useEffect(() => { try { localStorage.setItem('wede_locked_shells', JSON.stringify(lockedShells)) } catch { /* ignore */ } }, [lockedShells])
  useEffect(() => { try { localStorage.setItem('wede_view_modes', JSON.stringify(viewModes)) } catch { /* ignore */ } }, [viewModes])
  useEffect(() => { try { localStorage.setItem('wede_float_geom', JSON.stringify(floatGeom)) } catch { /* ignore */ } }, [floatGeom])
  useEffect(() => { try { localStorage.setItem('wede_dock_sizes', JSON.stringify(dockSizes)) } catch { /* ignore */ } }, [dockSizes])

  // Upgrade any legacy raw floating tab into a floating container so every
  // float keeps a draggable container tab.
  useEffect(() => {
    const loose = rootEntries.filter((e) => !e.id.startsWith('container:') && (viewModes[e.id] || 'center') === 'float')
    if (loose.length === 0) return
    const wrapped = loose.map((e) => ({ id: containerIdRef.current++, child: e.id, mode: 'float' as ViewMode }))
    setContainers((prev) => [...prev, ...wrapped.map((c) => ({ id: c.id, visible: true, ownTab: true }))])
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
    setViewModes((prev) => {
      const next = { ...prev }
      for (const c of wrapped) {
        delete next[c.child]
        next[`container:${c.id}`] = c.mode
      }
      return next
    })
  }, [rootEntries, viewModes])

  // Every container is disposable when empty — root, nested, docked, floating,
  // or centered. Remove it immediately so no ghost strip/window remains.
  useEffect(() => {
    const empty = containers.filter((c) => c.visible && !entries.some((e) => containerOf[e.id] === `container:${c.id}`))
    if (empty.length === 0) return
    const ids = new Set(empty.map((c) => c.id))
    const keys = new Set(empty.map((c) => `container:${c.id}`))
    setContainers((prev) => prev.filter((c) => !ids.has(c.id)))
    setViewModes((prev) => {
      const next = { ...prev }
      for (const key of keys) delete next[key]
      return next
    })
    setContainerActive((prev) => {
      const next = { ...prev }
      for (const id of ids) delete next[id]
      for (const [cid, child] of Object.entries(next)) if (keys.has(child)) delete next[Number(cid)]
      return next
    })
    setContainerOf((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of keys) {
        if (next[key]) { delete next[key]; changed = true }
      }
      return changed ? next : prev
    })
    setNestedDockActive((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [scope, child] of Object.entries(next)) {
        if (keys.has(child) || Array.from(keys).some((k) => scope.startsWith(`${k}:`))) {
          delete next[scope]
          changed = true
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
  }, [containers, containerOf, entries])

  // Tasks (global + trusted project .wede/tasks.json) — run in a new terminal.
  const [tasks, setTasks] = useState<Task[]>([])
  const fetchTasks = useCallback(() => {
    if (!authFetch) return
    authFetch('/api/tasks').then((r) => r.json()).then((d: { tasks?: Task[] }) => setTasks(d.tasks || [])).catch(() => {})
  }, [authFetch])
  useEffect(() => { fetchTasks() }, [fetchTasks, workspaceId])
  const runTask = useCallback((task: Task) => {
    if (role === 'viewer' || !task?.command) return
    const cmd = task.cwd ? `cd '${task.cwd}' && ${task.command}` : task.command
    const id = terminalsApi.addTerminal(task.name || 'Task', cmd)
    setVisible((v) => ({ ...v, terminals: true }))
    setActiveShell(`term:${id}`)
  }, [role, terminalsApi])

  // Closing the last terminal leaves an empty terminal list. Uncheck the
  // Terminals menu row too, so the UI doesn't claim a view exists with no tabs.
  useEffect(() => {
    if (terminalsApi.terminals.length > 0) return
    setVisible((v) => (v.terminals ? { ...v, terminals: false } : v))
  }, [terminalsApi.terminals.length])

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
    setVisible((v) => ({ ...v, terminals: true }))
    const first = terminalsApi.terminals[0]
    if (first) setActiveShell(`term:${first.id}`)
  }, [terminalsApi.terminals])
  const floatTerminal = useCallback(() => { setFloatingTerminals(true) }, [])

  const [termFullscreen, setTermFullscreen] = useState(false)

  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [pickerMode, setPickerMode] = useState<'open' | 'add'>('open') // 'open' = switch workspace; 'add' = add a root
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
  useEffect(() => {
    const rel = parseFileKey(activeTab || '').rel
    const hasSel = cursor.anchorLine && cursor.headLine && cursor.anchorLine !== cursor.headLine
      || cursor.anchorLine && cursor.headLine && cursor.anchorLine === cursor.headLine && cursor.anchorCol && cursor.headCol && cursor.anchorCol !== cursor.headCol
    const anchorLine = hasSel ? (cursor.anchorLine || 0) : 0
    const anchorCol = hasSel ? (cursor.anchorCol || 0) : 0
    const headLine = hasSel ? (cursor.headLine || 0) : 0
    const headCol = hasSel ? (cursor.headCol || 0) : 0
    setCollabViewing(rel, rel ? cursor.line : 0, anchorLine, anchorCol, headLine, headCol)
  }, [activeTab, cursor.line, cursor.anchorLine, cursor.anchorCol, cursor.headLine, cursor.headCol, setCollabViewing, selfId])

  // Publish the open file tabs for this workspace so peers can follow-open.
  const lastSentTabsRef = useRef('')
  useEffect(() => {
    const list = tabs
      .filter((t) => t.workspaceId === workspaceId && t.rel && !t.type)
      .map((t) => t.rel as string)
    // Include selfId so the inventory is re-sent after a reconnect, while
    // ordinary keystrokes (which replace the tabs array) stay quiet.
    const key = `${selfId}:${JSON.stringify(list)}`
    if (lastSentTabsRef.current === key) return
    lastSentTabsRef.current = key
    setCollabTabs(list)
  }, [tabs, workspaceId, setCollabTabs, selfId])

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

  const branding = useBranding()
  const folderName = workspace?.split('/').pop() || branding

  // Persist open tabs to localStorage (rel + workspaceId let multi-root tabs be
  // restored against their own workspace, not just the active one).
  useEffect(() => {
    try {
      const toSave = tabs.map(t => ({ path: t.path, rel: t.rel, workspaceId: t.workspaceId, name: t.name, type: t.type, url: t.url }))
      localStorage.setItem('wede_tabs', JSON.stringify(toSave))
    } catch { /* ignore */ }
  }, [tabs])

  useEffect(() => {
    if (activeTab) localStorage.setItem('wede_activeTab', activeTab)
    else localStorage.removeItem('wede_activeTab')
  }, [activeTab])

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
        setActiveTab(next[Math.min(idx, next.length - 1)]?.path || null)
      }
      return next
    })
  }, [activeTab])

  // closeSelectedTabs closes the given tabs, skipping locked ones unless
  // includeLocked is set.
  const closeSelectedTabs = useCallback((paths: string[], includeLocked: boolean) => {
    const set = new Set(paths)
    const next = tabs.filter((t) => !set.has(t.path) || (!includeLocked && t.locked))
    if (next.length === tabs.length) return
    setTabs(next)
    if (activeTab && !next.some((t) => t.path === activeTab)) {
      setActiveTab(next.length ? next[next.length - 1].path : null)
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
    }
    const up = (ev: PointerEvent) => {
      cleanup()
      if (!active) return
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const mode = el?.closest('[data-drop-mode]')?.getAttribute('data-drop-mode') || null
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
  }, [dropViewMode])

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
    setActiveShell('view:files')
    setApiIds([1])
    setActiveApiId(1)
    nextApiId.current = 2
    setSearchIds([1])
    setActiveSearchId(1)
    nextSearchId.current = 2
    setLogIds([1])
    setActiveLogId(1)
    nextLogId.current = 2
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
    if (e.apiId != null) { setApiIds((prev) => prev.filter((x) => x !== e.apiId)); return }
    if (e.searchId != null) { setSearchIds((prev) => prev.filter((x) => x !== e.searchId)); return }
    if (e.logId != null) { setLogIds((prev) => prev.filter((x) => x !== e.logId)); return }
    if (e.containerId != null) {
      setContainers((prev) => prev.map((c) => (c.id === e.containerId ? { ...c, visible: false } : c)))
      return
    }
    if (e.termId != null) { terminalsApi.closeTerminal(e.termId); return }
    setVisible((v) => ({ ...v, [e.kind]: false }))
  }, [entries, closeTab, terminalsApi, lockedShells, forgetShellMapping])

  const closeSelectedShells = useCallback((ids: string[], includeLocked = false) => {
    for (const id of ids) {
      if (!includeLocked && lockedShells.includes(id)) continue
      const e = entries.find((x) => x.id === id)
      if (!e) continue
      if (e.kind !== 'container') forgetShellMapping(id)
      if (e.filePath) closeTab(e.filePath)
      else if (e.webPath) closeTab(e.webPath)
      else if (e.apiId != null) setApiIds((prev) => prev.filter((x) => x !== e.apiId))
      else if (e.searchId != null) setSearchIds((prev) => prev.filter((x) => x !== e.searchId))
      else if (e.logId != null) setLogIds((prev) => prev.filter((x) => x !== e.logId))
      else if (e.containerId != null) setContainers((prev) => prev.map((c) => (c.id === e.containerId ? { ...c, visible: false } : c)))
      else if (e.termId != null) terminalsApi.closeTerminal(e.termId)
      else setVisible((v) => ({ ...v, [e.kind]: false }))
    }
  }, [entries, closeTab, terminalsApi, lockedShells, forgetShellMapping])

  const reorderShell = useCallback((from: string, to: string) => {
    setTabOrder((prev) => {
      const ids = entries.map((e) => e.id)
      const base = [...new Set([...prev.filter((id) => ids.includes(id)), ...ids])]
      const a = base.indexOf(from)
      const b = base.indexOf(to)
      if (a < 0 || b < 0 || a === b) return prev
      const next = base.slice()
      const [moved] = next.splice(a, 1)
      next.splice(b, 0, moved)
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

  const handleWorkspaceOpen = useCallback((path: string) => {
    setTabs([])
    setActiveTab(null)
    setTerminalKey((k) => k + 1)
    setShowFolderPicker(false)
    onWorkspaceChange(path)
  }, [onWorkspaceChange])

  // Multi-root: add another folder as an additional workspace root without
  // disturbing the currently open tabs, then focus it.
  const openAddFolder = useCallback(() => { setPickerMode('add'); setShowFolderPicker(true) }, [])
  const handleAddFolder = useCallback(async (path: string) => {
    setShowFolderPicker(false)
    setPickerMode('open')
    if (!workspacesApi?.createWorkspace) return
    const norm = path.replace(/\/+$/, '')
    // Already open as a root? Just focus it instead of adding a duplicate.
    const existing = (workspacesApi.workspaces || []).find((w) => (w.root || '').replace(/\/+$/, '') === norm)
    if (existing) { workspacesApi.setActiveWorkspaceId(existing.id); return }
    const name = norm.split('/').filter(Boolean).pop() || 'folder'
    try {
      const ws = await workspacesApi.createWorkspace(name, path)
      if (ws?.id) workspacesApi.setActiveWorkspaceId(ws.id)
    } catch { /* ignore — createWorkspace surfaces its own errors */ }
  }, [workspacesApi])

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
  const openFile = useCallback(async (entry: FileEntry, { preview = false, activate = true, targetLine, targetSelection }: { preview?: boolean; activate?: boolean; targetLine?: number; targetSelection?: Tab['targetSelection'] | null } = {}) => {
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
      const clearsSel = targetSelection === null && existing.targetSelection != null
      const selChanged = targetSelection != null && (
        !existing.targetSelection ||
        existing.targetSelection.anchorLine !== targetSelection.anchorLine ||
        existing.targetSelection.anchorCol !== targetSelection.anchorCol ||
        existing.targetSelection.headLine !== targetSelection.headLine ||
        existing.targetSelection.headCol !== targetSelection.headCol
      )
      if ((!preview && existing.preview) || (targetLine != null && targetLine !== existing.targetLine) || selChanged || clearsSel) {
        setTabs((prev) => prev.map((t) => {
          if (t.path !== key) return t
          const next = { ...t }
          if (!preview) next.preview = false
          if (targetLine != null) next.targetLine = targetLine
          if (targetSelection === null) next.targetSelection = undefined
          else if (targetSelection != null) next.targetSelection = targetSelection
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
      if (data.fileType === 'image') {
        tab.fileType = 'image'
        tab.dataUrl = data.dataUrl
      } else if (data.fileType === 'binary') {
        tab.fileType = 'binary'
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
    const key = `${effectiveFollowId}:live:${target.file}:${line}:${selKey}`
    if (lastFollowKeyRef.current === key) return
    lastFollowKeyRef.current = key
    // `sel ?? null` is deliberate: when the followed peer collapses their
    // selection we must CLEAR ours, not leave the previous range highlighted.
    void openFile(
      { path: target.file, rel: target.file, workspaceId },
      { activate: true, targetLine: line, targetSelection: sel ?? null },
    )
  }, [effectiveFollowId, effectiveFollowMode, collabRoster, openFile, workspaceId, tabs, closeTab])

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

  // Live multiplayer mouse cursors — broadcast my pointer (as viewport fractions)
  // and render collaborators' pointers, when the setting is enabled.
  const shareCursors = (editorSettings.shareCursors ?? true)
  useEffect(() => {
    if (!shareCursors) return undefined
    const onMove = (e: MouseEvent) => sendMouse(e.clientX / window.innerWidth, e.clientY / window.innerHeight)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [shareCursors, sendMouse])

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
    if (tab.fileType === 'image') {
      return <ImagePreview dataUrl={tab.dataUrl} filename={tab.name} />
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
        settings={editorSettings}
        lspExtension={isActive ? lspExtension : null}
        onRegisterActions={isActive ? handleRegisterEditorActions : undefined}
        collab={isActive ? collab : null}
        editable={editable}
        breakpoints={breakpoints[tabAbs] || []}
        onToggleBreakpoint={(ln, lines) => toggleBreakpoint(tabRel, lines)}
        stopLine={tabStopLine}
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

  if (showFolderPicker) {
    const adding = pickerMode === 'add'
    return (
      <div className="h-screen flex flex-col bg-bg-primary">
        <div className="flex items-center px-4 py-2.5 bg-bg-tertiary border-b border-border">
          <button onClick={() => { setShowFolderPicker(false); setPickerMode('open') }}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <div className="flex-1 overflow-y-auto flex items-start justify-center p-6">
          <div className="w-full max-w-xl bg-bg-primary border border-border rounded-xl p-6 shadow-xl shadow-shadow">
            <h2 className="text-base font-semibold text-text-primary mb-4">{adding ? 'Add Folder to Workspace' : 'Open Folder'}</h2>
            <FolderPicker authFetch={authFetch} recents={recents} onOpen={adding ? handleAddFolder : handleWorkspaceOpen} inline addMode={adding} />
          </div>
        </div>
      </div>
    )
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

  // One renderer per flat shell tab. Every tab fills the same content area;
  // there are no nested tab strips inside a view.
  const renderEntry = (e: ShellEntry): ReactNode => {
    switch (e.kind) {
      case 'files':
        return <FileExplorer authFetch={authFetch} workspaces={workspacesApi?.workspaces || []} onFileSelect={(entry, opts) => { void openFile(entry, opts) }} selectedPath={activeTab} onRegisterActions={handleRegisterExplorerActions} onAddFolder={openAddFolder} onCloseWorkspace={(id) => { void handleCloseWorkspace(id) }} roster={collabRoster} />
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
            <div className="flex-1 min-h-0 relative">{renderTabContent(tab)}</div>
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
        return <Chat workspaceId={workspaceId} workspaceName={(workspacesApi?.workspaces || []).find((w) => w.id === workspaceId)?.name} token={token} username={username} color={colorFromName(username)} />
      case 'api':
        return <ApiInstance key={e.apiId} workspaceId={workspaceId} authFetch={authFetch} readOnly={role === 'viewer'} />
      case 'log':
        return <LogView key={e.logId} authFetch={authFetch} workspaceId={workspaceId} />
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
              onToggleLock={setShellLock}
              onSetViewMode={setShellViewMode}
              onReorder={(from, to) => {
                if (from === e.id || to === e.id) return
                reorderShell(from, to)
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
            onOpenFolder={() => setShowFolderPicker(true)}
            workspace={workspace}
            editorSettings={editorSettings}
            onEditorSettingsChange={handleEditorSettingsChange}
            lspAvailable={lspAvailable}
            desktopMode={desktopMode}
            onDesktopModeChange={setDesktopMode}
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
          detachAbove
          dragAnyDirection
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

  const viewMenu = (desktop: boolean) => (
    <ViewMenu
      views={VIEW_TABS}
      visible={visible}
      onToggle={(kind) => toggleVisible(kind as ViewKind)}
      onAdd={(kind) => {
        if (kind === 'web') addWeb()
        else if (kind === 'api') addApi()
        else if (kind === 'terminals') addTerminalTab()
        else if (kind === 'search') addSearch()
        else if (kind === 'log') addLog()
      }}
      onOpenFolder={() => setShowFolderPicker(true)}
      onLogout={onLogout}
      onClose={() => setMenuOpen(false)}
      desktop={desktop}
      folderName={folderName}
      workspaceSwitcher={<WorkspaceSwitcher workspacesApi={workspacesApi} menuUp />}
      onToggleDesktop={() => setDesktopMode(!desktopMode)}
      placement={menuPlacement}
      onPlacement={setMenuPlacement}
      onResetView={resetView}
      username={username}
      users={collabRoster}
      selfId={selfId}
      teacher={teacher}
      presenter={presenter}
      followTargetId={followTargetId}
      followMode={followMode}
      onFollow={(id, mode) => { setFollowTargetId(id); setFollowMode(mode) }}
      onUnfollow={() => { setFollowTargetId(null); setFollowMode(null) }}
      onLeadChange={(on) => { if (on) startLead(); else stopLead() }}
    />
  )

  return (
    <div className="h-[100dvh] flex bg-bg-base overflow-hidden">
      {desktopMode && viewMenu(true)}

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
                onToggleLock={setShellLock}
                onSetViewMode={setShellViewMode}
                onReorder={reorderShell}
                onDragDetach={(id) => setModeDrag(id)}
                onDropViewMode={dropViewMode}
                onDragCancelViewMode={() => setModeDrag(null)}
                onDragAway={handleDragAway}
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
                      className="min-w-[180px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary"
                      style={{ width: `${dockSizes.left}%` }}>
                      {dockedLeft.length === 1 && dockedLeft[0].kind === 'container'
                        ? renderEntry(dockedLeft[0])
                        : dockArea('left', dockedLeft)}
                    </div>
                    <div
                      data-dock-resize="left"
                      onPointerDown={(e) => beginDockResize('left', e)}
                      className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors touch-none"
                      title="Resize left container" />
                  </>
                ) : modeDrag ? dropSlot(null, 'docked-left') : null}

                <div className="flex-1 min-w-0 min-h-0 relative bg-bg-primary">
                  {centerEntry ? (
                    <div className="absolute inset-0 flex flex-col">{renderEntry(centerEntry)}</div>
                  ) : (
                    <div className="h-full flex items-center justify-center px-6 text-center text-text-muted">
                      <span className="text-[12px]">select a tab to show it in the center</span>
                    </div>
                  )}
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
                      className="min-w-[180px] max-w-[65%] shrink-0 flex flex-col bg-bg-primary"
                      style={{ width: `${dockSizes.right}%` }}>
                      {dockedRight.length === 1 && dockedRight[0].kind === 'container'
                        ? renderEntry(dockedRight[0])
                        : dockArea('right', dockedRight)}
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
                    className="min-h-[100px] max-h-[70%] shrink-0 flex flex-col bg-bg-primary"
                    style={{ height: `${dockSizes.bottom}%` }}>
                    {dockedBottom.length === 1 && dockedBottom[0].kind === 'container'
                      ? renderEntry(dockedBottom[0])
                      : dockArea('bottom', dockedBottom)}
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
        onOpenFolder={() => setShowFolderPicker(true)}
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

      {shareCursors && <RemoteCursors mice={collabMice} roster={collabRoster} />}
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
