/**
 * e2e/fixtures.js — shared Playwright helpers for wede's browser suite.
 *
 *  - `installBackend(page)`: an in-browser mock of the wede Go backend
 *    (auth, folder, workspaces, files, git, tasks, lsp/dap probes) via
 *    page.route, so the suite runs with no `go run ./cmd/wede` and no real
 *    filesystem. Anything under /api that a spec doesn't care about gets a sane
 *    empty answer, so the IDE can mount fully without 404 noise.
 *
 *    WebSockets (terminal, collab, chat, DAP) are stubbed with routeWebSocket:
 *    the IDE opens them on mount, and a *refused* socket is a different code
 *    path from a *quiet* one. We want the quiet one — a socket that connects and
 *    says nothing — so the suite tests the app, not its reconnect backoff.
 *
 *  - `watchForCrashes(page)`: the crash recorder used by EVERY spec. A React app
 *    that throws while rendering unmounts to an EMPTY root and still serves HTTP
 *    200 — the blank screen that shipped elsewhere in this suite. "No pageerror"
 *    is a hard gate here, never a warning.
 *
 *  - `bootTo(page, state)`: drives the app to a given surface. wede gates on
 *    localStorage (theme, then token), so a spec that wants the IDE has to get
 *    past ThemePicker and Login — seeding localStorage before the first script
 *    runs is how we do that without re-testing login in every spec.
 */

/// <reference types="node" />
import { test as base, expect, type Page, type Route, type WebSocketRoute } from '@playwright/test'

export const WORKSPACE_ID = 'ws_default'
export const ROOT = '/home/dev/demo'
export const PASSWORD = 'correct-horse'
export const TOKEN = 'wede_session_token_abc'

// A real, minimal one-page PDF (Helvetica "Hello wede") so the embedded pdf.js
// viewer can actually render in tests instead of hitting a parse error.
const PDF_B64 =
  'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwg' +
  'L1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu' +
  'dCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29u' +
  'dGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0MSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDIwIDEwMCBU' +
  'ZCAoSGVsbG8gd2VkZSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBl' +
  'MSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAw' +
  'MDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAz' +
  'MzggMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDgKJSVFT0YK'
const PDF_BODY = Buffer.from(PDF_B64, 'base64')

export const FILE_TREE = [
  { name: 'src', path: 'src', isDir: true },
  { name: 'README.md', path: 'README.md', isDir: false },
  { name: 'main.go', path: 'main.go', isDir: false },
  { name: 'doc.pdf', path: 'doc.pdf', isDir: false },
  { name: 'pic.png', path: 'pic.png', isDir: false },
  { name: 'long.txt', path: 'long.txt', isDir: false },
]

export const SRC_CHILDREN = [
  { name: 'app.js', path: 'src/app.js', isDir: false },
  { name: 'components', path: 'src/components', isDir: true },
]

export const COMPONENTS_CHILDREN = [
  { name: 'Button.tsx', path: 'src/components/Button.tsx', isDir: false },
  { name: 'deep', path: 'src/components/deep', isDir: true },
]

export const DEEP_CHILDREN = [
  { name: 'Icon.tsx', path: 'src/components/deep/Icon.tsx', isDir: false },
]

const LONG_CONTENT = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

export const FILE_CONTENT: Record<string, string> = {
  'README.md': '# demo\n\nHello from the wede E2E backend.\n',
  'main.go': 'package main\n\nfunc main() {\n\tprintln("hi")\n}\n',
  'src/app.js': 'export const answer = 42\n',
  'long.txt': LONG_CONTENT,
}

/** A login POST body as the frontend sends it. */
export interface LoginAttempt {
  username?: string
  password?: string
}

/** A files/write POST body as the frontend sends it. */
export interface WriteBody {
  path: string
  content: string
}

export interface InstallBackendOptions {
  badPassword?: boolean
  teacher?: boolean
  rrcontrol?: string
  // Optional collab-socket handler. The default is a silent, connected socket.
  collab?: (ws: WebSocketRoute) => void
  websocket?: (ws: WebSocketRoute) => void
}

export interface InstallBackendHandles {
  wrote: WriteBody[]
  loginAttempts: LoginAttempt[]
}

/**
 * Attach the mocked wede backend. Call BEFORE page.goto().
 * Returns handles so a spec can assert what actually reached the wire.
 */
export async function installBackend(
  page: Page,
  { badPassword = false, teacher = false, rrcontrol = 'off', collab, websocket }: InstallBackendOptions = {},
): Promise<InstallBackendHandles> {
  const wrote: WriteBody[] = []
  const loginAttempts: LoginAttempt[] = []
  let attemptsLeft = 60

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const q = url.searchParams
    // Strip the workspace scope so /api/workspaces/<id>/files and /api/files
    // land on the same handler — the frontend rewrites legacy paths to the
    // active workspace at runtime (see lib/activeWorkspace.js).
    const p = path.replace(/^\/api\/workspaces\/[^/]+/, '/api')

    // ── auth ────────────────────────────────────────────────────────────────
    if (p === '/api/auth/login') {
      const body = req.postDataJSON() || {}
      loginAttempts.push(body)
      if (badPassword || body.password !== PASSWORD) {
        attemptsLeft -= 1
        return json(route, { error: 'wrong_password', remaining: Math.max(0, attemptsLeft) })
      }
      return json(route, { token: TOKEN, username: body.username || 'dev', role: 'owner', teacher })
    }
    if (p === '/api/auth/check') {
      const ok = req.headers().authorization === TOKEN
      return json(route, { authenticated: ok, role: ok ? 'owner' : '', teacher: ok && teacher })
    }
    if (p === '/api/auth/logout') return json(route, { ok: true })
    if (p === '/api/auth/tokens') return json(route, { tokens: [] })
    if (p === '/api/ui-config') return json(route, { rrcontrol })

    // ── workspace / folder ──────────────────────────────────────────────────
    if (p === '/api/folder') return json(route, { hasWorkspace: true, current: ROOT, recents: [ROOT] })
    if (p === '/api/folder/browse') return json(route, { entries: [], path: ROOT })
    if (p === '/api/workspaces' && req.method() === 'GET') {
      return json(route, { workspaces: [{ id: WORKSPACE_ID, name: 'default', root: ROOT }] })
    }
    // Newer builds ask /api/sessions first and only fall back to
    // /api/workspaces when that request is not OK. Returning one active session
    // is what selects it automatically and bypasses the "Open a Folder" screen.
    if (p === '/api/sessions' && req.method() === 'GET') {
      return json(route, {
        sessions: [{ id: WORKSPACE_ID, name: 'default', root: ROOT }],
        templates: [],
      })
    }

    // ── files ───────────────────────────────────────────────────────────────
    if (p === '/api/files' && req.method() === 'GET') {
      const dir = q.get('path') || ''
      if (dir === '') return json(route, FILE_TREE)
      if (dir === 'src') return json(route, SRC_CHILDREN)
      if (dir === 'src/components') return json(route, COMPONENTS_CHILDREN)
      if (dir === 'src/components/deep') return json(route, DEEP_CHILDREN)
      return json(route, [])
    }
    if (p === '/api/files/read') {
      const rel = q.get('path') || ''
      if (rel === 'doc.pdf') return json(route, { content: '', fileType: 'pdf', size: 14, path: rel })
      if (rel === 'pic.png') {
        return json(route, {
          content: '',
          fileType: 'image',
          size: 68,
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z0ZkAAAAASUVORK5CYII=',
          path: rel,
        })
      }
      const content = FILE_CONTENT[rel]
      if (content === undefined) return json(route, { error: 'not found' }, 404)
      return json(route, { content, path: rel })
    }
    if (p === '/api/files/raw') {
      const rel = q.get('path') || ''
      if (rel !== 'doc.pdf') return route.fulfill({ status: 404, body: 'not found' })
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'inline; filename="doc.pdf"',
          etag: '"14-test"',
          'cache-control': 'private, max-age=0, must-revalidate',
        },
        body: PDF_BODY,
      })
    }
    if (p === '/api/files/write') {
      wrote.push(req.postDataJSON())
      return json(route, { ok: true })
    }
    if (p === '/api/files/tree') {
      return json(route, {
        files: ['README.md', 'main.go', 'src/app.js', 'src/components/Button.tsx', 'src/components/deep/Icon.tsx', 'doc.pdf', 'pic.png', 'long.txt'],
        dirs: ['src', 'src/components', 'src/components/deep'],
        truncated: false,
      })
    }

    // ── git ─────────────────────────────────────────────────────────────────
    if (p === '/api/git/status') {
      return json(route, { branch: 'main', files: [{ path: 'README.md', status: 'M' }] })
    }
    if (p.startsWith('/api/git/')) return json(route, {})

    // ── misc probes the IDE fires on mount ──────────────────────────────────
    // The IDE opens an EventSource on /watch for filesystem change events. It
    // MUST be answered as text/event-stream: fulfilling it as JSON makes chromium
    // abort the connection and log an error, which would be an artefact of the
    // mock masquerading as an app defect.
    if (p === '/api/watch') {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: ': connected\n\n',
      })
    }

    if (p === '/api/tasks') return json(route, { tasks: [] })
    if (p === '/api/dap/available') return json(route, { languages: [] })
    if (p === '/api/lsp/available') return json(route, { languages: [] })
    if (p === '/api/trust') return json(route, { trusted: true })
    if (p === '/api/tunnel' || p === '/api/tunnel/config') return json(route, { enabled: false })
    if (p === '/api/terminal/sessions') return json(route, { sessions: [] })
    if (p === '/api/search' || p === '/api/search/files') return json(route, { results: [] })

    // Anything else under /api: answer quietly rather than 404, so an unmocked
    // probe can't masquerade as an app defect.
    return json(route, {})
  })

  // The IDE opens WebSockets (collab, terminal, chat, DAP) as soon as it mounts.
  // Let them CONNECT and stay silent: a refused socket exercises reconnect
  // backoff, which is not what these specs are about.
  await page.routeWebSocket(/.*/, (ws) => {
    /* accept the connection; send nothing unless a spec needs collab traffic */
    websocket?.(ws)
    if (collab && /\/collab(?:\?|$)/.test(ws.url())) collab(ws)
  })

  return { wrote, loginAttempts }
}

export interface CrashHandles {
  pageErrors: string[]
  failedRequests: string[]
}

/** Record uncaught exceptions + dead same-origin HTTP requests. Assert EMPTY. */
export function watchForCrashes(page: Page): CrashHandles {
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`))
  page.on('requestfailed', (req) => {
    // http(s) only — a WebSocket that never opens is not a boot failure.
    if (/^https?:\/\/localhost/.test(req.url())) {
      failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`)
    }
  })
  return { pageErrors, failedRequests }
}

/**
 * The three top-level surfaces wede's localStorage gates boot into.
 *
 *   'fresh'  — nothing set: the app must show the ThemePicker (first visit).
 *   'themed' — theme chosen, no token: the app must show Login.
 *   'authed' — theme + session token: the app must boot the full IDE.
 */
export type BootState = 'fresh' | 'themed' | 'authed'

/** Seed localStorage BEFORE the app's first script runs, so a spec can start at the surface it actually wants to test. */
export async function seed(page: Page, state: BootState): Promise<void> {
  await page.addInitScript((s: BootState) => {
    if (s === 'fresh') return
    localStorage.setItem('wede_theme', 'dark')
    if (s === 'authed') {
      localStorage.setItem('wede_token', 'wede_session_token_abc')
      localStorage.setItem('wede_username', 'dev')
      localStorage.setItem('wede_role', 'owner')
    }
  }, state)
}

/** The fixture exposed to specs as `wede`: a page with the backend mocked and crashes recorded. */
export interface WedeFixture extends CrashHandles, InstallBackendHandles {
  page: Page
}

/** A page with the wede backend mocked and crashes recorded. */
export const test = base.extend<{ wede: WedeFixture }>({
  wede: async ({ page }, use) => {
    const backend = await installBackend(page)
    const crashes = watchForCrashes(page)
    await use({ page, ...crashes, ...backend })
    expect(crashes.pageErrors, 'uncaught exception(s) in the built bundle').toEqual([])
  },
})

export { expect }
