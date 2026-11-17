import { describe, expect, it } from 'vitest'
import { DEFAULT_UI_SCALE, clampUiScale, normalizeUiScale, orientationFor } from './uiScale'

describe('clampUiScale', () => {
  it('keeps scales in the 50-100% range', () => {
    expect(clampUiScale(0.5)).toBe(0.5)
    expect(clampUiScale(1)).toBe(1)
    expect(clampUiScale(0.2)).toBe(0.5)
    expect(clampUiScale(1.5)).toBe(1)
    expect(clampUiScale(Number.NaN)).toBe(1)
  })
})

describe('normalizeUiScale', () => {
  it('fills missing profiles and clamps bad values', () => {
    expect(normalizeUiScale(null)).toEqual(DEFAULT_UI_SCALE)
    expect(normalizeUiScale({ portrait: { x: 0.8, y: 2 } })).toEqual({
      portrait: { x: 0.8, y: 1 },
      landscape: { x: 1, y: 1 },
    })
  })
})

describe('orientationFor', () => {
  it('uses landscape only when width is greater than height', () => {
    expect(orientationFor(800, 600)).toBe('landscape')
    expect(orientationFor(600, 800)).toBe('portrait')
    expect(orientationFor(600, 600)).toBe('portrait')
  })
})
