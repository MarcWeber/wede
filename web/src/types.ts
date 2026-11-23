// Shared domain types for the wede frontend, used across lib/hooks/components.
// Kept intentionally loose where the backend's JSON shapes are informally typed
// (this is a type-level migration only — no runtime validation was added).

// An open editor tab. Ordinary file tabs carry `rel` + `workspaceId` and a
// composite `path` (see lib/fileKey.ts); "special" tabs (browser/gitgraph/
// apiclient) use a `type`-prefixed pseudo-id as `path` and no `rel`/`workspaceId`.
export interface Tab {
  path: string
  rel?: string
  workspaceId?: string | null
  name?: string
  // (string & {}) rather than plain `string` on these two: keeps the known
  // literals as autocomplete/documentation hints without TS collapsing the
  // union to bare `string` (which no-redundant-type-constituents flags).
  type?: 'browser' | 'gitgraph' | 'apiclient' | (string & {})
  url?: string
  content?: string
  originalContent?: string
  modified?: boolean
  manual?: boolean
  preview?: boolean
  locked?: boolean
  fileType?: 'image' | 'binary' | (string & {})
  dataUrl?: string
  size?: number
  targetLine?: number
  // Selection to apply when following a peer (1-based; anchor/head in any order).
  targetSelection?: { anchorLine: number; anchorCol: number; headLine: number; headCol: number }
  // PDF page (+ normalized point) to reveal when jumping to a peer's cursor.
  targetPdf?: { page: number; u?: number; v?: number }
  // Normalized image point to centre when jumping to a peer's cursor.
  targetImage?: { u: number; v: number }
  // Bumped on every follow/jump request so repeat clicks re-scroll even when
  // the target values are unchanged.
  targetSeq?: number
  [key: string]: unknown
}

// A file/folder entry as surfaced by the file tree, search results, or quick
// open — all three shapes are used interchangeably as openFile() targets.
export interface FileEntry {
  path: string
  name?: string
  rel?: string
  workspaceId?: string | null
  isDir?: boolean
  [key: string]: unknown
}

export interface WorkspaceSummary {
  id: string
  name: string
  template?: string
  path?: string
  root?: string
  users?: number
  age_secs?: number
  timeout_secs?: number
  [key: string]: unknown
}

export interface WorkspaceTemplate {
  name: string
  path: string
  timeout_secs: number
  lsp?: string[]
}

// authFetch shape returned by useAuth — a fetch-alike that injects the auth
// header, rewrites legacy /api paths to the active workspace, and logs out on 401.
export type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>

export interface TerminalSession {
  id: number
  name: string
  manual?: boolean
  initial?: string
  // preventHide is per-user (part of the tab_view_state dump); preventClose is
  // shared state sent to the server so no user can kill the PTY by accident.
  locked?: boolean      // alias for preventHide (legacy)
  preventHide?: boolean
  preventClose?: boolean
}

// Imperative handle exposed by the <Terminal> component (via useImperativeHandle)
// so the mobile toolbar and floating-window chrome can send raw input.
export interface TerminalHandle {
  send: (data: string) => void
}

// What a vertical swipe on the terminal sends. 'scroll' is native touch
// scrolling; 'cursor' sends arrow keys; the others send keys for TUIs.
export type TerminalSwipeMode = 'scroll' | 'cursor' | 'page' | 'half' | 'emacs' | 'wheel'

// Terminal display settings — persisted in localStorage, shared across all
// terminal instances for a user.
export interface TerminalSettings {
  fontSize: number       // font size in px (default 12)
  minCols: number        // minimum PTY columns; below this the view scrolls (0 = fit to width)
  minRows: number        // minimum PTY rows; below this the view scrolls (0 = fit to height)
  scrollback: number     // scrollback lines (default 5000)
  followMode: 'off' | 'follow' | 'shrink' | 'zoom'  // 'off': normal layout; 'follow': normal layout; 'shrink': fill remaining space and reflow rows; 'zoom': keep rows/cols and y-scale to fit (default 'off')
  followCursor: boolean  // keep the cursor visible in any keyboard layout (default false)
  maximizeOnKeyboard: boolean  // expand the terminal panel to the viewport while the keyboard is open (default true)
  followMargin: number   // safety margin below the cursor, fraction of terminal height (default 0.2)
  swipeMode: TerminalSwipeMode  // one-finger vertical swipe action (default 'wheel')
  swipeModeDouble: TerminalSwipeMode  // two-finger vertical swipe action (default 'cursor')
  swipeStep: number  // px per arrow key for swipe (default 13)
  writeDelayMs: number   // wait before sending a new terminal's initial command (default 250)
}

// A member of a workspace's live collaboration roster, as broadcast by the
// backend's /collab websocket ({type:'presence', members:[...]}).
export interface PresenceMember {
  id: string
  username?: string
  color?: string
  file?: string
  line?: number
  anchorLine?: number // selection start line (1-based, 0 = no selection)
  anchorCol?: number  // selection start column (1-based, 0 = no selection)
  headLine?: number   // selection end line (1-based, 0 = no selection)
  headCol?: number    // selection end column (1-based, 0 = no selection)
  tabs?: string[]
  [key: string]: unknown
}

export interface CollabPresenter {
  id: string
  username: string
  since: string
}

// Semantic collaborator pointer. Coordinates are expressed in the content's
// own space (line/column for code, page + normalized point for PDFs, image
// space for images) so they survive desktop/mobile layout and UI-scale changes.
export type CollabPointer =
  | { kind: 'code'; tab: string; line: number; col: number }
  | { kind: 'image'; tab: string; u: number; v: number }
  | { kind: 'pdf'; tab: string; page: number; u: number; v: number }
  | { kind: 'terminal'; tab: string; row: number; col: number }
  | { kind: 'browser'; tab: string; url: string; u: number; v: number }
  | { kind: 'panel'; tab: string; u: number; v: number }

export type CollabPointerKind = CollabPointer['kind']

// A persisted/live chat message, as broadcast by the backend's /chat websocket
// ({type:'history', messages:[...]} on join, {type:'msg', message:{...}} live).
export interface ChatMessage {
  id?: string | number
  // (string & {}): see the Tab.type comment above — same autocomplete-without-collapse idiom.
  kind: 'user' | 'git' | (string & {})
  user?: string
  color?: string
  text?: string
  time?: string
  [key: string]: unknown
}

// Persisted editor preferences (src/hooks lives outside this, IDE.tsx owns the
// state) — read by Editor/Settings/DebugPanel.
export interface EditorSettings {
  fontSize: number
  tabWidth: number
  wordWrap: boolean
  autoSave: boolean
  minimap: boolean
  lsp: boolean
  formatOnSave: boolean
  collab?: boolean
  shareCursors?: boolean
  // 'smart' renders one digit per gutter row (stacked, width = 1 char) with
  // bold 10s and 5s as orientation marks — the phone-friendly default.
  numbering?: 'normal' | 'smart' | 'hidden'
  [key: string]: unknown
}

// A user-defined task from ~/.wede/tasks.json (or a trusted project's
// .wede/tasks.json), run in a new terminal by TasksPanel/IDE.
export interface Task {
  name?: string
  command: string
  cwd?: string
}

// Actions a mounted <FileExplorer> registers with the parent IDE so the
// command palette / SSE watcher can trigger them without prop drilling.
export interface ExplorerActions {
  refresh: () => void
  newFile: () => void
  newFolder: () => void
  expandAll?: () => void
  collapseAll?: () => void
}

// Actions a mounted <Editor> registers with the parent IDE (currently just
// Ctrl+G "go to line").
export interface EditorActions {
  goToLine: () => void
}

// Which DAP-capable languages are available server-side, keyed by language id
// (from GET /api/dap/available), plus the extension→language map.
export interface DapAvailableInfo {
  available: Record<string, boolean>
  extensions: Record<string, string>
}

