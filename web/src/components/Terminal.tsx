import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import { Terminal as XTerminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TerminalHandle, TerminalSettings } from '../types'

interface TerminalProps {
  token: string | null | undefined
  workspaceId: string | null | undefined
  sessionId?: string
  visible: boolean
  terminalTheme?: ITheme
  initialCommand?: string
  onInitialRun?: () => void
  onTitle?: (title: string) => void
}

const TERM_SETTINGS_KEY = 'wede_terminal_settings'
const DEFAULT_TERM_SETTINGS: TerminalSettings = { fontSize: 12, minCols: 0, minRows: 0, scrollback: 5000, followMode: 'off', swipeMode: 'wheel', swipeModeDouble: 'cursor', swipeStep: 10, writeDelayMs: 250 }

function readTermSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(TERM_SETTINGS_KEY)
    if (raw) return { ...DEFAULT_TERM_SETTINGS, ...(JSON.parse(raw) as Partial<TerminalSettings>) }
  } catch { /* ignore */ }
  return DEFAULT_TERM_SETTINGS
}

// xterm exposes cell dimensions only on its internal render service. FitAddon
// reads exactly this field, so mirroring it keeps our min-size math consistent
// with the addon instead of guessing from font metrics.
interface XtermInternals {
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number; height?: number } } } } }
}

// VirtualKeyboard API (Chrome 94+, Android) is not in the default DOM lib.
interface VirtualKeyboardLike extends EventTarget {
  overlaysContent: boolean
  boundingRect: DOMRect
}

export default forwardRef<TerminalHandle, TerminalProps>(function Terminal({ token, workspaceId, sessionId, visible, terminalTheme, initialCommand, onInitialRun, onTitle }, ref) {
  // Settings come from localStorage, written by the toolbar's = menu. The
  // toolbar also fires a same-tab custom event (the `storage` event only fires
  // in other tabs), so no polling is needed.
  const [termSettings, setTermSettings] = useState<TerminalSettings>(readTermSettings)
  const settingsRef = useRef(termSettings)
  useEffect(() => { settingsRef.current = termSettings }, [termSettings])
  useEffect(() => {
    const handler = () => setTermSettings(readTermSettings())
    window.addEventListener('storage', handler)
    window.addEventListener('wede:term-settings', handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener('wede:term-settings', handler)
    }
  }, [])
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const ranInitialRef = useRef(false)
  // Keep the latest onTitle callback in a ref so the PTY title handler (wired once
  // in the setup effect below) always calls the current one without re-running setup.
  const onTitleRef = useRef(onTitle)
  useEffect(() => { onTitleRef.current = onTitle }, [onTitle])

  // Expose send function for external toolbar
  useImperativeHandle(ref, () => ({
    send: (data: string) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
      termRef.current?.focus()
    }
  }), [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Fit the terminal to the container, then enforce minCols/minRows as a FLOOR
  // (not an exact size): minCols=80 means "never fewer than 80 columns", so a
  // narrow phone keeps 80 columns and scrolls horizontally instead of wrapping.
  // When the grid is larger than the container we size `.xterm` itself to the
  // grid in pixels and let the container scroll; otherwise xterm fills it.
  const applySizing = useCallback(() => {
    const term = termRef.current
    const fit = fitRef.current
    const container = containerRef.current
    if (!term || !fit || !container) return
    // Hidden or not laid out yet: getComputedStyle().width is "auto"/0, which
    // makes FitAddon propose NaN. Resizing to NaN corrupts xterm and sends a
    // 0x0 resize to the PTY, so vim/top render only a cursor at the top-left.
    // (The old fitAddon.fit() had exactly this isNaN guard; applySizing must too.)
    if (container.clientWidth === 0 || container.clientHeight === 0) return
    const proposed = fit.proposeDimensions()
    if (!proposed) return
    if (!Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return
    const minCols = Math.max(0, Math.floor(settingsRef.current.minCols || 0))
    const minRows = Math.max(0, Math.floor(settingsRef.current.minRows || 0))
    const cols = Math.max(proposed.cols, minCols)
    const rows = Math.max(proposed.rows, minRows)
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
    const cell = (term as unknown as XtermInternals)._core?._renderService?.dimensions?.css?.cell
    const xtermEl = term.element
    if (xtermEl && cell?.width && cell?.height) {
      if (cols > proposed.cols || rows > proposed.rows) {
        xtermEl.style.width = `${Math.round(cols * cell.width)}px`
        xtermEl.style.height = `${Math.round(rows * cell.height)}px`
      } else {
        xtermEl.style.width = ''
        xtermEl.style.height = ''
      }
    }
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows)
  }, [])

  useEffect(() => {
    if (!containerRef.current || !token || termRef.current) return

    const term = new XTerminal({
      cursorBlink: true,
      fontSize: termSettings.fontSize ?? 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace",
      theme: terminalTheme,
      allowTransparency: true,
      scrollback: termSettings.scrollback ?? 5000,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    // Disable mobile keyboard autocomplete/autocorrect on xterm's hidden textarea
    const textarea = containerRef.current.querySelector('textarea')
    if (textarea) {
      textarea.setAttribute('autocomplete', 'off')
      textarea.setAttribute('autocorrect', 'off')
      textarea.setAttribute('autocapitalize', 'off')
      textarea.setAttribute('spellcheck', 'false')
      textarea.setAttribute('data-gramm', 'false')
    }

    fitRef.current = fitAddon
    termRef.current = term

    // The PTY can self-name via an OSC 0/1/2 title escape (as macOS/Linux shells
    // do); surface it so the tab can auto-name itself.
    term.onTitleChange((title) => { if (mountedRef.current) onTitleRef.current?.(title) })

    const sid = sessionId || token

    // Send the current size to the server. Called on every (re)connect so a
    // PTY that was left at a stale/broken size is corrected, and never with a
    // degenerate/NaN size (JSON.stringify(NaN) becomes null → server applies 0x0).
    function sendCurrentResize() {
      if (!Number.isFinite(term.cols) || !Number.isFinite(term.rows) || term.cols < 1 || term.rows < 1) return
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    // Apply the initial size after xterm has laid out its first frame, when
    // cell metrics are available. The onResize handler sends it once the WS is
    // open; onopen also re-sends so reconnects correct the PTY size.
    const initialFrame = requestAnimationFrame(() => { applySizing() })

    function connect(isReconnect: boolean) {
      if (!mountedRef.current) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      // In dev mode (Vite on 5173), connect directly to backend on 9090
      const port = window.location.port
      const host = (port === '5173' || port === '5174') ? window.location.hostname + ':9090' : window.location.host
      // Pass auth token as a WebSocket subprotocol ("auth.<token>") so it never
      // appears in server access logs or browser history. The session ID is a
      // non-secret resumption handle passed as a query param.
      //
      // Workspace-scoped path so everyone in a workspace shares one PTY per session id;
      // falls back to the legacy default-workspace route until the workspace id resolves.
      const path = workspaceId
        ? `/api/workspaces/${encodeURIComponent(workspaceId)}/terminal`
        : '/api/terminal'
      const ws = new WebSocket(
        `${protocol}//${host}${path}?session=${encodeURIComponent(sid)}`,
        [`auth.${token}`]
      )
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        if (isReconnect) {
          // Clear screen before replay — the server sends scrollback
          term.clear()
        }
        // (Re)send the current size now that the socket is open.
        sendCurrentResize()
        // Run a one-shot task command once the PTY is connected (fresh sessions
        // only; a small delay lets the shell print its prompt first).
        if (!isReconnect && !ranInitialRef.current && initialCommand) {
          ranInitialRef.current = true
          const cmd = initialCommand
          setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(cmd + '\r')
            }
            onInitialRun?.()
          }, settingsRef.current.writeDelayMs)
        }
      }

      ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data))
        } else {
          term.write(event.data)
        }
      }

      ws.onerror = () => {}

      ws.onclose = () => {
        if (!mountedRef.current) return
        // Only reconnect if this is still the active WebSocket
        if (wsRef.current !== ws) return
        wsRef.current = null
        scheduleReconnect()
      }
    }

    let reconnectDelay = 1000
    function scheduleReconnect() {
      if (!mountedRef.current) return
      reconnectRef.current = setTimeout(() => {
        if (!mountedRef.current) return
        connect(true)
        reconnectDelay = Math.min(reconnectDelay * 1.5, 10000)
      }, reconnectDelay)
    }

    connect(false)

    term.onData((data) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data)
    })

    term.onResize(({ cols, rows }) => {
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    const ro = new ResizeObserver(() => { applySizing() })
    ro.observe(containerRef.current)

    return () => {
      mountedRef.current = false
      cancelAnimationFrame(initialFrame)
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      ro.disconnect()
      if (wsRef.current) wsRef.current.close()
      term.dispose()
      termRef.current = null
      wsRef.current = null
      fitRef.current = null
    }
  }, [token, sessionId, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme dynamically
  useEffect(() => {
    if (termRef.current && terminalTheme) {
      termRef.current.options.theme = terminalTheme
    }
  }, [terminalTheme])

  // React to terminal settings changes (font size, scrollback, min dimensions).
  // Cell metrics only update after xterm re-renders, so re-fit on the next frame.
  useEffect(() => {
    const term = termRef.current
    if (!term) return undefined
    term.options.fontSize = termSettings.fontSize ?? 12
    term.options.scrollback = termSettings.scrollback ?? 5000
    const frame = requestAnimationFrame(() => applySizing())
    return () => cancelAnimationFrame(frame)
  }, [termSettings.fontSize, termSettings.scrollback, termSettings.minCols, termSettings.minRows, applySizing])

  // Do NOT auto-focus the terminal when it becomes visible — on mobile this
  // triggers the virtual keyboard and blocks the bottom of the screen.
  // The terminal only focuses when the user taps it (xterm handles that natively)
  // or when send() is called from the toolbar. Still re-fit on visibility change
  // so the size is correct when the tab is shown.
  useEffect(() => {
    if (!visible) return undefined
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        applySizing()
      })
    })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [visible, termSettings.minCols, termSettings.minRows, applySizing])

  // Virtual Keyboard API (Chrome 94+, Android) — when the keyboard appears,
  // adjust the container's padding-bottom so the terminal content scrolls up
  // and isn't hidden behind the keyboard. With overlaysContent=true the browser
  // won't resize the viewport, so we handle layout ourselves.
  const keyboardPaddingRef = useRef(0)

  // Scroll the terminal so the cursor stays within a safe margin from all edges.
  // xterm.js cursorY is the absolute line in the buffer (not relative to viewport).
  // viewportY is the first visible line. We ensure the cursor stays at least
  // MARGIN fraction away from the top and bottom of the visible area.
  const scrollCursorIntoView = (term: XTerminal) => {
    const buf = term.buffer.active
    const cell = (term as unknown as XtermInternals)._core?._renderService?.dimensions?.css?.cell
    const container = containerRef.current

    // Min-size mode (minCols/minRows): `.xterm` is taller than the container
    // and the container is the scroller. `term.scrollToLine` only moves xterm's
    // internal viewport (already at the bottom), so the cursor can sit outside
    // the container's visible area. Scroll the container to the cursor's row.
    if (container && term.element && cell?.height && container.scrollHeight > container.clientHeight + 1) {
      term.scrollToBottom()
      const cursorPx = buf.cursorY * cell.height
      const margin = Math.max(cell.height, Math.round(container.clientHeight * 0.1))
      const top = container.scrollTop
      if (cursorPx < top + margin) {
        container.scrollTop = Math.max(0, cursorPx - margin)
      } else if (cursorPx > top + container.clientHeight - margin) {
        container.scrollTop = cursorPx - container.clientHeight + margin
      }
      return
    }

    // Fit mode: xterm's own viewport scrolls the scrollback.
    // xterm.js cursorY is the absolute line in the buffer (not relative to viewport).
    // viewportY is the first visible line. We ensure the cursor stays at least
    // MARGIN fraction away from the top and bottom of the visible area.
    const MARGIN = 0.1
    const absCursorLine = buf.baseY + buf.cursorY  // absolute line in buffer
    const totalRows = term.rows
    const viewportY = buf.viewportY               // first visible line (absolute)
    const paddingRows = Math.max(1, Math.floor(totalRows * MARGIN))
    const topVisible = viewportY + paddingRows
    const bottomVisible = viewportY + totalRows - paddingRows
    const maxScroll = Math.max(0, buf.length - totalRows)

    if (absCursorLine < topVisible) {
      // Cursor too close to top — scroll up so it's at the safe margin
      const target = Math.max(0, absCursorLine - paddingRows)
      term.scrollToLine(target)
    } else if (absCursorLine >= bottomVisible) {
      // Cursor too close to bottom — scroll down so it's at the safe margin
      const target = Math.min(absCursorLine + paddingRows - totalRows + 1, maxScroll)
      term.scrollToLine(target)
    }
  }

  // Scroll cursor above the keyboard when it appears. Works regardless of
  // followCursor setting — always keeps the cursor visible.
  const scrollAboveKeyboard = (term: XTerminal, keyboardHeight: number) => {
    if (!term || keyboardHeight <= 0) return
    const buf = term.buffer.active
    const absCursorLine = buf.baseY + buf.cursorY  // absolute line in buffer
    const totalRows = term.rows
    const viewportY = buf.viewportY               // first visible line (absolute)
    const cell = (term as unknown as XtermInternals)._core?._renderService?.dimensions?.css?.cell
    const charHeight = cell?.height || 15
    const keyboardRows = Math.floor(keyboardHeight / charHeight)
    if (keyboardRows <= 0) return
    // The bottom of the visible area, accounting for the keyboard hiding rows
    const bottomVisibleLine = viewportY + totalRows - keyboardRows
    if (absCursorLine > bottomVisibleLine) {
      // Cursor is hidden behind keyboard — scroll up
      const newScroll = Math.max(0, viewportY + keyboardRows)
      const maxScroll = Math.max(0, buf.length - totalRows)
      term.scrollToLine(Math.min(newScroll, maxScroll))
    }
  }

  useEffect(() => {
    const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
    if (!vk || !containerRef.current) return undefined
    vk.overlaysContent = true

    const onGeometryChange = () => {
      const rect = vk.boundingRect
      const newPadding = rect && rect.height > 0 ? Math.round(rect.height) : 0
      keyboardPaddingRef.current = newPadding
      const el = containerRef.current
      if (el) {
        el.style.paddingBottom = `${newPadding}px`
        setTimeout(() => {
          applySizing()
          requestAnimationFrame(() => {
            const term = termRef.current
            if (!term) return
            // Always scroll cursor above keyboard, regardless of followCursor
            if (rect && rect.height > 0) {
              scrollAboveKeyboard(term, rect.height)
            }
            // If follow mode is 'follow', also run the margin check
            if (settingsRef.current.followMode === 'follow') {
              scrollCursorIntoView(term)
            }
          })
        }, 100)
      }
    }
    vk.addEventListener('geometrychange', onGeometryChange)
    return () => vk.removeEventListener('geometrychange', onGeometryChange)
  }, [applySizing])

  // Follow cursor — when followMode is 'follow', continuously watch the cursor
  // position and scroll so it stays within a safe margin from all edges.
  // Uses settingsRef to always read the latest followMode value.
  useEffect(() => {
    const interval = setInterval(() => {
      if (settingsRef.current.followMode !== 'follow') return
      const term = termRef.current
      if (term) scrollCursorIntoView(term)
    }, 200)
    return () => clearInterval(interval)
  }, [])

  // Vertical swipe → keys (mobile). In 'scroll' mode the gesture is left to the
  // browser/xterm; the other modes send keys so TUIs (vim/less/emacs) can be
  // paged when the soft keyboard has no PageUp/PageDown.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    // A "step" is this many CSS px of finger movement per emitted action.
    // Read from settings (configurable via "select-arrow-speeds").
    const getStep = () => settingsRef.current.swipeStep ?? 10
    let startX = 0
    let startY = 0
    let lastY = 0
    let tracking = false
    const send = (seq: string) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(seq)
    }
    const seqFor = (mode: TerminalSettings['swipeMode'], down: boolean): string => {
      if (mode === 'cursor') return down ? '\x1b[B' : '\x1b[A'
      if (mode === 'page') return down ? '\x1b[6~' : '\x1b[5~'
      if (mode === 'half') return down ? '\x04' : '\x15'
      if (mode === 'emacs') return down ? '\x16' : '\x1bv'
      return ''
    }
    // Horizontal cursor movement (left/right arrows) for cursor mode.
    const seqForH = (right: boolean): string => {
      return right ? '\x1b[C' : '\x1b[D'
    }
    // SGR mouse wheel events (button 64 = up, 65 = down) at the touch cell.
    // For apps that only scroll on wheel input (e.g. junie/lazygit). Requires
    // the app to have enabled mouse reporting; otherwise native scroll is used.
    const mouseWheelSeq = (term: XTerminal, down: boolean, clientX: number, clientY: number): string => {
      const el = term.element
      const cell = (term as unknown as XtermInternals)._core?._renderService?.dimensions?.css?.cell
      let col = Math.floor(term.cols / 2) + 1
      let row = Math.floor(term.rows / 2) + 1
      if (el && cell?.width && cell?.height) {
        const r = el.getBoundingClientRect()
        col = Math.max(1, Math.min(term.cols, Math.floor((clientX - r.left) / cell.width) + 1))
        row = Math.max(1, Math.min(term.rows, Math.floor((clientY - r.top) / cell.height) + 1))
      }
      return `\x1b[<${down ? 65 : 64};${col};${row}M`
    }
    // Native scrolling applies when the terminal actually has scrollback: xterm's
    // own scrollbar in fit mode, or the container's scrollbar in min-size mode.
    // With no scrollback (alt-screen apps: vim/less/emacs/opencode) the swipe
    // sends the configured key mode instead.
    const hasScrollback = () => {
      const term = termRef.current
      const container = containerRef.current
      if (term && term.buffer.active.type === 'normal' && term.buffer.active.length > term.rows) return true
      return !!container && container.scrollHeight > container.clientHeight + 1
    }
    // Two-finger swipe uses swipeModeDouble (default: cursor movement).
    let twoFingerTracking = false
    let twoFingerLastY = 0
    let twoFingerLastX = 0
    const getTwoFingerStep = () => settingsRef.current.swipeStep ?? 10
    const onTwoFingerStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      twoFingerTracking = true
      twoFingerLastY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      twoFingerLastX = (e.touches[0].clientX + e.touches[1].clientX) / 2
    }
    const onTwoFingerMove = (e: TouchEvent) => {
      if (!twoFingerTracking || e.touches.length !== 2) return
      const mode = settingsRef.current.swipeModeDouble
      if (mode === 'scroll') return
      const step = getTwoFingerStep()
      const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const avgX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const dy = avgY - twoFingerLastY
      const dx = avgX - twoFingerLastX
      const absDy = Math.abs(dy)
      const absDx = Math.abs(dx)
      if (absDy + absDx < step) return
      if (mode === 'wheel') {
        const term = termRef.current
        if (!term || term.modes.mouseTrackingMode === 'none') return
        e.preventDefault()
        const t = e.touches[0]
        const steps = Math.floor(absDy / step)
        if (steps > 0) send(mouseWheelSeq(term, dy < 0, t.clientX, t.clientY).repeat(steps))
        twoFingerLastY += dy < 0 ? -steps * step : steps * step
      } else if (mode === 'cursor') {
        e.preventDefault()
        if (absDy > absDx * 1.15) {
          const steps = Math.floor(absDy / step)
          if (steps > 0) send(seqFor(mode, dy > 0).repeat(steps))
          twoFingerLastY += dy < 0 ? -steps * step : steps * step
        } else if (absDx > absDy * 1.15) {
          const steps = Math.floor(absDx / step)
          if (steps > 0) send(seqForH(dx > 0).repeat(steps))
          twoFingerLastX += dx < 0 ? -steps * step : steps * step
        }
      } else {
        if (hasScrollback()) return
        e.preventDefault()
        const steps = Math.floor(absDy / step)
        if (steps > 0) send(seqFor(mode, dy > 0).repeat(steps))
        twoFingerLastY += dy < 0 ? -steps * step : steps * step
      }
    }
    const onTwoFingerEnd = () => { twoFingerTracking = false }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) { tracking = false; onTwoFingerStart(e); return }
      if (e.touches.length !== 1) { tracking = false; return }
      tracking = true
      startX = e.touches[0].clientX
      startY = lastY = e.touches[0].clientY
    }
    let lastX = 0
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const mode = settingsRef.current.swipeMode
      if (mode === 'scroll') return
      const step = getStep()
      const t = e.touches[0]
      const dy = t.clientY - lastY
      const dx = t.clientX - (lastX || startX)
      const absDy = Math.abs(dy)
      const absDx = Math.abs(dx)
      if (absDy + absDx < step) return
      const isVertical = absDy > absDx * 1.15
      const isHorizontal = absDx > absDy * 1.15
      if (!isVertical && !isHorizontal) return
      if (mode === 'wheel') {
        const term = termRef.current
        if (!term || term.modes.mouseTrackingMode === 'none') return
        e.preventDefault()
        if (isVertical) {
          const steps = Math.floor(absDy / step)
          if (steps > 0) {
            send(mouseWheelSeq(term, dy < 0, t.clientX, t.clientY).repeat(steps))
            lastY += dy < 0 ? -steps * step : steps * step
          }
        }
        return
      }
      if (mode !== 'cursor' && hasScrollback()) return
      e.preventDefault()
      if (isVertical) {
        const steps = Math.floor(absDy / step)
        if (steps > 0) {
          send(seqFor(mode, dy > 0).repeat(steps))
          lastY += dy < 0 ? -steps * step : steps * step
        }
      } else if (isHorizontal && mode === 'cursor') {
        const steps = Math.floor(absDx / step)
        if (steps > 0) {
          send(seqForH(dx > 0).repeat(steps))
          lastX = lastX || startX
          lastX += dx < 0 ? -steps * step : steps * step
        }
      }
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        tracking = false
        twoFingerTracking = false
      }
    }
    const onMoveWrapper = (e: TouchEvent) => {
      if (e.touches.length === 2) onTwoFingerMove(e)
      else onMove(e)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMoveWrapper, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMoveWrapper)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  // A single stable DOM node keeps xterm's painted DOM where its ref is. The
  // scroll wrapper is the same element either way; only the overflow class and
  // the width/height set by applySizing change.
  const scrolls = termSettings.minCols > 0 || termSettings.minRows > 0
  const isShrink = termSettings.followMode === 'shrink'
  return (
    <div
      ref={containerRef}
      data-testid="terminal-scroll"
      className={`w-full ${scrolls ? 'overflow-auto' : ''}`}
      style={{
        display: visible ? 'block' : 'none',
        touchAction: 'pan-x pan-y',
        overscrollBehavior: 'contain',
        height: isShrink ? '300px' : '100%',
        flexShrink: isShrink ? 0 : undefined,
      }}
    />
  )
})
