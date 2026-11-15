import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'
import { useWorkspaces } from './hooks/useWorkspaces'
import Logo from './components/Logo'
import ThemePicker from './components/ThemePicker'
import Login from './components/Login'
import FolderPicker from './components/FolderPicker'
import IDE from './components/IDE'

const FOLDER_QUERY_KEY = 'folder'
const PATH_QUERY_KEY = 'path'

// Read the folder path from the URL query string. "?path=" is the current key;
// "?folder=" is accepted for older links.
function urlFolder(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get(PATH_QUERY_KEY) || params.get(FOLDER_QUERY_KEY)
}

// Write the folder path to the URL query string, preserving the hash.
function setUrlFolder(folder: string | null) {
  const params = new URLSearchParams(window.location.search)
  if (folder) params.set(PATH_QUERY_KEY, folder)
  else params.delete(PATH_QUERY_KEY)
  params.delete(FOLDER_QUERY_KEY)
  const qs = params.toString()
  const search = qs ? '?' + qs : ''
  history.replaceState(null, '', window.location.pathname + search + window.location.hash)
}

interface WorkspaceFolderState {
  hasWorkspace?: boolean
  current?: string
  recents?: string[]
  [key: string]: unknown
}

function App() {
  const { token, username, role, teacher, login, logout, redeem, error, locked, remaining, authFetch, updateUsername } = useAuth()
  const { theme, setTheme } = useTheme()
  const workspacesApi = useWorkspaces(token, authFetch)
  const { createWorkspace, setActiveWorkspaceId, workspaces } = workspacesApi

  const [workspace, setWorkspace] = useState<WorkspaceFolderState | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchWorkspace = useCallback(async () => {
    if (!token) return
    try {
      const res = await authFetch('/api/folder')
      const data: WorkspaceFolderState = await res.json()
      // If the URL has a folder param, prefer it; otherwise use the API response.
      const fromUrl = urlFolder()
      if (fromUrl) {
        setWorkspace({ ...data, current: fromUrl, hasWorkspace: true })
      } else {
        setWorkspace(data)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [token, authFetch])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (token) void fetchWorkspace()
    else setLoading(false)
  }, [token, fetchWorkspace])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Handle ?invite=TOKEN in the URL: redeem the token then strip the param so
  // the invite link isn't reusable by copy-pasting from the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('invite')
    if (!invite) return
    history.replaceState({}, '', window.location.pathname)
    redeem(invite).catch(() => {})
  }, [redeem])

  // Keep ?path= in sync with the active workspace root so a refresh restores
  // the folder (and the backend can resolve it before the IDE mounts).
  useEffect(() => {
    const root = workspaces.find((w) => w.id === workspacesApi.activeWorkspaceId)?.root
    if (root) setUrlFolder(root)
  }, [workspaces, workspacesApi.activeWorkspaceId])

  // Opening a folder adopts it as a real session (or focuses the existing
  // session with the same root) so the workspace always has a folder attached
  // instead of leaving the user on a separate "open folder" step.
  const openFolderAsWorkspace = useCallback(async (path: string) => {
    setWorkspace((w) => ({ ...(w || {}), current: path, hasWorkspace: true }))
    setUrlFolder(path)
    const norm = path.replace(/\/+$/, '')
    const existing = workspaces.find((w) => (w.root || '').replace(/\/+$/, '') === norm)
    if (existing) {
      setActiveWorkspaceId(existing.id)
      return
    }
    try {
      const name = norm.split('/').filter(Boolean).pop() || 'workspace'
      const ws = await createWorkspace(name, path)
      if (ws?.id) setActiveWorkspaceId(ws.id)
    } catch { /* createWorkspace surfaces its own errors */ }
  }, [workspaces, createWorkspace, setActiveWorkspaceId])

  // If the URL carries ?path= (or ?folder=) and no workspace is active yet,
  // auto-create (or focus) the workspace from that path so the user skips the
  // "Choose workspace" screen and lands directly in the IDE.
  useEffect(() => {
    if (!workspacesApi.ready) return
    if (workspacesApi.activeWorkspaceId) return
    const fromUrl = urlFolder()
    if (!fromUrl) return
    void openFolderAsWorkspace(fromUrl)
  }, [workspacesApi.ready, workspacesApi.activeWorkspaceId, openFolderAsWorkspace])

  // First visit - pick theme
  if (!theme) {
    return <ThemePicker onSelect={setTheme} />
  }

  if (!token) {
    return <Login onLogin={login} error={error} locked={locked} remaining={remaining} />
  }

  // Wait for the workspace list before deciding what to show.
  if (loading || !workspacesApi.ready) {
    return (
      <div className="min-h-screen bg-bg-tertiary flex items-center justify-center">
        <div className="animate-fade-in text-center">
          <div className="w-10 h-10 rounded-xl bg-bg-primary border border-border flex items-center justify-center mx-auto mb-3 overflow-hidden">
            <Logo size={28} />
          </div>
          <div className="text-text-muted text-sm">Loading...</div>
        </div>
      </div>
    )
  }

  // After sign-in: join an existing session or create one from a template. A
  // single active session is selected automatically by useWorkspaces.
  if (!workspacesApi.activeWorkspaceId) {
    const hasChoices = workspacesApi.sessions.length > 0 || workspacesApi.templates.length > 0
    if (!hasChoices) {
      return (
        <FolderPicker
          authFetch={authFetch}
          recents={workspace?.recents || []}
          onOpen={openFolderAsWorkspace}
        />
      )
    }
    return (
      <Login
        onLogin={login}
        error={error}
        locked={locked}
        remaining={remaining}
        authenticated
        username={username}
        sessions={workspacesApi.sessions}
        templates={workspacesApi.templates}
        sessionsLoading={workspacesApi.loading}
        onJoinSession={setActiveWorkspaceId}
        onCreateSession={workspacesApi.createSession}
        onLogout={logout}
      />
    )
  }

  // The active root path tracks the focused workspace (which follows the active
  // editor tab in multi-root), so the top bar / status bar / DAP reflect it.
  const activeWs = workspaces.find((w) => w.id === workspacesApi.activeWorkspaceId)
  const activeRoot = activeWs?.root || workspace?.current

  return (
    <IDE
      token={token}
      authFetch={authFetch}
      onLogout={logout}
      workspace={activeRoot ?? null}
      recents={workspace?.recents || []}
      onWorkspaceChange={openFolderAsWorkspace}
      workspaceId={workspacesApi.activeWorkspaceId}
      workspacesApi={workspacesApi}
      username={username}
      onUsernameChange={updateUsername}
      role={role}
      teacher={teacher}
    />
  )
}

export default App
