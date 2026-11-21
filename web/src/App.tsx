import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'
import { useWorkspaces, urlCustomDirectory } from './hooks/useWorkspaces'
import Logo from './components/Logo'
import ThemePicker from './components/ThemePicker'
import Login from './components/Login'
import IDE from './components/IDE'

interface WorkspaceFolderState {
  hasWorkspace?: boolean
  current?: string
  recents?: string[]
  home?: string
  [key: string]: unknown
}

function App() {
  const { token, username, role, teacher, login, logout, redeem, error, remaining, authFetch, updateUsername } = useAuth()
  const { theme, setTheme } = useTheme()
  const workspacesApi = useWorkspaces(token, authFetch)
  const { createWorkspace, setActiveWorkspaceId, workspaces } = workspacesApi

  const [workspace, setWorkspace] = useState<WorkspaceFolderState | null>(null)
  const [loading, setLoading] = useState(true)
  const [allowCustomDirectory, setAllowCustomDirectory] = useState<boolean | null>(null)
  const customDirRef = useRef<string | null>(null)

  const fetchWorkspace = useCallback(async () => {
    if (!token) return
    try {
      const res = await authFetch('/api/folder')
      const data: WorkspaceFolderState = await res.json()
      setWorkspace(data)
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

  // Custom directories are opt-in per deployment. The flag also gates the
  // WorkspaceSwitcher's manual path entry.
  useEffect(() => {
    let cancelled = false
    fetch('/api/ui-config')
      .then((r) => r.json())
      .then((data: { workspace_allow_custom_directory?: unknown }) => {
        if (!cancelled) setAllowCustomDirectory(data.workspace_allow_custom_directory === true)
      })
      .catch(() => { if (!cancelled) setAllowCustomDirectory(false) })
    return () => { cancelled = true }
  }, [])

  // Opening a directory adopts it as a real workspace (or focuses the existing
  // workspace with the same root). Workspace switching itself lives in
  // WorkspaceSwitcher; there is no separate folder picker.
  const openDirectoryAsWorkspace = useCallback(async (path: string, requestedName?: string) => {
    setWorkspace((w) => ({ ...(w || {}), current: path, hasWorkspace: true }))
    const norm = path.replace(/\/+$/, '')
    const existing = workspaces.find((w) => (w.root || '').replace(/\/+$/, '') === norm)
    if (existing) {
      setActiveWorkspaceId(existing.id)
      return
    }
    try {
      const name = requestedName?.trim() || norm.split('/').filter(Boolean).pop() || 'workspace'
      const ws = await createWorkspace(name, path)
      if (ws?.id) setActiveWorkspaceId(ws.id)
    } catch { /* createWorkspace surfaces its own errors */ }
  }, [workspaces, createWorkspace, setActiveWorkspaceId])

  // ?workspace=directory:<path>&name=<name> selects a custom directory. It is
  // ignored unless the deployment opted in.
  useEffect(() => {
    if (!workspacesApi.ready || allowCustomDirectory !== true) return
    const dir = urlCustomDirectory()
    if (!dir || customDirRef.current === dir.path) return
    customDirRef.current = dir.path
    void openDirectoryAsWorkspace(dir.path, dir.name)
  }, [workspacesApi.ready, allowCustomDirectory, openDirectoryAsWorkspace])

  // First visit - pick theme
  if (!theme) {
    return <ThemePicker onSelect={setTheme} />
  }

  if (!token) {
    return <Login onLogin={login} error={error} remaining={remaining} />
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
    return (
      <Login
        onLogin={login}
        error={error}
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
      home={workspace?.home ?? null}
      allowCustomDirectory={allowCustomDirectory === true}
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
