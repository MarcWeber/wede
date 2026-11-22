import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Boxes, ChevronDown, Plus, Check, X } from 'lucide-react'
import type { WorkspaceSummary } from '../types'
import type { useWorkspaces } from '../hooks/useWorkspaces'

export interface WorkspaceSwitcherProps {
  workspacesApi: ReturnType<typeof useWorkspaces>
  // Open the list upward (the switcher lives in the menu footer, above Logout).
  menuUp?: boolean
  // Render the list inline instead of as an absolute popover (Settings).
  inline?: boolean
  // Override the trigger text (e.g. "Open Workspace").
  label?: string
  // Controlled open state, used by Settings to keep the selector visible.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Show the manual path entry. Gated by workspace_allow_custom_directory.
  allowCustomDirectory?: boolean
}

// WorkspaceDropdownContent — shared dropdown body used by both inline and portal
// rendering paths so the markup is not duplicated.
function WorkspaceDropdownContent({
  workspaces, activeId, workspacesApi, setOpen,
  allowCustomDirectory, adding, setAdding,
  path, setPath, name, setName,
  error, create, busy, setError,
}: {
  workspaces: WorkspaceSummary[]
  activeId: string | null
  workspacesApi: ReturnType<typeof useWorkspaces>
  setOpen: (v: boolean) => void
  allowCustomDirectory: boolean
  adding: boolean
  setAdding: (v: boolean) => void
  path: string
  setPath: (v: string) => void
  name: string
  setName: (v: string) => void
  error: string | null
  create: () => void
  busy: boolean
  setError: (v: string | null) => void
}) {
  return (
    <>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">Workspaces</div>
      <div className="max-h-56 overflow-auto">
        {workspaces.map((r) => (
          <button
            key={r.id}
            onClick={() => { workspacesApi.setActiveWorkspaceId(r.id); setOpen(false) }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left">
            <span className="w-3.5 shrink-0">
              {r.id === activeId && <Check className="w-3.5 h-3.5 text-accent" />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium">{r.name}</span>
              <span className="block truncate text-[10px] text-text-muted">{r.root}</span>
            </span>
          </button>
        ))}
        {workspaces.length === 0 && (
          <div className="px-2 py-2 text-[11px] text-text-muted">No workspaces yet</div>
        )}
      </div>

      {allowCustomDirectory && (
      <div className="border-t border-border mt-1 pt-1">
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
            <Plus className="w-3.5 h-3.5" /> Custom directory…
          </button>
        ) : (
          <div className="p-1.5 space-y-1.5">
            <input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="/path/to/workspace"
              className="w-full px-2 py-1 rounded-md bg-bg-secondary border border-border text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setAdding(false) }}
              placeholder="Name (optional)"
              className="w-full px-2 py-1 rounded-md bg-bg-secondary border border-border text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40" />
            {error && <div className="text-[11px] text-red px-0.5">{error}</div>}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => { void create() }}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[12px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50">
                {busy ? 'Opening…' : 'Open'}
              </button>
              <button
                onClick={() => { setAdding(false); setError(null) }}
                className="flex items-center justify-center px-2 py-1 rounded-md text-[12px] text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
      )}
    </>
  )
}

// WorkspaceSwitcher shows the active workspace ("workspace") and lets you switch between
// open workspaces or open a new one. Workspaces are the multi-workspace backbone: each is an
// isolated workspace served by the same wede instance.
export default function WorkspaceSwitcher({ workspacesApi, menuUp = false, inline = false, label, open: controlledOpen, onOpenChange, allowCustomDirectory = false }: WorkspaceSwitcherProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback((next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInternalOpen(next)
  }, [onOpenChange])
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  const workspaces = workspacesApi?.workspaces || []
  const activeId = workspacesApi?.activeWorkspaceId
  const active = workspaces.find((r) => r.id === activeId)
  const isLoading = workspacesApi?.loading === true && workspaces.length === 0

  // Position the portal dropdown near the trigger button.
  useEffect(() => {
    if (!open || inline) return
    const btn = ref.current?.querySelector('button')
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    // Position below button; if it would overflow the viewport, position above
    let top = rect.bottom + 4
    let left = rect.left
    if (left + 256 > window.innerWidth - 8) {
      left = window.innerWidth - 264
    }
    if (left < 8) left = 8
    // Apply position directly on the portal element; visibility is toggled
    // via the CSS class so we can measure the height first.
    const el = portalRef.current
    if (!el) return
    el.style.top = '0px'
    el.style.left = `${left}px`
    el.style.visibility = 'hidden'
    el.style.display = 'block'
    const dh = el.offsetHeight
    el.style.visibility = ''
    el.style.display = ''
    if (top + dh > window.innerHeight - 8) {
      top = rect.top - dh - 4
    }
    el.style.top = `${top}px`
  }, [open, inline])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      const insideRef = ref.current && ref.current.contains(target)
      const insidePortal = portalRef.current && portalRef.current.contains(target)
      if (!insideRef && !insidePortal) { setOpen(false); setAdding(false) }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, setOpen])

  const create = async () => {
    if (!path.trim()) { setError('Enter a folder path'); return }
    setBusy(true); setError(null)
    try {
      const workspace = await workspacesApi.createWorkspace(name.trim(), path.trim())
      workspacesApi.setActiveWorkspaceId(workspace.id)
      setAdding(false); setOpen(false); setPath(''); setName('')
    } catch (e) {
      setError((e as Error).message || 'Could not open workspace')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors ${inline ? 'w-full justify-center border border-border' : ''}`}
        title="Switch workspace">
        <Boxes className="w-3.5 h-3.5 text-accent" />
        <span className="max-w-32 truncate font-medium">
          {label || (isLoading ? 'Loading…' : active ? active.name : workspaces.length > 0 ? 'Select workspace' : 'No workspaces')}
        </span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {open && (inline ? (
        <div className="mt-2 w-full bg-bg-elevated border border-border rounded-lg shadow-xl shadow-shadow z-50 p-1 animate-fade-in">
          <WorkspaceDropdownContent
            workspaces={workspaces} activeId={activeId} workspacesApi={workspacesApi} setOpen={setOpen}
            allowCustomDirectory={allowCustomDirectory} adding={adding} setAdding={setAdding}
            path={path} setPath={setPath} name={name} setName={setName}
            error={error} create={create} busy={busy} setError={setError}
          />
        </div>
      ) : createPortal(
        <div
          ref={portalRef}
          className="fixed z-[60] w-64 bg-bg-elevated border border-border rounded-lg shadow-xl shadow-shadow p-1 animate-fade-in">
          <WorkspaceDropdownContent
            workspaces={workspaces} activeId={activeId} workspacesApi={workspacesApi} setOpen={setOpen}
            allowCustomDirectory={allowCustomDirectory} adding={adding} setAdding={setAdding}
            path={path} setPath={setPath} name={name} setName={setName}
            error={error} create={create} busy={busy} setError={setError}
          />
        </div>,
        document.body
      ))}
    </div>
  )
}
