import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, TerminalSquare } from 'lucide-react'
import { workspaceUrl } from '../api'
import type { AuthFetch, Tab, PresenceMember } from '../types'

interface RemoteTabState {
  name: string
  username?: string
  tabs?: string[]
}

function stripUser(name: string): string {
  return name.startsWith('user:') ? name.slice('user:'.length) : name
}

function isFileTab(tab: { type?: string }): boolean {
  return !tab.type || tab.type === 'gitgraph'
}

export interface SessionTabsProps {
  workspaceId: string | null
  authFetch: AuthFetch
  collabContext: string | null
  currentState: string
  tabs: Tab[]
  activeTab: string | null
  collabRoster?: PresenceMember[]
  autoRefresh: boolean
  onOpenTab: (path: string) => void
  // Activate a terminal tab (bring to front)
  onActivateTerminal: (id: number) => void
  // Open a file at another user's scroll location
  onOpenFileWhere: (path: string, line?: number) => void
}

/**
 * SessionTabs — a simple flat list of all open tabs across all connected users.
 * 
 * Layout:
 *   tab1 (N) [user list]
 *   tab2 (N) [user list]
 *   term1
 *   term2
 * 
 * N = how many users have this tab open in this workspace.
 * 
 * If ≤3 users, show usernames; otherwise show count with popup for details.
 * 
 * Clicking:
 *   - File name: activates the file (opens if not already open)
 *   - User name on file: opens file at that user's scroll location (opens_where)
 *   - Terminal: toggles visibility (brings to front)
 */
export default function SessionTabs({
  workspaceId,
  authFetch,
  collabContext,
  currentState,
  tabs,
  activeTab,
  collabRoster,
  autoRefresh,
  onOpenTab,
  onActivateTerminal,
  onOpenFileWhere,
}: SessionTabsProps) {
  const [states, setStates] = useState<RemoteTabState[]>([])
  const [loading, setLoading] = useState(false)
  const [popupKey, setPopupKey] = useState<string | null>(null) // which row's popup is open
  // Server-authoritative terminal list — all terminals in this workspace.
  // The spec says terminals are shared server state, not per-client state.
  const [serverTerminals, setServerTerminals] = useState<Array<{ id: number; name: string }>>([])

  // Fetch saved/disconnected tab sessions + server terminals from the REST API.
  // Terminals are server-side shared state per the spec — all users see the same list.
  const load = useCallback(async () => {
    if (!workspaceId) { setStates([]); setServerTerminals([]); return }
    setLoading(true)
    try {
      // Fetch tab sessions (disconnected/saved states)
      const params = new URLSearchParams()
      if (collabContext) params.set('context', collabContext)
      const qs = params.toString()
      const res = await authFetch(workspaceUrl(workspaceId, `/tab_sessions${qs ? `?${qs}` : ''}`))
      if (res.ok) {
        const data = await res.json() as { tab_sessions?: RemoteTabState[] }
        setStates(Array.isArray(data.tab_sessions) ? data.tab_sessions : [])
      }
      // Fetch server terminals — the authoritative list for this workspace
      const termRes = await authFetch(workspaceUrl(workspaceId, '/terminal/sessions'))
      if (termRes.ok) {
        const termData = await termRes.json() as { sessions?: string[] }
        const sessions = termData.sessions || []
        const terminals: Array<{ id: number; name: string }> = []
        for (const sess of sessions) {
          const m = sess.match(/^term-(\d+)$/)
          if (m) {
            const id = parseInt(m[1], 10)
            terminals.push({ id, name: `Term ${String(id).padStart(2, '0')}` })
          }
        }
        terminals.sort((a, b) => a.id - b.id)
        setServerTerminals(terminals)
      }
    } catch {
      setStates([])
      setServerTerminals([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, collabContext, authFetch])

  useEffect(() => { void load() }, [load])

  // Build a map: tabPath -> [ { username, session, line? } ] from all sources.
  // The REST-fetched states are the authoritative server state — they include
  // both connected peers (with tabs from the presence roster) and disconnected
  // saved states. collabRoster provides real-time cursor/line info as an overlay.
  const fileTabOwners = useMemo(() => {
    const map = new Map<string, Array<{ username: string; session: string; line?: number }>>()

    // Own tabs — only for the current workspace
    for (const t of tabs) {
      if (!isFileTab(t)) continue
      if (t.workspaceId !== workspaceId) continue
      const path = t.rel || t.path || ''
      if (!path) continue
      const entry = map.get(path) || []
      entry.push({ username: '(me)', session: currentState })
      map.set(path, entry)
    }

    // All other users' tabs from the server (REST) — authoritative source.
    // This includes connected peers (with tabs from presence roster) and
    // disconnected saved states. Works immediately after F5 refresh before
    // WebSocket reconnects.
    for (const st of states) {
      if (st.name === currentState) continue
      if (!st.tabs || st.tabs.length === 0) continue
      for (const rel of st.tabs) {
        if (rel.startsWith('term-')) continue // skip terminals
        const entry = map.get(rel) || []
        entry.push({ username: st.username || stripUser(st.name), session: st.name })
        map.set(rel, entry)
      }
    }

    // Overlay: enhance with real-time cursor/line info from collabRoster.
    // Only adds line numbers — the tab ownership is already covered by REST data.
    if (collabRoster) {
      for (const m of collabRoster) {
        if (m.tabViewState === currentState) continue
        if (!m.tabs || m.tabs.length === 0) continue
        for (const rel of m.tabs) {
          if (rel.startsWith('term-')) continue
          const entry = map.get(rel)
          if (entry) {
            // Update line number for the matching session
            for (const e of entry) {
              if (e.session === m.tabViewState && m.file === rel) {
                e.line = m.line
              }
            }
          }
        }
      }
    }

    return map
  }, [tabs, currentState, states, collabRoster])

  // Build terminal owners from the server's terminal list + collabRoster for attribution.
  // The server is the source of truth for which terminals exist.
  // collabRoster tells us which user has which terminal open.
  const terminalOwners = useMemo(() => {
    const map = new Map<number, { name: string; owners: Array<{ username: string }> }>()

    // Start with the server's terminal list — these are all terminals in this workspace.
    for (const t of serverTerminals) {
      map.set(t.id, { name: t.name, owners: [] })
    }

    // Attribute terminals to users via collabRoster.
    // Each member's tabs list includes "term-N" entries for terminals they have open.
    if (collabRoster) {
      for (const m of collabRoster) {
        const username = m.username || stripUser(m.tabViewState || m.id)
        const isMe = m.tabViewState === currentState
        for (const rel of m.tabs || []) {
          const m2 = rel.match(/^term-(\d+)$/)
          if (m2) {
            const id = parseInt(m2[1], 10)
            const existing = map.get(id)
            if (existing) {
              existing.owners.push({ username: isMe ? '(me)' : username })
            } else {
              // Terminal not in server list yet (shouldn't happen, but handle gracefully)
              map.set(id, { name: `Term ${String(id).padStart(2, '0')}`, owners: [{ username: isMe ? '(me)' : username }] })
            }
          }
        }
      }
    }

    // Remove terminals with no owners (not open by anyone) — only show open terminals.
    for (const [id, data] of map.entries()) {
      if (data.owners.length === 0) {
        map.delete(id)
      }
    }

    return map
  }, [serverTerminals, currentState, collabRoster])

  // Sort file tabs alphabetically
  const sortedFileTabs = useMemo(() => Array.from(fileTabOwners.keys()).sort(), [fileTabOwners])
  // Sort terminals by id
  const sortedTerminals = useMemo(() => Array.from(terminalOwners.keys()).sort((a, b) => a - b), [terminalOwners])

  // Toggle popup for a row
  const togglePopup = (key: string) => {
    setPopupKey(prev => prev === key ? null : key)
  }

  // Render user list: ≤3 users show names, >3 show count with popup
  const renderUserList = (owners: Array<{ username: string; line?: number }>, rowKey: string) => {
    const unique = [...new Map(owners.map(o => [o.username, o])).entries()]
    const isPopupOpen = popupKey === rowKey

    if (unique.length <= 3) {
      return (
        <span className="shrink-0 flex items-center gap-1">
          {unique.map(([name, info]) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                // If this is a file row, open at user's location
                const line = info.line
                if (line) {
                  onOpenFileWhere(rowKey, line)
                } else {
                  onOpenTab(rowKey)
                }
              }}
              className="text-[10px] text-text-muted hover:text-accent underline decoration-text-muted/30 hover:decoration-accent"
              title={name === '(me)' ? 'Your view' : `Open where ${name} has it`}
            >
              {name}
            </button>
          ))}
        </span>
      )
    }

    // >3 users: show count with popup
    return (
      <span className="shrink-0 relative inline-block">
        <button
          type="button"
          onClick={() => togglePopup(rowKey)}
          className="text-[10px] text-text-muted hover:text-accent flex items-center gap-0.5"
          title={`${unique.length} users have this open`}
        >
          {unique.length}
          {isPopupOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {isPopupOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-primary rounded-md shadow-lg p-2 min-w-[120px]">
            {unique.map(([name, info]) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  const line = info.line
                  if (line) {
                    onOpenFileWhere(rowKey, line)
                  } else {
                    onOpenTab(rowKey)
                  }
                  setPopupKey(null)
                }}
                className="block w-full text-left px-2 py-1 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded"
              >
                {name} {info.line ? `(line ${info.line})` : ''}
              </button>
            ))}
          </div>
        )}
      </span>
    )
  }

  // Render terminal user list (simpler, no line info)
  const renderTerminalUserList = (owners: Array<{ username: string }>, rowKey: string) => {
    const unique = [...new Set(owners.map(o => o.username))]
    const isPopupOpen = popupKey === rowKey

    if (unique.length <= 3) {
      return (
        <span className="shrink-0 flex items-center gap-1">
          {unique.map(name => (
            <span key={name} className="text-[10px] text-text-muted">
              {name}
            </span>
          ))}
        </span>
      )
    }

    return (
      <span className="shrink-0 relative inline-block">
        <button
          type="button"
          onClick={() => togglePopup(rowKey)}
          className="text-[10px] text-text-muted hover:text-accent flex items-center gap-0.5"
        >
          {unique.length}
          {isPopupOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {isPopupOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-secondary border border-border-primary rounded-md shadow-lg p-2 min-w-[120px]">
            {unique.map(name => (
              <div key={name} className="block w-full text-left px-2 py-1 text-[11px] text-text-secondary">
                {name}
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {/* Refresh button — only shown when auto-update is off */}
        {!autoRefresh && (
          <div className="flex items-center justify-end mb-2">
            <button
              type="button"
              onClick={() => { void load() }}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              title="Refresh session tabs"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {sortedFileTabs.length === 0 && sortedTerminals.length === 0 ? (
          <div className="text-[11px] text-text-muted">No tabs open yet.</div>
        ) : (
          <div className="space-y-0.5">
            {/* File tabs */}
            {sortedFileTabs.map((path) => {
              const owners = fileTabOwners.get(path) || []
              const count = [...new Set(owners.map(o => o.username))].length
              const isActive = path === activeTab
              return (
                <div
                  key={path}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-hover group"
                >
                  {/* File name — click to activate */}
                  <button
                    type="button"
                    onClick={() => onOpenTab(path)}
                    className={`flex-1 min-w-0 truncate text-[12px] text-left ${
                      isActive ? 'text-text-primary font-medium' : 'text-text-secondary group-hover:text-text-primary'
                    }`}
                    title={path}
                  >
                    {path}
                  </button>
                  {/* Open count (N) */}
                  <span className="shrink-0 text-[10px] text-text-muted font-mono">
                    ({count})
                  </span>
                  {/* User list */}
                  {renderUserList(owners, `file:${path}`)}
                </div>
              )
            })}

            {/* Terminal tabs */}
            {sortedTerminals.map((termId) => {
              const termData = terminalOwners.get(termId)
              const owners = termData?.owners || []
              const count = [...new Set(owners.map(o => o.username))].length
              const termName = termData?.name || `Term ${termId}`
              return (
                <div
                  key={`term:${termId}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-bg-hover group cursor-pointer"
                  onClick={() => onActivateTerminal(termId)}
                  title={`Activate ${termName}`}
                >
                  <TerminalSquare className="w-3 h-3 text-text-muted shrink-0" />
                  {/* Terminal name — click to activate */}
                  <span className="flex-1 min-w-0 truncate text-[12px] text-text-secondary group-hover:text-text-primary">
                    {termName}
                  </span>
                  {/* Open count (N) */}
                  <span className="shrink-0 text-[10px] text-text-muted font-mono">
                    ({count})
                  </span>
                  {/* User list */}
                  {renderTerminalUserList(owners, `term:${termId}`)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
