// useTerminals — owns the list of terminal sessions (id + name) and the active
// one, shared between the docked TerminalPanel and the floating window manager so
// both show the *same* server-side PTY sessions (keyed by sessionId `term-<id>`).

import { useState, useCallback, useEffect, useRef } from 'react'
import { workspaceUrl } from '../api'
import { applyAutoName } from '../lib/terminalName'
import type { AuthFetch, TerminalSession, TerminalHandle } from '../types'

type TerminalsList = Pick<TerminalSession, 'id' | 'name'>[]

export interface UseTerminalsSync {
  sendTerminals?: (list: TerminalsList) => void
  onTerminals?: (cb: (list: TerminalsList) => void) => () => void
}

function loadTerminals(): TerminalSession[] | null {
  try {
    const saved = localStorage.getItem('wede_terminals')
    if (saved) {
      // JSON.parse returns `any` by design; keep it at `unknown` until the
      // Array.isArray check, then assert — this function's own return type is
      // the declared boundary for the (trusted, our-own-write) localStorage blob.
      const parsed = JSON.parse(saved) as unknown
      // An empty array is meaningful: "Reset view" persists zero terminals so a
      // later swipe-right adds exactly one instead of resurrecting old tabs.
      if (Array.isArray(parsed)) {
        return (parsed as TerminalSession[]).map((t) => ({
          ...t,
          name: t.manual ? t.name : (t.name || '').replace(/^Terminal (\d+)$/, 'Term $1'),
        }))
      }
    }
  } catch { /* ignore */ }
  return null
}

let nextId = (() => {
  const saved = loadTerminals()
  return saved && saved.length > 0 ? Math.max(...saved.map((t) => t.id)) + 1 : 1
})()

export function useTerminals(authFetch: AuthFetch | null | undefined, workspaceId: string | null | undefined, sync: UseTerminalsSync = {}) {
  const { sendTerminals, onTerminals } = sync
  const [terminals, setTerminals] = useState<TerminalSession[]>(() => loadTerminals() || [{ id: nextId++, name: 'Term 1' }])
  const [activeId, setActiveId] = useState<number>(() => {
    const saved = localStorage.getItem('wede_terminal_active')
    return saved ? Number(saved) : (loadTerminals()?.[0]?.id || 1)
  })
  const reconciledRef = useRef(false)
  const applyingRemoteRef = useRef(false)
  const termRefs = useRef<Record<number, TerminalHandle>>({})

  // Sync the terminal list across collaborators: broadcast on local change, and
  // union in peers' terminals (additive merge → converges; same ids map to the
  // same shared PTY). Applying a peer update doesn't re-broadcast (no echo).
  useEffect(() => {
    if (!onTerminals) return undefined
    return onTerminals((list) => {
      setTerminals((prev) => {
        const ids = new Set(prev.map((t) => t.id))
        const additions = (list || [])
          .filter((t) => t && typeof t.id === 'number' && !ids.has(t.id))
          .map((t) => ({ id: t.id, name: t.name || `Term ${t.id}` }))
        if (additions.length === 0) return prev
        for (const t of additions) if (t.id >= nextId) nextId = t.id + 1
        applyingRemoteRef.current = true
        return [...prev, ...additions].sort((a, b) => a.id - b.id)
      })
    })
  }, [onTerminals])

  useEffect(() => {
    if (applyingRemoteRef.current) { applyingRemoteRef.current = false; return }
    sendTerminals?.(terminals.map((t) => ({ id: t.id, name: t.name })))
  }, [terminals, sendTerminals])

  // Reconcile with live server sessions on mount (so refresh keeps PTYs).
  useEffect(() => {
    if (reconciledRef.current || !authFetch) return
    reconciledRef.current = true
    authFetch(workspaceId ? workspaceUrl(workspaceId, '/terminal/sessions') : '/api/terminal/sessions')
      .then((res) => res.json())
      .then((data: { sessions?: string[] }) => {
        const serverSessions = new Set(data.sessions || [])
        if (serverSessions.size === 0) return
        setTerminals((prev) => {
          // Only keep tabs whose PTY is still alive. Server sessions that are
          // not in the persisted list are leftovers from closed tabs; importing
          // them resurrected every old PTY as a phantom tab on each reload.
          const alive = prev.filter((t) => serverSessions.has(`term-${t.id}`))
          return alive.length ? alive : prev
        })
      })
      .catch(() => {})
  }, [authFetch, workspaceId])

  useEffect(() => {
    try {
      // Never persist `initial` (a one-shot task command) — it must not re-run on reload.
      // `manual` is kept so a user-chosen name survives reload and still wins over OSC titles.
      localStorage.setItem('wede_terminals', JSON.stringify(terminals.map((t) => ({ id: t.id, name: t.name, manual: t.manual || undefined, locked: t.locked || undefined }))))
      localStorage.setItem('wede_terminal_active', String(activeId))
    } catch { /* ignore */ }
  }, [terminals, activeId])

  // addTerminal(name?, initial?) — `initial` is a command run once when the new
  // terminal's PTY connects (used by the task runner).
  const addTerminal = useCallback((name?: string, initial?: string) => {
    const id = nextId++
    setTerminals((prev) => [...prev, { id, name: name || `Term ${id}`, initial: initial || undefined }])
    setActiveId(id)
    return id
  }, [])

  // clearInitial drops a terminal's one-shot command so it can't re-run on a
  // tab-switch remount within the session.
  const clearInitial = useCallback((id: number) => {
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, initial: undefined } : t)))
  }, [])

  // renameTerminal sets a user-chosen name. `manual` pins it so PTY title
  // escapes (autoNameTerminal) no longer override it — the explicit name wins.
  const renameTerminal = useCallback((id: number, name: string | null | undefined) => {
    const v = (name || '').trim()
    if (!v) return
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, name: v, manual: true } : t)))
  }, [])

  // autoNameTerminal applies a title emitted by the PTY via an OSC 0/1/2 escape
  // (what macOS/Linux terminals use to self-name from the running program/shell).
  // It only takes effect when the user hasn't manually renamed the terminal.
  const autoNameTerminal = useCallback((id: number, title: string | null | undefined) => {
    setTerminals((prev) => applyAutoName(prev, id, title))
  }, [])

  const closeTerminal = useCallback((id: number) => {
    setTerminals((prev) => {
      // Locked terminals refuse to close until unlocked.
      if (prev.find((t) => t.id === id)?.locked) return prev
      const next = prev.filter((t) => t.id !== id)
      // Closing the last terminal is allowed: leave the list empty instead of
      // resurrecting a fresh PTY (the menu can add one again on demand).
      if (next.length === 0) setActiveId(0)
      else if (activeId === id) setActiveId(next[next.length - 1].id)
      return next
    })
  }, [activeId])

  // closeSelected closes the given terminals, skipping locked ones unless
  // includeLocked is set.
  const closeSelected = useCallback((ids: number[], includeLocked: boolean) => {
    const set = new Set(ids)
    setTerminals((prev) => {
      const next = prev.filter((t) => !set.has(t.id) || (!includeLocked && t.locked))
      if (next.length === prev.length) return prev
      if (next.length === 0) setActiveId(0)
      else if (!next.some((t) => t.id === activeId)) {
        setActiveId(next[next.length - 1].id)
      }
      return next
    })
  }, [activeId])

  // resetTerminals clears the tab list (used by "Reset view"). The next
  // swipe-right / toggle then adds exactly one fresh terminal instead of
  // reviving every old PTY.
  const resetTerminals = useCallback(() => {
    setTerminals([])
    setActiveId(0)
  }, [])

  // setLocked locks/unlocks the given terminal ids.
  const setLocked = useCallback((ids: number[], locked: boolean) => {
    const set = new Set(ids)
    setTerminals((prev) => prev.map((t) => (set.has(t.id) ? { ...t, locked } : t)))
  }, [])

  // reorderTerminals moves terminal `fromId` to `toId`'s position (drag & drop).
  const reorderTerminals = useCallback((fromId: number, toId: number) => {
    setTerminals((prev) => {
      const fromIdx = prev.findIndex((t) => t.id === fromId)
      const toIdx = prev.findIndex((t) => t.id === toId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  return { terminals, activeId, setActiveId, addTerminal, closeTerminal, closeSelected, resetTerminals, setLocked, reorderTerminals, clearInitial, renameTerminal, autoNameTerminal, termRefs }
}
