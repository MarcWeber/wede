import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './hooks/useAuth'
import { useWorkspaces, urlCustomDirectory, urlCollabContext, urlTabViewState } from './hooks/useWorkspaces'
import Logo from './components/Logo'
import Login from './components/Login'
import IDE from './components/IDE'
import ChooseWorkspaceAndTabSession from './components/ChooseWorkspaceAndTabSession'
import { navigateToSession } from './lib/sessionNav'
import { workspaceUrl } from './api'

interface WorkspaceFolderState {
  hasWorkspace?: boolean
  current?: string
  recents?: string[]
  home?: string
  [key: string]: unknown
}

function App() {
  const { token, username, role, teacher, debug, login, loginWithToken, logout, redeem, error, remaining, authFetch, updateUsername } = useAuth()
  const workspacesApi = useWorkspaces(token, authFetch)
  const { createWorkspace, setActiveWorkspaceId, workspaces } = workspacesApi
  const activeWs = workspaces.find((w) => w.id === workspacesApi.activeWorkspaceId)
  // collab_context defaults to the workspace name, matching the chooser and the
  // server-side session key. Without this the chooser would list states under
  // one context while the IDE saved them under another.
  const collabContext = urlCollabContext() || activeWs?.name || null
  const tabViewState = urlTabViewState()

  const [workspace, setWorkspace] = useState<WorkspaceFolderState | null>(null)
  const [loading, setLoading] = useState(true)
  const [allowCustomDirectory, setAllowCustomDirectory] = useState<boolean | null>(null)
  const [resolvingCustomDir, setResolvingCustomDir] = useState(false)
  const customDirRef = useRef<string | null>(null)
  // A view state is claimed only if no other socket already uses it. When it is
  // in use elsewhere we show the chooser instead of silently sharing a layout.
  const [claim, setClaim] = useState<'checking' | 'blocked' | 'free'>('checking')

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

  // Exchange link credentials immediately, then remove them from browser
  // history. Keep workspace and other navigation parameters intact.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const loginToken = params.get('login_token')
    if (loginToken) {
      const name = params.get('user') || ''
      params.delete('login_token')
      params.delete('user')
      const qs = params.toString()
      history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
      void loginWithToken(loginToken, name)
      return
    }

    const invite = params.get('invite')
    if (!invite) return
    params.delete('invite')
    const qs = params.toString()
    history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
    redeem(invite).catch(() => {})
  }, [loginWithToken, redeem])

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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const wsId = workspacesApi.activeWorkspaceId
    if (!workspacesApi.ready || !wsId) { setClaim('free'); return }
    // A [use-here] choice asks for the state even if another socket has it.
    // Consume the flag so a later F5 goes back to the normal connected check.
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('takeover') === '1') {
      urlParams.delete('takeover')
      const qs = urlParams.toString()
      history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
      setClaim('free')
      return
    }
    if (!tabViewState) { setClaim('free'); return }
    let cancelled = false
    setClaim('checking')
    const params = new URLSearchParams()
    if (collabContext) params.set('context', collabContext)
    const qs = params.toString()
    authFetch(workspaceUrl(wsId, `/tab_sessions${qs ? `?${qs}` : ''}`))
      .then((res) => res.json())
      .then((data: { tab_sessions?: { name: string; connected?: boolean }[] }) => {
        if (cancelled) return
        const name = tabViewState.startsWith('user:') ? tabViewState : `user:${tabViewState}`
        const state = (data.tab_sessions || []).find((s) => s.name === name)
        setClaim(state?.connected ? 'blocked' : 'free')
      })
      .catch(() => { if (!cancelled) setClaim('free') })
    return () => { cancelled = true }
  }, [workspacesApi.ready, workspacesApi.activeWorkspaceId, collabContext, tabViewState, authFetch])
  /* eslint-enable react-hooks/set-state-in-effect */

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
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!workspacesApi.ready || allowCustomDirectory !== true) return
    const dir = urlCustomDirectory()
    if (!dir || customDirRef.current === dir.path) return
    customDirRef.current = dir.path
    setResolvingCustomDir(true)
    void openDirectoryAsWorkspace(dir.path, dir.name).finally(() => setResolvingCustomDir(false))
  }, [workspacesApi.ready, allowCustomDirectory, openDirectoryAsWorkspace])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!token) {
    return <Login onLogin={login} error={error} remaining={remaining} />
  }

  // Wait for the workspace list before deciding what to show. The ui-config
  // flag is needed first so ?workspace=directory: links can resolve without
  // flashing the chooser.
  if (loading || !workspacesApi.ready || allowCustomDirectory === null || resolvingCustomDir || claim === 'checking') {
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

  // Main state is { workspace?, modal? }: without a workspace the only sensible
  // screen is the chooser — showing the IDE without one is misleading.
  if (!workspacesApi.activeWorkspaceId) {
    return (
      <div className="min-h-screen bg-bg-tertiary flex items-center justify-center p-4">
        <ChooseWorkspaceAndTabSession
          embedded
          workspacesApi={workspacesApi}
          authFetch={authFetch}
          currentWorkspaceId={null}
          currentCollabContext={collabContext}
          currentTabViewState={null}
          username={username}
          showCancel={false}
          onCancel={() => { /* nothing to cancel back to */ }}
          onApply={navigateToSession}
          onLogout={logout}
          onCloseAllAndLogout={logout}
        />
      </div>
    )
  }

  if (claim === 'blocked' && workspacesApi.activeWorkspaceId) {
    return (
      <div className="min-h-screen bg-bg-tertiary flex items-center justify-center p-4">
        <ChooseWorkspaceAndTabSession
          embedded
          workspacesApi={workspacesApi}
          authFetch={authFetch}
          currentWorkspaceId={workspacesApi.activeWorkspaceId}
          currentCollabContext={collabContext}
          currentTabViewState={tabViewState}
          username={username}
          showCancel={false}
          onCancel={() => { /* the state is in use elsewhere */ }}
          onApply={navigateToSession}
          onLogout={logout}
          onCloseAllAndLogout={logout}
        />
      </div>
    )
  }

  // The active root path tracks the focused workspace (which follows the active
  // editor tab in multi-root), so the top bar / status bar / DAP reflect it.
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
      debug={debug}
      collabContext={collabContext}
      tabViewState={tabViewState}
    />
  )
}

export default App
