import type { TerminalSwipeMode } from '../types'

export type SwipeDirection = 'up' | 'down' | 'left' | 'right'
export type SwipeAxis = 'x' | 'y' | null

export interface SwipeConfig {
  stepPx: number
  acceleration: number
  maxMultiplier: number
  maxSteps: number
  maxPerEvent: number
  maxPerSec: number
  axisLockPx: number
  axisLockRatio: number
}

export interface SwipeState {
  axis: SwipeAxis
  sent: number
  lastSendAt: number
}

export const DEFAULT_SWIPE_CONFIG: SwipeConfig = {
  stepPx: 10,
  acceleration: 0.35,
  maxMultiplier: 5,
  maxSteps: 20,
  maxPerEvent: 20,
  maxPerSec: 45,
  axisLockPx: 6,
  axisLockRatio: 1.2,
}

export function createSwipeState(now: number): SwipeState {
  return { axis: null, sent: 0, lastSendAt: now - 1000 }
}

// Maps total finger displacement (px) to a signed number of actions. The linear
// part keeps small movements precise; the quadratic part accelerates long
// swipes. maxMultiplier limits the curve and maxSteps limits the whole gesture.
export function targetSteps(px: number, cfg: SwipeConfig): number {
  if (!Number.isFinite(px) || !Number.isFinite(cfg.stepPx) || cfg.stepPx <= 0) return 0
  const linear = px / cfg.stepPx
  const quad = Math.sign(linear) * Math.min(
    cfg.maxMultiplier * Math.abs(linear),
    cfg.acceleration * linear * linear,
  )
  const raw = linear + quad
  if (!Number.isFinite(cfg.maxSteps) || cfg.maxSteps <= 0) return raw
  return Math.max(-cfg.maxSteps, Math.min(cfg.maxSteps, raw))
}

export function lockAxis(dx: number, dy: number, axis: SwipeAxis, cfg: SwipeConfig): SwipeAxis {
  if (axis) return axis
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (absY > cfg.axisLockPx && absY > absX * cfg.axisLockRatio) return 'y'
  if (absX > cfg.axisLockPx && absX > absY * cfg.axisLockRatio) return 'x'
  return null
}

export function nextSwipeDelta(totalPx: number, state: SwipeState, now: number, cfg: SwipeConfig): {
  delta: number
  state: SwipeState
} {
  const target = targetSteps(totalPx, cfg)
  const elapsed = Math.max(0, now - state.lastSendAt)
  const maxByTime = Math.max(1, Math.floor(cfg.maxPerSec * elapsed / 1000))
  const max = Math.min(cfg.maxPerEvent, maxByTime)
  const delta = Math.max(-max, Math.min(max, Math.trunc(target - state.sent)))
  return {
    delta,
    state: {
      ...state,
      sent: state.sent + delta,
      lastSendAt: delta !== 0 ? now : state.lastSendAt,
    },
  }
}

// Maps a finger direction to the bytes sent for the selected swipe behavior.
// Cursor mode follows the finger (up = up arrow). Paging modes keep the
// touch-scroll convention: finger up advances one page down.
export function swipeSequence(mode: TerminalSwipeMode, dir: SwipeDirection): string {
  if (mode === 'cursor') {
    if (dir === 'up') return '\x1b[A'
    if (dir === 'down') return '\x1b[B'
    if (dir === 'left') return '\x1b[D'
    return '\x1b[C'
  }
  if (dir === 'left' || dir === 'right') return ''
  const fingerUp = dir === 'up'
  if (mode === 'page') return fingerUp ? '\x1b[6~' : '\x1b[5~'
  if (mode === 'half') return fingerUp ? '\x04' : '\x15'
  if (mode === 'emacs') return fingerUp ? '\x16' : '\x1bv'
  return ''
}
