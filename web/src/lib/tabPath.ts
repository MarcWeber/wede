// Format a tab's file path with cursor location for clipboard copying.
// Produces paths like ~/foo.txt:20:17 that can be pasted into a terminal IDE.

// Convert an absolute path to use ~ for the home directory prefix.
export function withHome(path: string, home: string | null | undefined): string {
  if (!home) return path
  const h = home.replace(/\/+$/, '')
  if (!h) return path
  if (path === h) return '~'
  if (path.startsWith(h + '/')) return '~' + path.slice(h.length)
  return path
}

// Build an absolute path from a workspace root and a relative path.
export function absolutePath(root: string | null | undefined, rel: string): string {
  if (!rel) return ''
  if (rel.startsWith('/')) return rel
  const r = (root || '').replace(/\/+$/, '')
  return r ? r + '/' + rel : rel
}

// Format a tab location as path:line:col (or just path if no cursor).
export function formatTabLocation({
  root,
  rel,
  home,
  line,
  col,
}: {
  root: string | null | undefined
  rel: string
  home: string | null | undefined
  line?: number
  col?: number
}): string {
  const abs = absolutePath(root, rel)
  const p = withHome(abs, home)
  if (line != null && col != null && line > 0 && col > 0) {
    return `${p}:${line}:${col}`
  }
  return p
}
