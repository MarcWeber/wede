import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Boxes, ChevronDown, Check, X, LogOut } from 'lucide-react'
import type { WorkspaceSummary, WorkspaceTemplate } from '../types'
import type { useWorkspaces } from '../hooks/useWorkspaces'

export interface WorkspaceSwitcherProps {
  workspacesApi: ReturnType<typeof useWorkspaces>
  onLogout: () => void
  label?: string
}

function ageLabel(secs: number | undefined): string {
  const s = Math.max(0, Math.floor(secs || 0))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function sessionLabel(s: WorkspaceSummary): string {
  const users = s.users ?? 0
  const bits = [`${users} user${users === 1 ? '' : 's'}`, ageLabel(s.age_secs)]
  const prefix = s.template && s.template !== s.name ? `${s.template}:` : ''
  return `${prefix}${s.name} (${bits.join(' | ')})`
}

// WorkspaceSwitcher — button that shows the workspace name.
// Clicking it opens the selector only when no workspace is active.
export default function WorkspaceSwitcher({ workspacesApi, onLogout, label }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const portalRef = useRef<HTMLDivElement>(null)
  const autoOpened = useRef(false)

  const sessions = workspacesApi?.sessions || []
  const templates = workspacesApi?.templates || []
  const activeId = workspacesApi?.activeWorkspaceId
  const ready = workspacesApi?.ready === true
  const active = sessions.find((r) => r.id === activeId)

  // Auto-open the dropdown once when sessions are ready but none is active
  useEffect(() => {
    if (!ready) return
    if (!activeId && !autoOpened.current) {
      autoOpened.current = true
      setOpen(true)
    }
    if (activeId) {
      autoOpened.current = false
    }
  }, [ready, activeId])

  const handleClick = () => {
    // Always open the selector on click — even when a workspace is active —
    // so the user can switch sessions.
    setOpen(true)
  }

  // Position the portal dropdown near the trigger button.
  useEffect(() => {
    if (!open) return
    const btn = ref.current?.querySelector('div')
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    let top = rect.bottom + 4
    let left = rect.left
    if (left + 256 > window.innerWidth - 8) {
      left = window.innerWidth - 264
    }
    if (left < 8) left = 8
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
  }, [open])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      const insideRef = ref.current && ref.current.contains(target)
      const insidePortal = portalRef.current && portalRef.current.contains(target)
      if (!insideRef && !insidePortal) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <div
        onClick={handleClick}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] text-text-secondary transition-colors ${!activeId ? 'cursor-pointer hover:text-text-primary hover:bg-bg-hover' : ''}`}
        title={activeId ? 'Workspace' : 'Select workspace'}>
        <Boxes className="w-3.5 h-3.5 text-accent" />
        <span className="max-w-48 truncate font-medium">
          {label || active?.name || 'Workspace'}
        </span>
        {!activeId && <ChevronDown className="w-3 h-3 opacity-60" />}
      </div>

      {open && createPortal(
        <div
          ref={portalRef}
          className="fixed z-[60] w-64 bg-bg-elevated border border-border rounded-lg shadow-xl shadow-shadow p-1 animate-fade-in">
          {sessions.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">Active sessions</div>
              <div className="max-h-32 overflow-auto">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { workspacesApi.setActiveWorkspaceId(s.id); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left">
                    <span className="w-3.5 shrink-0">
                      {s.id === activeId && <Check className="w-3.5 h-3.5 text-accent" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block truncate text-[10px] text-text-muted">{sessionLabel(s)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {templates.length > 0 && (
            <>
              {sessions.length > 0 && <div className="my-1 border-t border-border" />}
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">New session</div>
              <div className="max-h-32 overflow-auto">
                {templates.map((t) => (
                  <button
                    key={t.name}
                    onClick={async () => {
                      try {
                        await workspacesApi.createSession(t.name, t.name)
                        setOpen(false)
                      } catch { /* ignore */ }
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-left">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{t.name}</span>
                      <span className="block truncate text-[10px] text-text-muted">New session</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="my-1 border-t border-border" />
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:text-red hover:bg-bg-hover transition-colors">
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Logout</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
