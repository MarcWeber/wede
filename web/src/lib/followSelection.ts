import type { Tab } from '../types'

// Presence fields a peer publishes for their cursor/selection. Older clients
// (and plain cursors) may only send `line`, so every field here is optional.
export interface PeerCursor {
  line?: number
  anchorLine?: number
  anchorCol?: number
  headLine?: number
  headCol?: number
}

export interface FollowTarget {
  // 1-based line to scroll to / collapse to.
  line: number
  // The peer's selection, or undefined when they have a bare cursor.
  selection: Tab['targetSelection']
}

// Convert a peer's published cursor into the line + selection we mirror in the
// follower's editor. A selection is only valid when both endpoints are present
// (line > 0); a collapsed cursor (anchor === head) is deliberately normalised
// to `undefined` so we do not apply (and later have to clear) an empty range.
export function followTargetFromPeer(peer: PeerCursor): FollowTarget {
  const line = peer.line || 1
  const al = peer.anchorLine ?? 0
  const ac = peer.anchorCol ?? 0
  const hl = peer.headLine ?? 0
  const hc = peer.headCol ?? 0
  const hasSel = al > 0 && hl > 0 && (al !== hl || ac !== hc)
  return {
    line,
    selection: hasSel
      ? { anchorLine: al, anchorCol: ac || 1, headLine: hl, headCol: hc || 1 }
      : undefined,
  }
}

// Stable identity for a selection, used to avoid re-dispatching an unchanged
// range (which would fight the user's cursor).
export function targetSelectionKey(sel: Tab['targetSelection']): string {
  return sel ? `${sel.anchorLine}:${sel.anchorCol}:${sel.headLine}:${sel.headCol}` : ''
}
