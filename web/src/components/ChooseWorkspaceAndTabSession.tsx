import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Boxes, Users, Check, Plus, LogOut, ChevronDown, ChevronRight } from 'lucide-react'
import { sessionsUrl, workspaceUrl } from '../api'
import type { AuthFetch, WorkspaceSummary } from '../types'
import type { useWorkspaces } from '../hooks/useWorkspaces'
import type { SessionChoice } from '../lib/sessionNav'

interface RemoteTabState {
  name: string
  updated_at: number
  data?: unknown
  connected?: boolean
}

interface TabSummary {
  path?: string
  name?: string
  type?: string
  url?: string
}

interface LayoutSummary {
  tabs?: TabSummary[]
  activeTab?: string | null
  containers?: unknown[]
  viewModes?: Record<string, string>
  floatGeom?: Record<string, unknown>
}

function layoutOf(st: RemoteTabState): LayoutSummary | null {
  if (!st.data || typeof st.data !== 'object') return null
  const outer = st.data as Record<string, unknown>
  const inner = outer.data && typeof outer.data === 'object' ? outer.data : outer
  return inner
}

interface WorkspaceOption {
  value: string
  name: string
  kind: 'session' | 'template'
  id: string | null
  template?: string
}

export interface ChooseWorkspaceAndTabSessionProps {
  workspacesApi: ReturnType<typeof useWorkspaces>
  authFetch: AuthFetch
  currentWorkspaceId: string | null
  currentCollabContext: string | null
  // Full state name ("user:<name>") currently in use, or null for the default.
  currentTabViewState: string | null
  // Authenticated username — used to filter tab sessions to the current user only.
  username: string
  showCancel?: boolean
  // Embedded renders just the card (used as the whole screen when no workspace
  // is active). The default fixed overlay is used when switching from the IDE.
  embedded?: boolean
  onCancel: () => void
  onApply: (choice: SessionChoice) => void
  onLogout: () => void
  onCloseAllAndLogout: () => void
}

function stripUser(name: string): string {
  return name.startsWith('user:') ? name.slice('user:'.length) : name
}

function ageLabel(secs: number | undefined): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - (secs || 0)))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Suggest the lowest free positive integer, not max+1: deleted middle states
// leave reusable numbers. New states are named sess1, sess2, ... so they are
// easy to distinguish from the legacy numeric user:<n> states.
function nextName(existing: RemoteTabState[]): string {
  const used = new Set<number>()
  for (const st of existing) {
    const raw = stripUser(st.name)
    const match = /^sess(\d+)$/.exec(raw) || /^(\d+)$/.exec(raw)
    if (match) used.add(Number(match[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `user:sess${n}`
}

// ChooseWorkspaceAndTabSession — the single modal that picks the workspace, the
// collaboration context and the tab view state. Cancel is only shown while
// switching (there is always a previous selection to return to).
export default function ChooseWorkspaceAndTabSession({
  workspacesApi,
  authFetch,
  currentWorkspaceId,
  currentCollabContext,
  currentTabViewState,
  username,
  showCancel = true,
  embedded = false,
  onCancel,
  onApply,
  onLogout,
  onCloseAllAndLogout,
}: ChooseWorkspaceAndTabSessionProps) {
  // Active sessions first; templates that are not running yet are offered as
  // "new session" so a fresh deployment (config lists only templates) still has
  // a choice. Config `workspaces` entries are templates, not live sessions.
  const options = useMemo<WorkspaceOption[]>(() => {
    const sessionList = workspacesApi?.sessions || []
    const templateList = workspacesApi?.templates || []
    const list: WorkspaceOption[] = sessionList.map((s: WorkspaceSummary) => ({
      value: `session:${s.id}`, name: s.name, kind: 'session', id: s.id,
    }))
    const running = new Set(sessionList.map((s) => s.template).filter(Boolean))
    for (const t of templateList) {
      if (running.has(t.name)) continue
      list.push({ value: `template:${t.name}`, name: t.name, kind: 'template', id: null, template: t.name })
    }
    return list
  }, [workspacesApi?.sessions, workspacesApi?.templates])

  const initialValue = useMemo(() => {
    return options.find((o) => o.id === currentWorkspaceId)?.value || options[0]?.value || ''
  }, [options, currentWorkspaceId])

  const [choice, setChoice] = useState(initialValue)
  const selectedOption = options.find((o) => o.value === choice) || null
  const workspaceId = selectedOption?.kind === 'session' ? selectedOption.id : null
  const workspaceName = selectedOption?.name || ''

  const [context, setContext] = useState(currentCollabContext || workspaceName)
  const [states, setStates] = useState<RemoteTabState[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState(currentTabViewState || '')
  const [newName, setNewName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [closedCurrent, setClosedCurrent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tabViewStateExpanded, setTabViewStateExpanded] = useState(false)
  const contextTouched = useRef(false)
  const selectionTouched = useRef(false)

  // Keep a valid workspace choice as the session/template list changes.
  useEffect(() => {
    if (choice && options.some((o) => o.value === choice)) return
    setChoice(initialValue)
  }, [choice, options, initialValue])

  // Default the collaboration context to the workspace name until the user
  // types their own context.
  useEffect(() => {
    if (contextTouched.current) return
    setContext(workspaceName)
  }, [workspaceName])

  const loadStates = useCallback(async () => {
    if (!workspaceId) { setStates([]); return }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (context.trim()) params.set('context', context.trim())
      const qs = params.toString()
      const res = await authFetch(workspaceUrl(workspaceId, `/tab_sessions${qs ? `?${qs}` : ''}`))
      if (!res.ok) throw new Error('failed to load tab states')
      const data = await res.json() as { tab_sessions?: RemoteTabState[] }
      setStates(data.tab_sessions || [])
    } catch (e) {
      setStates([])
      setError(e instanceof Error ? e.message : 'failed to load tab states')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, context, authFetch])

  useEffect(() => { void loadStates() }, [loadStates])

  const currentContext = (currentCollabContext || workspaceName).trim()
  const chosenContext = context.trim() || workspaceName
  const currentVisible = !closedCurrent &&
    !!currentTabViewState &&
    !!workspaceId &&
    workspaceId === currentWorkspaceId &&
    chosenContext === currentContext

  // A session belongs to the current user if its name starts with "user:<username>:".
  // This prevents picking another user's session by default (Enter key) and hides
  // other users' sessions from the picker — they are visible via SessionTabs instead.
  const ownsState = (name: string) => name.startsWith(`user:${username}:`)

  const stateOptions = useMemo(() => {
    const list = states.filter((s) => !removed.has(s.name) && ownsState(s.name))
    // Keep the state currently used by this tab visible even before its first
    // save reaches the server. It belongs to the current workspace/context only;
    // after "close current" or a workspace switch it must disappear.
    if (currentVisible && currentTabViewState && !removed.has(currentTabViewState) &&
        !list.some((s) => s.name === currentTabViewState)) {
      list.unshift({ name: currentTabViewState, updated_at: 0 })
    }
    if (selectionTouched.current && selected && !removed.has(selected) &&
        !list.some((s) => s.name === selected)) {
      list.push({ name: selected, updated_at: 0 })
    }
    return list
  }, [states, selected, currentTabViewState, removed, currentVisible])

  // The first available state is the simple default. A state already used by
  // this tab wins, so reopening the chooser highlights the current view. When
  // there is no state (e.g. after closing the current session) the list stays
  // empty and only the new-name input remains.
  useEffect(() => {
    if (loading) return
    const preferred = selectionTouched.current && selected && stateOptions.some((s) => s.name === selected)
      ? selected
      : (currentVisible ? currentTabViewState : null) || stateOptions[0]?.name || ''
    if (preferred !== selected) setSelected(preferred)
  }, [loading, stateOptions, selected, currentTabViewState, currentVisible])

  const chooseWorkspace = (value: string) => {
    setChoice(value)
    selectionTouched.current = false
    setSelected('')
    setRemoved(new Set())
    const opt = options.find((o) => o.value === value)
    if (!contextTouched.current) setContext(opt?.name || '')
  }

  const chooseContext = (value: string) => {
    contextTouched.current = true
    selectionTouched.current = false
    setContext(value)
    setSelected('')
    setRemoved(new Set())
  }

  const closeCurrent = async () => {
    if (!currentWorkspaceId) return
    setError(null)
    try {
      await workspacesApi.closeWorkspace(currentWorkspaceId)
      setClosedCurrent(true)
      selectionTouched.current = false
      setSelected('')
      setRemoved(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to close current session')
    }
  }

  const stateUrl = (name: string) => {
    if (!workspaceId) return ''
    const params = new URLSearchParams()
    if (context.trim()) params.set('context', context.trim())
    const qs = params.toString()
    return workspaceUrl(workspaceId, `/tab_sessions/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`)
  }

  const removeState = async (name: string) => {
    if (!workspaceId) return
    setError(null)
    try {
      const res = await authFetch(stateUrl(name), { method: 'DELETE' })
      if (!res.ok) throw new Error('failed to remove tab state')
      setRemoved((prev) => new Set(prev).add(name))
      await loadStates()
      if (selected === name) {
        selectionTouched.current = false
        setSelected('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to remove tab state')
    }
  }

  const cloneState = async (src: RemoteTabState) => {
    if (!workspaceId) return
    setError(null)
    const target = nextName(stateOptions)
    try {
      const res = await authFetch(stateUrl(target), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(src.data ?? {}),
      })
      if (!res.ok) throw new Error('failed to clone tab state')
      await loadStates()
      selectionTouched.current = true
      setSelected(target)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to clone tab state')
    }
  }

  const addState = () => {
    const typed = newName.trim()
    const name = typed || stripUser(nextName(stateOptions))
    selectionTouched.current = true
    setSelected(name.startsWith('user:') ? name : `user:${name}`)
    setNewName('')
  }

  const closeAllAndLogout = async () => {
    if (workspaceId) {
      setError(null)
      try {
        await Promise.all(states.map((st) => authFetch(stateUrl(st.name), { method: 'DELETE' })))
      } catch { /* logout still proceeds */ }
    }
    onCloseAllAndLogout()
  }

  const submit = async (override?: string) => {
    setError(null)
    setSubmitting(true)
    try {
      let id = workspaceId
      if (!id) {
        const template = selectedOption?.template
        if (!template) { setError('choose a workspace'); return }
        const res = await authFetch(sessionsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template, name: template }),
        })
        const data = await res.json() as WorkspaceSummary & { error?: string }
        if (!res.ok || !data.id) throw new Error(data.error || 'failed to create session')
        id = data.id
      }
      const target = override ?? selected
      const targetConnected = !!stateOptions.find((s) => s.name === target)?.connected ||
        (currentVisible && target === currentTabViewState)
      onApply({
        workspaceId: id,
        collabContext: context.trim() || workspaceName,
        tabViewState: target,
        force: override !== undefined || targetConnected,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to create session')
    } finally {
      setSubmitting(false)
    }
  }

  const card = (
    <div
      className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-bg-elevated border border-border rounded-xl shadow-xl shadow-shadow p-4 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Choose workspace and tab session"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">
            Workspace &amp; session{username ? ` (${username})` : ''}
          </h2>
        </div>
        {showCancel && (
          <button type="button" onClick={onCancel} className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover" title="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {currentWorkspaceId && !closedCurrent && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => void closeCurrent()}
            className="text-[11px] px-2 py-1 rounded-md border border-border text-text-secondary hover:text-red hover:border-red/60"
            title="Close the current session (terminals and shared state are lost)"
          >
            close current
          </button>
        </div>
      )}

      <label className="block mb-3">
        <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">Workspace</span>
        <select
          value={choice}
          onChange={(e) => chooseWorkspace(e.target.value)}
          className="w-full bg-bg-primary border border-border rounded-md px-2 py-1.5 text-[12px] text-text-primary"
        >
          {options.length === 0 && <option value="">No workspaces configured</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.name}{o.kind === 'template' ? ' (new session)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="block mb-3">
        <span className="block text-[11px] uppercase tracking-wider text-text-muted mb-1">
          collab_context <span className="text-text-muted/70 normal-case">(default: workspace name)</span>
        </span>
        <input
          value={context}
          onChange={(e) => chooseContext(e.target.value)}
          placeholder={workspaceName}
          className="w-full bg-bg-primary border border-border rounded-md px-2 py-1.5 text-[12px] text-text-primary"
        />
      </label>

      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => setTabViewStateExpanded((prev) => !prev)}
            className="text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary flex items-center gap-1"
            title="Toggle advanced tab view settings"
          >
            {tabViewStateExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            tab_view_state
          </button>
          {loading && <span className="text-[10px] text-text-muted">loading…</span>}
          {!workspaceId && <span className="text-[10px] text-text-muted">starts with a fresh view</span>}
        </div>
        {tabViewStateExpanded && (
        <>
        <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
          {stateOptions.map((st) => {
            const isCurrent = currentVisible && st.name === currentTabViewState
            const isConnected = isCurrent || st.connected === true
            const layout = layoutOf(st)
            const stateTabs = Array.isArray(layout?.tabs) ? layout.tabs : []
            const isExpanded = expanded.has(st.name)
            const toggleExpanded = () => {
              if (!layout) return
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(st.name)) next.delete(st.name)
                else next.add(st.name)
                return next
              })
            }
            return (
              <div key={st.name} className={`px-2 py-1.5 ${selected === st.name ? 'bg-accent/10' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleExpanded}
                    disabled={!layout}
                    className={`p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover disabled:opacity-20 disabled:hover:bg-transparent ${layout ? '' : 'invisible'}`}
                    title={layout ? (isExpanded ? 'Hide details' : 'Show details') : 'No saved layout'}
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      selectionTouched.current = true
                      setSelected(st.name)
                      if (layout) setExpanded((prev) => new Set(prev).add(st.name))
                    }}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    title="Select this tab view state"
                  >
                    <span className="w-3.5 shrink-0 text-accent">{selected === st.name && <Check className="w-3.5 h-3.5" />}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-[12px] text-text-primary">
                        {stripUser(st.name)}
                        {isConnected && <span className="ml-1 text-[10px] text-accent">(connected)</span>}
                      </span>
                      <span className="block text-[10px] text-text-muted">{st.updated_at ? `saved ${ageLabel(st.updated_at)} ago` : 'current default'}</span>
                    </span>
                  </button>
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void submit(st.name)}
                      disabled={submitting}
                      className="px-1.5 py-0.5 rounded border border-accent/60 text-[10px] text-accent hover:bg-accent/10 disabled:opacity-40"
                      title="Open this tab view state in this browser tab"
                    >
                      use-here
                    </button>
                    {workspaceId && (
                      <>
                        <button
                          type="button"
                          onClick={() => void cloneState(st)}
                          className="px-1.5 py-0.5 rounded border border-border text-[10px] text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                          title="Copy this layout to a new tab view state"
                        >
                          copy
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeState(st.name)}
                          className="px-1.5 py-0.5 rounded border border-border text-[10px] text-text-secondary hover:text-red hover:bg-bg-hover"
                          title="Remove this saved tab view state"
                        >
                          close-remove
                        </button>
                      </>
                    )}
                  </span>
                </div>
                {isExpanded && layout && (
                  <div className="ml-6 mt-1.5 rounded-md border border-border/60 bg-bg-primary/60 p-2 text-[10px] text-text-muted space-y-1">
                    <div className="flex gap-1">
                      <span className="text-text-secondary">active:</span>
                      <span className="truncate">{layout.activeTab || '(none)'}</span>
                    </div>
                    <div className="flex gap-1">
                      <span className="text-text-secondary">tabs:</span>
                      <span>{stateTabs.length}</span>
                    </div>
                    {stateTabs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {stateTabs.slice(0, 12).map((tab, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-bg-secondary border border-border/60 text-text-secondary">
                            {tab.name || tab.path || tab.url || tab.type || '(tab)'}
                          </span>
                        ))}
                        {stateTabs.length > 12 && <span>+{stateTabs.length - 12} more</span>}
                      </div>
                    )}
                    {layout.containers && (
                      <div className="flex gap-1">
                        <span className="text-text-secondary">containers:</span>
                        <span>{layout.containers.length}</span>
                      </div>
                    )}
                    {layout.viewModes && Object.keys(layout.viewModes).length > 0 && (
                      <div className="flex gap-1">
                        <span className="text-text-secondary">view modes:</span>
                        <span>{Object.entries(layout.viewModes).map(([k, v]) => `${k}=${v}`).join(', ')}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Plus className="w-3.5 h-3.5 text-text-muted shrink-0" />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addState() } }}
            placeholder={stripUser(nextName(stateOptions))}
            className="flex-1 bg-bg-primary border border-border rounded-md px-2 py-1.5 text-[12px] text-text-primary"
          />
          <button type="button" onClick={addState} className="px-2 py-1.5 rounded-md border border-border text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover">
            new-with-name
          </button>
        </div>
        </>
        )}
      </div>

      {error && <div className="mb-2 text-[11px] text-red">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md bg-accent text-bg-primary text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'entering…' : 'enter'}
        </button>
        {showCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover">
            cancel
          </button>
        )}
        <button type="button" onClick={onLogout} className="px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:text-red hover:bg-bg-hover flex items-center gap-1.5">
          <LogOut className="w-3.5 h-3.5" /> logout
        </button>
        <button type="button" onClick={() => void closeAllAndLogout()} className="ml-auto px-3 py-1.5 rounded-md border border-border text-[12px] text-text-secondary hover:text-red hover:bg-bg-hover flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> close all tab states and logout
        </button>
      </div>
    </div>
  )

  if (embedded) return card

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={onCancel}>
      {card}
    </div>
  )
}
