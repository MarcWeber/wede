import { describe, expect, it } from 'vitest'
import { detectSwipe } from './swipe'

describe('detectSwipe', () => {
  it('rejects tiny and invalid movements', () => {
    expect(detectSwipe(0, 0)).toBeNull()
    expect(detectSwipe(10, 10)).toBeNull()
    expect(detectSwipe(Number.NaN, 40)).toBeNull()
    expect(detectSwipe(40, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('detects cardinal directions', () => {
    expect(detectSwipe(0, -18)?.direction).toBe('up')
    expect(detectSwipe(0, 18)?.direction).toBe('down')
    expect(detectSwipe(-18, 0)?.direction).toBe('left')
    expect(detectSwipe(18, 0)?.direction).toBe('right')
  })

  it('keeps near-horizontal and near-vertical gestures cardinal', () => {
    expect(detectSwipe(40, -10)?.direction).toBe('right')
    expect(detectSwipe(-40, 10)?.direction).toBe('left')
    expect(detectSwipe(10, -40)?.direction).toBe('up')
    expect(detectSwipe(-10, 40)?.direction).toBe('down')
  })

  it('detects diagonals distinctly from vertical up', () => {
    expect(detectSwipe(40, -24)?.direction).toBe('up-right')
    expect(detectSwipe(-40, -24)?.direction).toBe('up-left')
    expect(detectSwipe(40, 24)?.direction).toBe('down-right')
    expect(detectSwipe(-40, 24)?.direction).toBe('down-left')
    expect(detectSwipe(10, -40)?.direction).toBe('up')
    expect(detectSwipe(40, -10)?.direction).toBe('right')
  })

  it('applies the larger diagonal threshold', () => {
    expect(detectSwipe(15, 15)).toBeNull()
    expect(detectSwipe(17, 17, { diagonalMinDistance: 20 })?.direction).toBe('down-right')
    expect(detectSwipe(25, 1, { minDistance: 30 })).toBeNull()
  })
})
