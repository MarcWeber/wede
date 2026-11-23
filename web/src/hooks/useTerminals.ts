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
    // Prefer sessionStorage (per-tab) so different users in different tabs
    // don't share terminal state. Fall back to localStorage for migration.
    const saved = sessionStorage.getItem('wede_terminals') ?? localStorage.getItem('wede_terminals')
    if (saved) {
      const parsed = JSON.parse(saved) as unknown
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

// The server is the single source of truth for terminal IDs.
// genId is a fallback only when the server is unreachable.
let fallbackId = 10000
function genId(): number {
  return fallbackId++
}

// Format a terminal ID as a zero-padded 2-digit name: 1 → "Term 01", 10 → "Term 10".
function termName(id: number): string {
  return `Term ${String(id).padStart(2, '0')}`
}

export function useTerminals(authFetch: AuthFetch | null | undefined, workspaceId: string | null | undefined, sync: UseTerminalsSync = {}) {
  const { sendTerminals, onTerminals } = sync
  const [terminals, setTerminals] = useState<TerminalSession[]>(() => {
    const saved = loadTerminals()
    if (saved) return saved
    // Start with an empty list — the server reconciliation will import the
    // real terminal sessions. A placeholder is added only if the server
    // is unreachable after reconciliation.
    return []
  })
  const [activeId, setActiveId] = useState<number>(() => {
    const saved = sessionStorage.getItem('wede_terminal_active')
    if (saved) return Number(saved)
    const loaded = loadTerminals()
    // Only default to first loaded terminal's ID if we actually have terminals.
    // Don't default to 1 — that creates a phantom "Term 01" expectation.
    return loaded?.[0]?.id ?? 0
  })
  const reconciledRef = useRef(false)
  const applyingRemoteRef = useRef(false)
  const termRefs = useRef<Record<number, TerminalHandle>>({})
  // Track the most recently added terminal ID to avoid a race where the
  // WebSocket echo arrives before React has flushed the local setTerminals.
  const lastAddedIdRef = useRef<number | null>(null)
  // Prevent concurrent addTerminal calls (e.g. double-swipe) from creating
  // duplicate terminals with the same server-assigned ID.
  const addingRef = useRef(false)

  // Sync the terminal list across collaborators: broadcast on local change, and
  // union in peers' terminals (additive merge → converges; same ids map to the
  // same shared PTY). Applying a peer update doesn't re-broadcast (no echo).
  useEffect(() => {
    if (!onTerminals) return undefined
    return onTerminals((list) => {
      setTerminals((prev) => {
        const ids = new Set(prev.map((t) => t.id))
        // Also exclude the most recently added terminal ID to avoid a race
        // where the WebSocket echo arrives before React has flushed the local
        // setTerminals from addTerminal.
        if (lastAddedIdRef.current != null) ids.add(lastAddedIdRef.current)
        const filtered = (list || []).filter((t) => t && typeof t.id === 'number' && !ids.has(t.id))
        if (filtered.length === 0) return prev
        // Deduplicate peer list — multiple peers may report the same terminal ID
        const seen = new Set<number>()
        const additions: TerminalSession[] = []
        for (const t of filtered) {
          if (!seen.has(t.id)) {
            seen.add(t.id)
            additions.push({ id: t.id, name: t.name || termName(t.id) })
          }
        }
        if (additions.length === 0) return prev
        applyingRemoteRef.current = true
        // Merge and deduplicate final result
        const merged = [...prev, ...additions]
        const finalSeen = new Set<number>()
        const result: TerminalSession[] = []
        for (const t of merged.sort((a, b) => a.id - b.id)) {
          if (!finalSeen.has(t.id)) {
            finalSeen.add(t.id)
            result.push(t)
          }
        }
        return result
      })
    })
  }, [onTerminals])

  useEffect(() => {
    if (applyingRemoteRef.current) { applyingRemoteRef.current = false; return }
    sendTerminals?.(terminals.map((t) => ({ id: t.id, name: t.name })))
  }, [terminals, sendTerminals])

  // Reconcile with live server sessions on mount (so refresh keeps PTYs).
  // The server is the source of truth: import any server session not already
  // in the local list, and remove local tabs whose PTY no longer exists.
  useEffect(() => {
    if (reconciledRef.current || !authFetch || !workspaceId) return
    reconciledRef.current = true
    authFetch(workspaceUrl(workspaceId, '/terminal/sessions'))
      .then((res) => res.json())
      .then((data: { sessions?: string[] }) => {
        const serverSessions = data.sessions || []
        const serverIds = new Set(serverSessions)
        setTerminals((prev) => {
          // Keep local tabs whose PTY is still alive on the server.
          const alive = prev.filter((t) => serverIds.has(`term-${t.id}`))
          // Import server sessions not already in the local list.
          const localIds = new Set(prev.map((t) => `term-${t.id}`))
          // Also exclude the most recently added terminal to avoid importing
          // a terminal that was just created by addTerminal.
          if (lastAddedIdRef.current != null) {
            localIds.add(`term-${lastAddedIdRef.current}`)
          }
          const additions: TerminalSession[] = []
          let maxServerId = 0
          for (const sess of serverSessions) {
            const m = sess.match(/^term-(\d+)$/)
            if (m) {
              const id = parseInt(m[1], 10)
              if (id > maxServerId) maxServerId = id
              if (!localIds.has(sess)) {
                additions.push({ id, name: termName(id) })
              }
            }
          }
          // Update fallback to be above the highest server ID so we never collide.
          if (maxServerId >= fallbackId) {
            fallbackId = maxServerId + 1
          }
          // If nothing was loaded from storage and the server has sessions,
          // use the server list as the source of truth.
          if (prev.length === 0 && additions.length > 0) {
            // Deduplicate: server may return the same ID multiple times if
            // multiple users created terminals with the same ID.
            const seen = new Set<number>()
            const deduped: TerminalSession[] = []
            for (const t of additions) {
              if (!seen.has(t.id)) { seen.add(t.id); deduped.push(t) }
            }
            return deduped.sort((a, b) => a.id - b.id)
          }
          // Deduplicate merged result — alive and additions may overlap
          const seen = new Set<number>()
          const merged: TerminalSession[] = []
          for (const t of [...alive, ...additions].sort((a, b) => a.id - b.id)) {
            if (!seen.has(t.id)) {
              seen.add(t.id)
              merged.push(t)
            }
          }
          // If reconciliation results in no terminals and the user just created
          // one (prev.length > 0), keep the local list — the server may not have
          // registered the PTY yet. Otherwise return the empty merged list.
          if (merged.length === 0 && prev.length > 0) {
            return prev
          }
          return merged
        })
      })
      .catch(() => {
        // Server unreachable — keep whatever is in the local list.
      })
  }, [authFetch, workspaceId])

  useEffect(() => {
    try {
      // Never persist `initial` (a one-shot task command) — it must not re-run on reload.
      // `manual` is kept so a user-chosen name survives reload and still wins over OSC titles.
      // Use sessionStorage (per-tab) so different users in different tabs don't share state.
      sessionStorage.setItem('wede_terminals', JSON.stringify(terminals.map((t) => ({ id: t.id, name: t.name, manual: t.manual || undefined, locked: t.locked || undefined }))))
      sessionStorage.setItem('wede_terminal_active', String(activeId))
    } catch { /* ignore */ }
  }, [terminals, activeId])

  // addTerminal(name?, initial?) — `initial` is a command run once when the new
  // terminal's PTY connects (used by the task runner). Fetches the next ID from
  // the server so two users in different tabs never get the same ID.
  const addTerminal = useCallback(async (name?: string, initial?: string) => {
    // Guard against concurrent calls (e.g. double-swipe) creating duplicates.
    if (addingRef.current) return lastAddedIdRef.current ?? 0
    addingRef.current = true

    // Ask the server for the next sequential ID.
    let id: number
    if (authFetch && workspaceId) {
      try {
        const res = await authFetch(workspaceUrl(workspaceId, '/terminal/next-id'))
        const data = await res.json()
        id = data.id
      } catch {
        // Fallback to local generation if server is unreachable.
        id = genId()
      }
    } else {
      id = genId()
    }
    // Mark this ID so the WebSocket echo callback skips it (avoids race).
    lastAddedIdRef.current = id
    setTerminals((prev) => [...prev, { id, name: name || termName(id), initial: initial || undefined }])
    setActiveId(id)
    addingRef.current = false
    return id
  }, [authFetch, workspaceId])

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

  // killPty asks the server to kill a terminal's PTY. A "close" is demoted to a
  // plain detach server-side when another viewer is still attached, so one user
  // closing the tab doesn't kill the shared shell out from under them.
  const killPty = useCallback((id: number) => {
    if (!authFetch || !workspaceId) return
    authFetch(workspaceUrl(workspaceId, `/terminal/close?id=${id}`), { method: 'POST' })
      .catch(() => { /* server already gone, or last-viewer demotion */ })
  }, [authFetch, workspaceId])

  // closeTerminal hides the tab locally and asks the server to kill the PTY.
  // preventHide is a per-user lock (part of the tab_view_state dump);
  // preventClose is shared state — the server demotes a close to a detach when
  // another viewer is still attached.
  const closeTerminal = useCallback((id: number, onEmpty?: () => void) => {
    setTerminals((prev) => {
      const t = prev.find((x) => x.id === id)
      // Locked terminals refuse to close until unlocked.
      if (t?.preventHide || t?.locked) return prev
      const next = prev.filter((x) => x.id !== id)
      // Closing the last terminal is allowed: leave the list empty instead of
      // resurrecting a fresh PTY (the menu can add one again on demand).
      if (next.length === 0) {
        setActiveId(0)
        onEmpty?.()
      } else if (activeId === id) {
        setActiveId(next[next.length - 1].id)
      }
      return next
    })
    killPty(id)
  }, [activeId, killPty])

  // closeSelected closes the given terminals, skipping locked ones unless
  // includeLocked is set.
  const closeSelected = useCallback((ids: number[], includeLocked: boolean) => {
    const set = new Set(ids)
    const killed: number[] = []
    setTerminals((prev) => {
      const next = prev.filter((t) => {
        if (!set.has(t.id)) return true
        if (!includeLocked && (t.preventHide || t.locked)) return true
        killed.push(t.id)
        return false
      })
      if (next.length === prev.length) return prev
      if (next.length === 0) setActiveId(0)
      else if (!next.some((t) => t.id === activeId)) {
        setActiveId(next[next.length - 1].id)
      }
      return next
    })
    for (const id of killed) killPty(id)
  }, [activeId, killPty])

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
