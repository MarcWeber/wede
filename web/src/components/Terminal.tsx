import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react'
import { Terminal as XTerminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TerminalHandle, TerminalSettings } from '../types'
import { basePath } from '../api'
import { logUi } from '../lib/uiLog'

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
const DEFAULT_TERM_SETTINGS: TerminalSettings = { fontSize: 12, minCols: 0, minRows: 0, scrollback: 5000, followMode: 'off', followMargin: 0.2, swipeMode: 'wheel', swipeModeDouble: 'cursor', swipeStep: 10, writeDelayMs: 250 }

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

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
}

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof HTMLElement)) return 'none'
  const id = target.id ? `#${target.id}` : ''
  const cls = target.className && typeof target.className === 'string'
    ? `.${target.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}`
    : ''
  return `${target.tagName.toLowerCase()}${id}${cls}`
}

export default forwardRef<TerminalHandle, TerminalProps>(function Terminal({ token, workspaceId, sessionId, visible, terminalTheme, initialCommand, onInitialRun, onTitle }, ref) {
  // Settings come from localStorage, written by the toolbar's = menu. The
  // toolbar also fires a same-tab custom event (the `storage` event only fires
  // in other tabs), so no polling is needed.
  const [termSettings, setTermSettings] = useState<TerminalSettings>(readTermSettings)
  const [keyboardPad, setKeyboardPad] = useState(0)
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
  const zoomRowsRef = useRef<number | null>(null)
  const followTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followBurstStartRef = useRef(0)
  const scheduleFollowRef = useRef<() => void>(() => {})
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
    const isZoom = settingsRef.current.followMode === 'zoom'
    const cols = Math.max(proposed.cols, minCols)
    let rows = Math.max(proposed.rows, minRows)
    if (isZoom) {
      // Keep the row count frozen so the PTY does not reflow when the keyboard
      // shrinks the viewport; CSS scales the rendered terminal vertically.
      if (zoomRowsRef.current == null) zoomRowsRef.current = rows
      rows = Math.max(zoomRowsRef.current, minRows)
    } else {
      zoomRowsRef.current = rows
    }
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
    const cell = (term as unknown as XtermInternals)._core?._renderService?.dimensions?.css?.cell
    const xtermEl = term.element
    let zoomScale: number | null = null
    if (xtermEl && cell?.width && cell?.height) {
      if (isZoom || cols > proposed.cols || rows > proposed.rows) {
        xtermEl.style.width = `${Math.round(cols * cell.width)}px`
        xtermEl.style.height = `${Math.round(rows * cell.height)}px`
      } else {
        xtermEl.style.width = ''
        xtermEl.style.height = ''
      }
      if (isZoom) {
        const naturalHeight = Math.max(1, rows * cell.height)
        const availableHeight = Math.max(1, container.clientHeight - keyboardPaddingRef.current)
        const scale = Math.min(1.5, Math.max(0.2, availableHeight / naturalHeight))
        zoomScale = scale
        xtermEl.style.transformOrigin = 'left top'
        xtermEl.style.transform = `scaleY(${scale.toFixed(4)})`
      } else {
        xtermEl.style.transformOrigin = ''
        xtermEl.style.transform = ''
      }
    }
    logUi('debug', 'terminal', 'applySizing', {
      followMode: settingsRef.current.followMode,
      container: [container.clientWidth, container.clientHeight],
      keyboardPad: keyboardPaddingRef.current,
      proposed: [proposed.cols, proposed.rows],
      final: [cols, rows],
      zoomScale,
    })
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
      // Prepend the deployment base path so the WS works behind a sub-path proxy.
      const base = basePath()
      // Pass auth token as a WebSocket subprotocol ("auth.<token>") so it never
      // appears in server access logs or browser history. The session ID is a
      // non-secret resumption handle passed as a query param.
      //
      // Workspace-scoped path so everyone in a workspace shares one PTY per session id;
      // falls back to the legacy default-workspace route until the workspace id resolves.
      const path = workspaceId
        ? `${base}/api/workspaces/${encodeURIComponent(workspaceId)}/terminal`
        : `${base}/api/terminal`
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

    // Follow cursor is event-driven with a short settle delay. Cursor redraws
    // fire onCursorMove too, so debounce avoids scrolling on every repaint.
    term.onCursorMove(() => scheduleFollowRef.current())
    term.onWriteParsed(() => scheduleFollowRef.current())

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
    const frame = requestAnimationFrame(() => {
      applySizing()
      if (termSettings.followMode === 'follow') scheduleFollowRef.current()
    })
    return () => cancelAnimationFrame(frame)
  }, [termSettings.fontSize, termSettings.scrollback, termSettings.minCols, termSettings.minRows, termSettings.followMode, termSettings.followMargin, applySizing])

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

  // Detect the software keyboard through the VirtualKeyboard API when present
  // and fall back to visualViewport (iOS Safari, Firefox). The effective inset
  // is 0 when the browser already resized the layout viewport.
  const keyboardPaddingRef = useRef(0)
  const viewportBaselineRef = useRef(0)

  // Scroll the terminal so the cursor stays within a safe margin from all edges.
  // xterm.js cursorY is the absolute line in the buffer (not relative to viewport).
  // viewportY is the first visible line. We ensure the cursor stays at least
  // MARGIN fraction away from the top and bottom of the visible area.
  const scrollCursorIntoView = (term: XTerminal) => {
    const buf = term.buffer.active
    const cell = (term as unknown as XtermInternals)._core?._renderService?.dimensions?.css?.cell
    const container = containerRef.current
    const marginFraction = Math.min(0.5, Math.max(0, settingsRef.current.followMargin ?? 0.2))

    // Min-size mode (minCols/minRows): `.xterm` is taller than the container
    // and the container is the scroller. `term.scrollToLine` only moves xterm's
    // internal viewport (already at the bottom), so the cursor can sit outside
    // the container's visible area. Scroll the container to the cursor's row.
    if (container && term.element && cell?.height && container.scrollHeight > container.clientHeight + 1) {
      term.scrollToBottom()
      const cursorPx = buf.cursorY * cell.height
      const margin = Math.max(0, Math.round(container.clientHeight * marginFraction))
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
    // marginFraction away from the top and bottom of the visible area.
    const absCursorLine = buf.baseY + buf.cursorY  // absolute line in buffer
    const totalRows = term.rows
    const viewportY = buf.viewportY               // first visible line (absolute)
    const paddingRows = Math.max(0, Math.floor(totalRows * marginFraction))
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

  // Debounced follow: wait until the cursor has been still for 250ms, but never
  // defer longer than 500ms during continuous output/redraw.
  scheduleFollowRef.current = () => {
    if (settingsRef.current.followMode !== 'follow') return
    const now = Date.now()
    if (!followBurstStartRef.current) followBurstStartRef.current = now
    const wait = now - followBurstStartRef.current > 500 ? 0 : 250
    if (followTimerRef.current) clearTimeout(followTimerRef.current)
    followTimerRef.current = setTimeout(() => {
      followTimerRef.current = null
      followBurstStartRef.current = 0
      const term = termRef.current
      if (term && settingsRef.current.followMode === 'follow') scrollCursorIntoView(term)
    }, wait)
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
    const vv = window.visualViewport
    if (vk) {
      try {
        vk.overlaysContent = true
      } catch {
        logUi('warn', 'keyboard', 'virtualKeyboard.overlaysContent failed')
      }
    }

    let frame = 0
    let baselineTimer: ReturnType<typeof setTimeout> | null = null
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    const currentHeight = () => Math.max(window.innerHeight, vv?.height ?? 0)
    viewportBaselineRef.current = currentHeight()
    logUi('info', 'keyboard', 'keyboard detection installed', {
      virtualKeyboard: Boolean(vk),
      visualViewport: Boolean(vv),
      baseline: viewportBaselineRef.current,
    })

    const scheduleBaselineRefresh = () => {
      if (baselineTimer) clearTimeout(baselineTimer)
      baselineTimer = setTimeout(() => {
        baselineTimer = null
        if (keyboardPaddingRef.current !== 0) return
        const baseline = currentHeight()
        viewportBaselineRef.current = baseline
        logUi('debug', 'keyboard', 'baseline refreshed', { baseline })
      }, 500)
    }

    const updateInset = (reason: string) => {
      const layoutH = window.innerHeight
      const visualH = vv?.height ?? layoutH
      const visualTop = vv?.offsetTop ?? 0
      const visualBottom = visualTop + visualH
      const scale = vv?.scale ?? 1
      const vkRect = vk?.boundingRect
      const vkH = vkRect && Number.isFinite(vkRect.height) ? Math.max(0, Math.round(vkRect.height)) : 0
      const current = Math.max(layoutH, visualH)
      if (!viewportBaselineRef.current || viewportBaselineRef.current <= 0) {
        viewportBaselineRef.current = current
      }
      const baseline = viewportBaselineRef.current
      const threshold = Math.max(120, Math.round(baseline * 0.15))
      const layoutInset = baseline - layoutH
      const visualInset = baseline - visualBottom
      let inset = 0
      let source = 'none'

      if (scale > 1.02) {
        source = 'pinch'
      } else if (layoutInset > threshold) {
        // The browser already made room by resizing the layout viewport.
        source = 'layout'
      } else if (vkH > 0) {
        inset = Math.min(vkH, Math.max(0, layoutH))
        source = 'virtualkeyboard'
      } else if (visualInset > threshold) {
        inset = Math.min(Math.round(visualInset), Math.max(0, layoutH))
        source = 'visualviewport'
      }

      const changed = inset !== keyboardPaddingRef.current
      if (changed) {
        keyboardPaddingRef.current = inset
        setKeyboardPad(inset)
        if (frame) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          applySizing()
          const term = termRef.current
          if (!term) return
          const mode = settingsRef.current.followMode
          if (mode !== 'zoom' && inset > 0) scrollAboveKeyboard(term, inset)
          if (mode === 'follow') scheduleFollowRef.current()
        })
      }

      if (inset === 0) scheduleBaselineRefresh()
      else if (baselineTimer) {
        clearTimeout(baselineTimer)
        baselineTimer = null
      }

      logUi('debug', 'keyboard', changed ? 'inset changed' : 'viewport', {
        reason,
        source,
        baseline,
        layoutH,
        visualH,
        visualTop,
        scale,
        vkH,
        layoutInset,
        visualInset,
        inset,
        focused: describeTarget(document.activeElement),
      })
    }

    const onResize = () => updateInset('resize')
    const onScroll = () => updateInset('scroll')
    const onVk = () => updateInset('geometrychange')
    const onFocusIn = (event: FocusEvent) => {
      if (isEditableTarget(event.target)) logUi('debug', 'keyboard', 'editable focused', { target: describeTarget(event.target) })
      updateInset('focusin')
    }
    const onFocusOut = (event: FocusEvent) => {
      logUi('debug', 'keyboard', 'focusout', { target: describeTarget(event.target) })
      if (focusTimer) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusTimer = null
        updateInset('focusout')
      }, 100)
    }
    const onOrientation = () => {
      viewportBaselineRef.current = 0
      zoomRowsRef.current = null
      requestAnimationFrame(() => {
        updateInset('orientation')
        applySizing()
      })
    }

    vv?.addEventListener('resize', onResize)
    vv?.addEventListener('scroll', onScroll)
    vk?.addEventListener('geometrychange', onVk)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientation)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    updateInset('install')

    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (baselineTimer) clearTimeout(baselineTimer)
      if (focusTimer) clearTimeout(focusTimer)
      vv?.removeEventListener('resize', onResize)
      vv?.removeEventListener('scroll', onScroll)
      vk?.removeEventListener('geometrychange', onVk)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [applySizing])

  // Re-fit when the keyboard height state changes (shrink mode uses it as a
  // real height reduction, zoom mode uses it to compute the CSS scale).
  useEffect(() => {
    const frame = requestAnimationFrame(() => applySizing())
    return () => cancelAnimationFrame(frame)
  }, [keyboardPad, applySizing])

  useEffect(() => () => {
    if (followTimerRef.current) clearTimeout(followTimerRef.current)
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
  const isZoom = termSettings.followMode === 'zoom'
  return (
    <div
      ref={containerRef}
      data-testid="terminal-scroll"
      className={`w-full ${scrolls ? 'overflow-auto' : isZoom ? 'overflow-hidden' : ''}`}
      style={{
        display: visible ? 'block' : 'none',
        touchAction: 'pan-x pan-y',
        overscrollBehavior: 'contain',
        height: isShrink && keyboardPad > 0 ? `calc(100% - ${keyboardPad}px)` : '100%',
        minHeight: 0,
        flex: isShrink || isZoom ? '1 1 0%' : undefined,
        paddingBottom: !isShrink && !isZoom && keyboardPad > 0 ? `${keyboardPad}px` : undefined,
      }}
    />
  )
})
