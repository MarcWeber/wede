import { describe, it, expect } from 'vitest'
import { clampPointToRect } from './collabPointerDom'

const pane = { left: 100, top: 100, right: 500, bottom: 400 }
const viewport = { width: 800, height: 600 }

describe('clampPointToRect', () => {
  it('leaves an on-screen point alone', () => {
    expect(clampPointToRect(200, 200, pane, viewport)).toEqual({ x: 200, y: 200, offscreen: false, direction: null })
  })

  it('pins a point above the pane to its top edge', () => {
    const p = clampPointToRect(200, -50, pane, viewport)
    expect(p.offscreen).toBe(true)
    expect(p.direction).toBe('up')
    expect(p.y).toBe(114)
  })

  it('pins a point below the pane to its bottom edge', () => {
    const p = clampPointToRect(200, 900, pane, viewport)
    expect(p.offscreen).toBe(true)
    expect(p.direction).toBe('down')
    expect(p.y).toBe(386)
  })

  it('pins a point left of the pane to its left edge', () => {
    const p = clampPointToRect(-20, 200, pane, viewport)
    expect(p.offscreen).toBe(true)
    expect(p.direction).toBe('left')
    expect(p.x).toBe(114)
  })

  it('pins a point right of the pane to its right edge', () => {
    const p = clampPointToRect(900, 200, pane, viewport)
    expect(p.offscreen).toBe(true)
    expect(p.direction).toBe('right')
    expect(p.x).toBe(486)
  })
})
