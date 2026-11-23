// useCollab — connects to a workspace's collaboration WebSocket for presence
// plus ephemeral peer signals (semantic cursor locations + shared window geometry).
//
// Opens /api/workspaces/{id}/collab (auth via ?token=, matching useLSP and the auth
// middleware which reads ?token= on WS upgrades), parses {type:'presence',
// members:[...]} roster broadcasts, and exposes:
//   setViewing(file, line)      publish the local text cursor    (throttled)
//   sendPointer(target)         publish a semantic cursor location (throttled)
//   sendWindow(win, geo)        publish a shared window's geometry
//   pointers                    { id: CollabPointer }  other members' locations
//   onWindow(cb)                subscribe to peer window-geometry updates
//
// Defensive by design: any failure leaves collab simply inactive (empty roster),
// never throwing into the IDE.

import { useEffect, useRef, useState, useCallback } from 'react'
import { basePath } from '../api'
import type { PresenceMember, CollabPointer, TerminalSession, CollabPresenter } from '../types'
import { isCollabPointer } from '../lib/collabPointer'

function buildWsUrl(workspaceId: string, token: string, username: string | null | undefined, tabViewState?: string | null, collabContext?: string | null): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // In dev (Vite on 5173/5174) the WS must hit the backend on :9090 directly.
  const port = window.location.port
  const host = (port === '5173' || port === '5174')
    ? window.location.hostname + ':9090'
    : window.location.host
  const base = basePath()
  return `${proto}//${host}${base}/api/workspaces/${encodeURIComponent(workspaceId)}/collab`
    + `?token=${encodeURIComponent(token)}`
    + `&username=${encodeURIComponent(username || '')}`
    + (tabViewState ? `&tab_view_state=${encodeURIComponent(tabViewState)}` : '')
    + (collabContext ? `&collab_context=${encodeURIComponent(collabContext)}` : '')
}

const THROTTLE_MS = 150
const POINTER_THROTTLE_MS = 45

// WindowGeo is a shared window's geometry, published/received piecemeal (a
// move sends {x,y}, a resize sends {w,h}; consumers merge onto prior state).
export interface WindowGeo {
  x?: number
  y?: number
  w?: number
  h?: number
  [key: string]: unknown
}

type WindowSub = (win: string, geo: WindowGeo, id: string) => void
type TerminalsSub = (list: Pick<TerminalSession, 'id' | 'name'>[]) => void

interface CollabMessage {
  type?: string
  members?: PresenceMember[]
  presenter?: CollabPresenter | null
  id?: string
  target?: CollabPointer | null
  win?: string
  geo?: WindowGeo
  list?: Pick<TerminalSession, 'id' | 'name'>[]
  visibleTabTypes?: Record<string, boolean>
  reason?: string
}

export interface UseCollabResult {
  selfId: string | null
  roster: PresenceMember[]
  presenter: CollabPresenter | null
  visibleTabTypes: Record<string, boolean> | null
  startLead: () => void
  stopLead: () => void
  setViewing: (file: string | null | undefined, line?: number, anchorLine?: number, anchorCol?: number, headLine?: number, headCol?: number) => void
  setTabs: (tabs: string[]) => void
  pointers: Record<string, CollabPointer>
  sendPointer: (target: CollabPointer | null) => void
  sendWindow: (win: string, geo: WindowGeo) => void
  onWindow: (cb: WindowSub) => () => void
  sendTerminals: (list: Pick<TerminalSession, 'id' | 'name'>[]) => void
  onTerminals: (cb: TerminalsSub) => () => void
}

export function useCollab(
  workspaceId: string | null | undefined,
  token: string | null | undefined,
  username: string | null | undefined,
  tabViewState?: string | null,
  collabContext?: string | null,
  onKicked?: () => void,
): UseCollabResult {
  const [roster, setRoster] = useState<PresenceMember[]>([])
  const [presenter, setPresenter] = useState<CollabPresenter | null>(null)
  const [selfId, setSelfId] = useState<string | null>(null)
  const [visibleTabTypes, setVisibleTabTypes] = useState<Record<string, boolean> | null>(null)
  const [pointers, setPointers] = useState<Record<string, CollabPointer>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const kickedRef = useRef(onKicked)
  useEffect(() => { kickedRef.current = onKicked }, [onKicked])
  const lastSentRef = useRef<{ file: string | null; line: number; anchorLine: number; anchorCol: number; headLine: number; headCol: number }>({ file: null, line: -1, anchorLine: 0, anchorCol: 0, headLine: 0, headCol: 0 })
  const pendingRef = useRef<{ file: string; line: number; anchorLine: number; anchorCol: number; headLine: number; headCol: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPointerRef = useRef<CollabPointer | null | undefined>(undefined)
  const windowSubsRef = useRef<Set<WindowSub>>(new Set())
  const terminalsSubsRef = useRef<Set<TerminalsSub>>(new Set())

  useEffect(() => {
    if (!workspaceId || !token) return undefined
    let disposed = false
    let ws: WebSocket | undefined
    try {
      ws = new WebSocket(buildWsUrl(workspaceId, token, username, tabViewState, collabContext))
      wsRef.current = ws
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg: CollabMessage = JSON.parse(ev.data)
          if (!msg) return
          if (msg.type === 'kicked') {
            kickedRef.current?.()
            return
          }
          if (msg.type === 'self' && msg.id) {
            setSelfId(msg.id)
            if (msg.visibleTabTypes) {
              setVisibleTabTypes(msg.visibleTabTypes)
            }
          } else if (msg.type === 'presence' && Array.isArray(msg.members)) {
            setRoster(msg.members)
            setPresenter(msg.presenter ?? null)
            // Drop cursors for members who have left.
            const ids = new Set(msg.members.map((m) => m.id))
            setPointers((prev) => {
              const next: Record<string, CollabPointer> = {}
              for (const k of Object.keys(prev)) if (ids.has(k)) next[k] = prev[k]
              return next
            })
          } else if (msg.type === 'pointer' && msg.id) {
            const id = msg.id
            const target = msg.target
            setPointers((prev) => {
              if (target == null) {
                if (!(id in prev)) return prev
                const next = { ...prev }
                delete next[id]
                return next
              }
              if (!isCollabPointer(target)) return prev
              return { ...prev, [id]: target }
            })
          } else if (msg.type === 'window' && msg.id) {
            const { win, geo, id } = msg
            windowSubsRef.current.forEach((cb) => { try { cb(win ?? '', geo ?? {}, id ?? '') } catch { /* ignore */ } })
          } else if (msg.type === 'terminals' && Array.isArray(msg.list)) {
            terminalsSubsRef.current.forEach((cb) => { try { cb(msg.list ?? []) } catch { /* ignore */ } })
          }
        } catch { /* ignore malformed frames */ }
      }
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null
        if (!disposed) { setRoster([]); setPresenter(null); setPointers({}) }
      }
      ws.onerror = () => { /* non-fatal; onclose handles cleanup */ }
    } catch { /* construction failed → collab inactive */ }

    return () => {
      disposed = true
      setRoster([]); setPresenter(null); setPointers({}); setSelfId(null); setVisibleTabTypes(null)
      lastSentRef.current = { file: null, line: -1, anchorLine: 0, anchorCol: 0, headLine: 0, headCol: 0 }
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      if (pointerTimerRef.current) { clearTimeout(pointerTimerRef.current); pointerTimerRef.current = null }
      try { if (ws) ws.close() } catch { /* ignore */ }
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [workspaceId, token, username, tabViewState, collabContext])

  const send = useCallback((obj: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)) } catch { /* ignore */ }
    }
  }, [])

  // setViewing publishes the local cursor + selection range, throttled (leading + trailing) so
  // rapid tab/cursor changes don't flood the socket.
  const setViewing = useCallback((file: string | null | undefined, line = 0, anchorLine = 0, anchorCol = 0, headLine = 0, headCol = 0) => {
    pendingRef.current = { file: file || '', line: line || 0, anchorLine: anchorLine || 0, anchorCol: anchorCol || 0, headLine: headLine || 0, headCol: headCol || 0 }
    const flush = () => {
      timerRef.current = null
      const p = pendingRef.current
      const ws = wsRef.current
      if (!p || !ws || ws.readyState !== WebSocket.OPEN) return
      if (p.file === lastSentRef.current.file && p.line === lastSentRef.current.line &&
          p.anchorLine === lastSentRef.current.anchorLine && p.anchorCol === lastSentRef.current.anchorCol &&
          p.headLine === lastSentRef.current.headLine && p.headCol === lastSentRef.current.headCol) return
      lastSentRef.current = p
      try { ws.send(JSON.stringify({ type: 'cursor', file: p.file, line: p.line, anchorLine: p.anchorLine, anchorCol: p.anchorCol, headLine: p.headLine, headCol: p.headCol })) } catch { /* ignore */ }
    }
    if (timerRef.current) return
    flush()
    timerRef.current = setTimeout(flush, THROTTLE_MS)
  }, [])

  const setTabs = useCallback((list: string[]) => send({ type: 'tabs', list }), [send])

  // sendPointer publishes a semantic cursor location (line/col, page+point,
  // etc.) so peers can place it correctly at any viewport size. `null` clears it.
  const sendPointer = useCallback((target: CollabPointer | null) => {
    pendingPointerRef.current = target
    if (pointerTimerRef.current) return
    const flush = () => {
      pointerTimerRef.current = null
      const p = pendingPointerRef.current
      if (p === undefined) return
      pendingPointerRef.current = undefined
      send({ type: 'pointer', target: p })
    }
    flush()
    pointerTimerRef.current = setTimeout(flush, POINTER_THROTTLE_MS)
  }, [send])

  const sendWindow = useCallback((win: string, geo: WindowGeo) => send({ type: 'window', win, geo }), [send])

  const startLead = useCallback(() => send({ type: 'lead', on: true }), [send])
  const stopLead = useCallback(() => send({ type: 'lead', on: false }), [send])

  const onWindow = useCallback((cb: WindowSub) => {
    windowSubsRef.current.add(cb)
    return () => windowSubsRef.current.delete(cb)
  }, [])

  const sendTerminals = useCallback((list: Pick<TerminalSession, 'id' | 'name'>[]) => send({ type: 'terminals', list }), [send])
  const onTerminals = useCallback((cb: TerminalsSub) => {
    terminalsSubsRef.current.add(cb)
    return () => terminalsSubsRef.current.delete(cb)
  }, [])

  return { selfId, roster, presenter, visibleTabTypes, startLead, stopLead, setViewing, setTabs, pointers, sendPointer, sendWindow, onWindow, sendTerminals, onTerminals }
}
