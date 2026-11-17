// Module-level holder for the focused workspace id. useWorkspaces keeps it in
// sync; authFetch reads it to rewrite legacy /api/<service> paths to the
// workspace-scoped /api/workspaces/<id>/<service> form, so switching workspaces
// repoints all file/git/search/etc. requests with no per-component changes.
import { apiBase } from '../api'

let activeWorkspaceId: string | null = null

export function setActiveWorkspaceId(id: string | null): void { activeWorkspaceId = id }
export function getActiveWorkspaceId(): string | null { return activeWorkspaceId }

// Services that are workspace-scoped on the server. Matched as /api/<service>(/|?|end).
const SCOPED = /^\/api\/(files|git|search|watch|lsp|terminal|tasks|trust|dap)(\/|\?|$)/

// scopedUrl rewrites a legacy /api/<service>... path to the active workspace's
// scoped path. Already-scoped, auth, folder, tunnel, etc. paths pass through.
// It also prepends the base path so the app works behind a sub-path proxy.
export function scopedUrl<T>(url: T): T {
  if (typeof url !== 'string') return url
  const u = url as string
  const base = apiBase()
  // Already workspace-scoped: only add the deployment base path.
  if (u.startsWith('/api/workspaces/')) return (base + u.slice(4)) as unknown as T
  // Legacy workspace-scoped service: rewrite to scoped path with base.
  if (activeWorkspaceId && SCOPED.test(u)) {
    return (base + '/workspaces/' + encodeURIComponent(activeWorkspaceId) + u.slice(4)) as unknown as T
  }
  // Non-workspace /api/... paths (auth, folder, tunnel, etc.): prepend base.
  if (u.startsWith('/api/')) {
    return (base + u.slice(4)) as unknown as T
  }
  return url
}
