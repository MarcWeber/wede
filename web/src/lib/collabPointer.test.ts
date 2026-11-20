import { describe, it, expect } from 'vitest'
import { clamp01, isCollabPointer, pointerLabel, tabLabel } from './collabPointer'

describe('clamp01', () => {
  it('clamps to the unit interval', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.25)).toBe(0.25)
    expect(clamp01(2)).toBe(1)
  })
})

describe('isCollabPointer', () => {
  it('accepts valid semantic targets', () => {
    expect(isCollabPointer({ kind: 'code', tab: 'main.go', line: 20, col: 14 })).toBe(true)
    expect(isCollabPointer({ kind: 'image', tab: 'pic.png', u: 0.5, v: 0.75 })).toBe(true)
    expect(isCollabPointer({ kind: 'pdf', tab: 'doc.pdf', page: 2, u: 0.1, v: 0.9 })).toBe(true)
    expect(isCollabPointer({ kind: 'terminal', tab: 'term-1', row: 3, col: 8 })).toBe(true)
    expect(isCollabPointer({ kind: 'browser', tab: 'browser:1', url: 'http://localhost', u: 0.2, v: 0.3 })).toBe(true)
  })

  it('rejects malformed or out-of-range targets', () => {
    expect(isCollabPointer(null)).toBe(false)
    expect(isCollabPointer({ kind: 'code', tab: 'main.go', line: 0, col: 1 })).toBe(false)
    expect(isCollabPointer({ kind: 'image', tab: 'pic.png', u: 1.1, v: 0.5 })).toBe(false)
    expect(isCollabPointer({ kind: 'pdf', tab: 'doc.pdf', page: 0, u: 0.5, v: 0.5 })).toBe(false)
    expect(isCollabPointer({ kind: 'unknown', tab: 'x' })).toBe(false)
    expect(isCollabPointer({ kind: 'code', tab: '', line: 1, col: 1 })).toBe(false)
  })
})

describe('pointerLabel', () => {
  it('formats code as file:line:col', () => {
    expect(pointerLabel({ kind: 'code', tab: 'src/main.go', line: 20, col: 14 })).toBe('main.go:20:14')
  })

  it('formats image and PDF points with page/percent context', () => {
    expect(pointerLabel({ kind: 'image', tab: 'pic.png', u: 0.5, v: 0.75 })).toBe('pic.png 50%, 75%')
    expect(pointerLabel({ kind: 'pdf', tab: 'doc.pdf', page: 2, u: 0.5, v: 0.4 })).toBe('doc.pdf p.2 50%, 40%')
  })

  it('falls back to the tab name for panel targets', () => {
    expect(pointerLabel({ kind: 'panel', tab: 'gitgraph:1', u: 0.5, v: 0.5 })).toBe('gitgraph:1')
  })
})

describe('tabLabel', () => {
  it('uses the last path component', () => {
    expect(tabLabel('src/components/Button.tsx')).toBe('Button.tsx')
    expect(tabLabel('C:\\work\\main.go')).toBe('main.go')
  })
})
