import { useState, useEffect, useCallback } from 'react'
import { workspacesUrl, sessionsUrl } from '../api'
import { setActiveWorkspaceId as syncActiveWorkspaceId } from '../lib/activeWorkspace'
import type { AuthFetch, WorkspaceSummary, WorkspaceTemplate } from '../types'

interface WorkspaceListResponse {
  workspaces?: WorkspaceSummary[]
}

interface SessionListResponse {
  sessions?: WorkspaceSummary[]
  templates?: WorkspaceTemplate[]
}

interface WorkspaceErrorResponse {
  error?: string
}

const URL_HASH_PREFIX = '#session/'
const WORKSPACE_QUERY_KEY = 'workspace'

// Read the session ID from the URL query string (e.g. "?workspace=abc123"),
// falling back to the legacy "#session/abc123" hash.
function urlSessionId(): string | null {
  const q = new URLSearchParams(window.location.search).get(WORKSPACE_QUERY_KEY)
  if (q) return q
  const hash = window.location.hash
  if (hash.startsWith(URL_HASH_PREFIX)) return hash.slice(URL_HASH_PREFIX.length)
  return null
}

// Write the session ID to the URL query string so F5 restores the workspace.
// The hash is left untouched (legacy links still work).
function setUrlSessionId(id: string | null) {
  const params = new URLSearchParams(window.location.search)
  if (id) params.set(WORKSPACE_QUERY_KEY, id)
  else params.delete(WORKSPACE_QUERY_KEY)
  const qs = params.toString()
  history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
}

function savedSessionId(): string | null {
  return urlSessionId()
}

// useWorkspaces manages active sessions and configured templates. After login,
// if there is exactly one active session it is selected automatically; with
// several, App shows the in-card workspace picker instead of guessing.
export function useWorkspaces(token: string | null | undefined, authFetch: AuthFetch) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([])
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(savedSessionId)
  const [loading, setLoading] = useState(!!token)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  syncActiveWorkspaceId(activeWorkspaceId)

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdState(id)
    setUrlSessionId(id)
  }, [])

  const choose = useCallback((list: WorkspaceSummary[]) => {
    setActiveWorkspaceIdState((prev) => {
      if (prev && list.some((r) => r.id === prev)) return prev
      const saved = savedSessionId()
      if (saved && list.some((r) => r.id === saved)) return saved
      if (list.length === 1) return list[0].id
      return null
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!token) {
      setWorkspaces([])
      setTemplates([])
      setLoading(false)
      setLoadedFor(null)
      return
    }
    setLoading(true)
    try {
      const res = await authFetch(sessionsUrl)
      if (res.ok) {
        const data: SessionListResponse = await res.json()
        const list = data.sessions || []
        setWorkspaces(list)
        setTemplates(data.templates || [])
        choose(list)
        return
      }
      // Backward compatibility with servers that only expose /api/workspaces.
      const fallback = await authFetch(workspacesUrl)
      const data: WorkspaceListResponse = await fallback.json()
      const list = data.workspaces || []
      setWorkspaces(list)
      setTemplates([])
      choose(list)
    } catch { /* ignore network/parse errors; caller UI degrades gracefully */ }
    finally { setLoading(false); setLoadedFor(token ?? null) }
  }, [token, authFetch, choose])

  const createWorkspace = useCallback(async (name: string, path: string): Promise<WorkspaceSummary> => {
    const res = await authFetch(workspacesUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    })
    const workspace: WorkspaceSummary & WorkspaceErrorResponse = await res.json()
    if (!res.ok) throw new Error(workspace.error || 'failed to create workspace')
    await refresh()
    setActiveWorkspaceId(workspace.id)
    return workspace
  }, [authFetch, refresh, setActiveWorkspaceId])

  const createSession = useCallback(async (template: string, name: string): Promise<WorkspaceSummary> => {
    const res = await authFetch(sessionsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, name }),
    })
    const session: WorkspaceSummary & WorkspaceErrorResponse = await res.json()
    if (!res.ok) throw new Error(session.error || 'failed to create session')
    await refresh()
    setActiveWorkspaceId(session.id)
    return session
  }, [authFetch, refresh, setActiveWorkspaceId])

  // closeWorkspace ends an active session (editor+ only, server-side).
  const closeWorkspace = useCallback(async (id: string) => {
    const res = await authFetch(`${sessionsUrl}/${id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      const data: WorkspaceErrorResponse = await res.json().catch(() => ({}))
      throw new Error(data.error || 'failed to close workspace')
    }
    setActiveWorkspaceIdState((cur) => (cur === id ? null : cur))
    await refresh()
  }, [authFetch, refresh])

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (token) void refresh()
  }, [token, refresh])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist the active workspace in the URL (including auto-selection of a
  // single session) so a refresh restores the same workspace.
  useEffect(() => {
    if (!token) return
    setUrlSessionId(activeWorkspaceId)
  }, [token, activeWorkspaceId])

  return {
    workspaces, sessions: workspaces, templates, activeWorkspaceId, loading,
    ready: !!token && loadedFor === token,
    setActiveWorkspaceId, createWorkspace, createSession, closeWorkspace, refresh,
  }
}
