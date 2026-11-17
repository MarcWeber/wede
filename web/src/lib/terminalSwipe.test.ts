import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWIPE_CONFIG, createSwipeState, lockAxis, nextSwipeDelta, swipeSequence, targetSteps,
} from './terminalSwipe'

describe('swipeSequence', () => {
  it('cursor mode follows the finger on both axes', () => {
    expect(swipeSequence('cursor', 'up')).toBe('\x1b[A')
    expect(swipeSequence('cursor', 'down')).toBe('\x1b[B')
    expect(swipeSequence('cursor', 'left')).toBe('\x1b[D')
    expect(swipeSequence('cursor', 'right')).toBe('\x1b[C')
  })

  it('paging modes map finger-up to the next page down', () => {
    expect(swipeSequence('page', 'up')).toBe('\x1b[6~')
    expect(swipeSequence('page', 'down')).toBe('\x1b[5~')
    expect(swipeSequence('half', 'up')).toBe('\x04')
    expect(swipeSequence('half', 'down')).toBe('\x15')
    expect(swipeSequence('emacs', 'up')).toBe('\x16')
    expect(swipeSequence('emacs', 'down')).toBe('\x1bv')
  })

  it('wheel and native scroll are handled by the caller', () => {
    expect(swipeSequence('wheel', 'up')).toBe('')
    expect(swipeSequence('scroll', 'down')).toBe('')
  })
})

describe('targetSteps', () => {
  const cfg = { ...DEFAULT_SWIPE_CONFIG, stepPx: 10 }

  it('keeps small movements precise', () => {
    expect(targetSteps(5, cfg)).toBeLessThan(1)
    expect(Math.trunc(targetSteps(5, cfg))).toBe(0)
    expect(Math.trunc(targetSteps(10, cfg))).toBe(1)
  })

  it('accelerates large movements but caps the multiplier and total', () => {
    expect(targetSteps(20, cfg)).toBeGreaterThan(2)
    expect(targetSteps(40, cfg)).toBeGreaterThan(4)
    expect(targetSteps(200, cfg)).toBe(cfg.maxSteps)
    expect(targetSteps(1000, cfg)).toBe(cfg.maxSteps)
  })

  it('is symmetric and rejects invalid input', () => {
    expect(targetSteps(-40, cfg)).toBe(-targetSteps(40, cfg))
    expect(targetSteps(40, { ...cfg, stepPx: 0 })).toBe(0)
    expect(targetSteps(Number.NaN, cfg)).toBe(0)
  })
})

describe('lockAxis', () => {
  it('locks the dominant axis after the threshold', () => {
    expect(lockAxis(2, 2, null, DEFAULT_SWIPE_CONFIG)).toBeNull()
    expect(lockAxis(2, 10, null, DEFAULT_SWIPE_CONFIG)).toBe('y')
    expect(lockAxis(10, 2, null, DEFAULT_SWIPE_CONFIG)).toBe('x')
  })

  it('never changes an existing lock', () => {
    expect(lockAxis(100, 1, 'y', DEFAULT_SWIPE_CONFIG)).toBe('y')
    expect(lockAxis(1, 100, 'x', DEFAULT_SWIPE_CONFIG)).toBe('x')
  })
})

describe('nextSwipeDelta', () => {
  it('emits small deltas one at a time and catches up', () => {
    const cfg = { ...DEFAULT_SWIPE_CONFIG, stepPx: 10 }
    const first = nextSwipeDelta(10, createSwipeState(0), 1000, cfg)
    expect(first.delta).toBe(1)
    expect(first.state.sent).toBe(1)
    const second = nextSwipeDelta(20, first.state, 1100, cfg)
    expect(second.delta).toBe(2)
    expect(second.state.sent).toBe(3)
  })

  it('caps the burst per event and per second', () => {
    const cfg = { ...DEFAULT_SWIPE_CONFIG, stepPx: 10, maxPerEvent: 3, maxPerSec: 10 }
    const first = nextSwipeDelta(1000, createSwipeState(0), 1000, cfg)
    expect(first.delta).toBe(3)
    const immediate = nextSwipeDelta(1000, first.state, 1001, cfg)
    expect(immediate.delta).toBe(1)
  })

  it('handles direction reversal with signed sent steps', () => {
    const cfg = { ...DEFAULT_SWIPE_CONFIG, stepPx: 10 }
    const down = nextSwipeDelta(40, createSwipeState(0), 1000, cfg)
    expect(down.delta).toBeGreaterThan(0)
    const up = nextSwipeDelta(0, down.state, 1100, cfg)
    expect(up.delta).toBeLessThan(0)
  })
})
