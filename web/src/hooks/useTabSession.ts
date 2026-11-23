import { useState, useEffect, useCallback, useRef } from 'react'
import { workspaceUrl } from '../api'
import type { AuthFetch } from '../types'

// Recursive layout format — spec's LAYOUT_STATE exactly.
// No extra fields. The tree IS the layout.

export interface LayoutTab {
  id: number
  type: string
  name: string
  dim?: [number, number]
}

export interface LayoutContainer {
  selected_tab?: number
  tabs: LayoutTab[]
  attached?: {
    left?: { width: number; container: LayoutContainer }
    bottom?: { height: number; container: LayoutContainer }
    right?: { width: number; container: LayoutContainer }
  }
}

export interface LayoutRoot {
  next_tab_id: number
  focused_tab_id?: number
  main: LayoutContainer
  floating?: Array<{
    top: number
    left: number
    width: number
    height: number
    container: LayoutContainer
  }>
}

export interface TabLayout {
  // Recursive layout tree — the single source of truth for container hierarchy.
  layout?: LayoutRoot
  // Tab category visibilities — which tab types are visible.
  visible?: Record<string, boolean>
  // Per-tab cursor/scroll positions — spec's tab_content_states.
  tabContentStates?: Record<string, { line: number; col: number }>
}

// Each browser tab owns its own default view state. sessionStorage (not
// localStorage) keeps two tabs of the same user from silently sharing a layout.
const TAB_KEY = 'wede_tab_view_id'

function tabId(): string {
  let id = sessionStorage.getItem(TAB_KEY)
  if (!id) {
    id = Math.random().toString(36).slice(2, 8)
    sessionStorage.setItem(TAB_KEY, id)
  }
  return id
}

function sessionName(username: string): string {
  return username ? `user:${username}:${tabId()}` : `user:${tabId()}`
}

export interface TabSessionOpts {
  workspaceId: string | null
  authFetch: AuthFetch
  username: string
  collabContext?: string | null
  tabViewState?: string | null
  dir?: string | null
}

export interface TabSession {
  name: string
  layout: TabLayout | null
  loading: boolean
  saveLayout: (layout: TabLayout) => void
  saveNow: () => void
  stopSaving: () => void
  clear: () => Promise<void>
}

export function useTabSession(opts: TabSessionOpts): TabSession {
  const { workspaceId, authFetch, username, collabContext = null, tabViewState = null, dir = null } = opts
  const name = tabViewState
    ? (tabViewState.startsWith('user:') ? tabViewState : `user:${tabViewState}`)
    : sessionName(username)

  const [layout, setLayout] = useState<TabLayout | null>(null)
  const [loading, setLoading] = useState(!!workspaceId)

  const pendingRef = useRef<TabLayout | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedRef = useRef(false)

  const qs = () => {
    const p = new URLSearchParams()
    if (collabContext) p.set('context', collabContext)
    if (dir) p.set('dir', dir)
    const s = p.toString()
    return s ? `?${s}` : ''
  }

  // Layout is loaded via WebSocket init packet, not REST.
  // The REST endpoint is only used for saving (PUT) and listing sessions.
  useEffect(() => {
    if (workspaceId) setLoading(false)
  }, [workspaceId])

  const flush = useCallback(async () => {
    if (!workspaceId || stoppedRef.current) return
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    try {
      const res = await authFetch(workspaceUrl(workspaceId, `/tab_sessions/${encodeURIComponent(name)}${qs()}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: pending }),
      })
      if (res.ok) setLayout(pending)
    } catch { /* ignore */ }
  }, [workspaceId, name, authFetch, collabContext, dir])

  const saveLayout = useCallback((l: TabLayout) => {
    if (stoppedRef.current) return
    pendingRef.current = l
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, 500)
  }, [flush])

  // stopSaving is called when another device takes over this tab view state.
  // The new owner must not be overwritten by this tab's delayed layout saves.
  const stopSaving = useCallback(() => {
    stoppedRef.current = true
    pendingRef.current = null
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  const saveNow = useCallback(() => {
    if (stoppedRef.current) return
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    void flush()
  }, [flush])

  const clear = useCallback(async () => {
    if (!workspaceId) return
    try {
      await authFetch(workspaceUrl(workspaceId, `/tab_sessions/${encodeURIComponent(name)}${qs()}`), { method: 'DELETE' })
    } catch { /* ignore */ }
    pendingRef.current = null
    setLayout(null)
  }, [workspaceId, name, authFetch, collabContext, dir])

  useEffect(() => {
    const onUnload = () => {
      if (pendingRef.current) void flush()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [flush])

  return { name, layout, loading, saveLayout, saveNow, stopSaving, clear }
}
