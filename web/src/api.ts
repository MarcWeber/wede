// Central API helpers for the workspace-scoped backend.
//
// The backend exposes both legacy single-workspace routes (e.g. /api/files) that
// operate on the default workspace, and workspace-scoped routes under /api/workspaces/{id}/...
// As the frontend migrates, prefer workspaceUrl(workspaceId, suffix) to address a specific
// workspace; the legacy paths remain valid for the default workspace until migration done.

/**
 * Returns the base path prefix for the app.  When the app is served behind a
 * sub-path proxy (e.g. https://host/wede/) the leading segment is returned so
 * that all API and WebSocket URLs resolve relative to that prefix instead of
 * the absolute root.  At the origin root the function returns an empty string.
 *
 * In non-browser environments (e.g. unit tests) it falls back to an empty
 * string so the function is safe to call during SSR or CI.
 */
export function basePath(pathname?: string): string {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/')
  // Strip the trailing slash so that `basePath() + '/api'` yields '/api' at
  // the origin root and '/wede/api' under a sub-path. If the browser is at a
  // concrete file (e.g. /wede/index.html), use its directory instead.
  const clean = p.replace(/\/+$/, '')
  const leaf = clean.slice(clean.lastIndexOf('/') + 1)
  if (leaf.includes('.')) return clean.slice(0, clean.lastIndexOf('/')).replace(/\/+$/, '')
  return clean || ''
}

/**
 * Returns the API base URL (e.g. '/api' or '/wede/api').
 */
export function apiBase(): string {
  return `${basePath()}/api`
}

// Legacy constant kept for backward compatibility — resolves to the same value
// as apiBase() at runtime.
export const API = '/api'

// workspaceUrl builds a workspace-scoped API path.
//   workspaceUrl('abc', '/files')          -> /api/workspaces/abc/files
//   workspaceUrl('abc', '/git/status')     -> /api/workspaces/abc/git/status
export function workspaceUrl(workspaceId: string, suffix = ''): string {
  return `${apiBase()}/workspaces/${workspaceId}${suffix}`
}

// workspacesUrl is the workspace collection endpoint.
export const workspacesUrl = `${apiBase()}/workspaces`

// sessionsUrl lists active sessions + configured templates.
export const sessionsUrl = `${apiBase()}/sessions`
