import { describe, it, expect } from 'vitest'
import { followTargetFromPeer, targetSelectionKey } from './followSelection'

describe('followTargetFromPeer', () => {
  it('treats a bare cursor as no selection', () => {
    const t = followTargetFromPeer({ line: 12 })
    expect(t.line).toBe(12)
    expect(t.selection).toBeUndefined()
  })

  it('defaults a missing line to 1', () => {
    expect(followTargetFromPeer({}).line).toBe(1)
  })

  it('mirrors a multi-line selection', () => {
    const t = followTargetFromPeer({ line: 4, anchorLine: 2, anchorCol: 3, headLine: 4, headCol: 7 })
    expect(t.selection).toEqual({ anchorLine: 2, anchorCol: 3, headLine: 4, headCol: 7 })
  })

  it('mirrors a selection inside one line', () => {
    const t = followTargetFromPeer({ line: 2, anchorLine: 2, anchorCol: 5, headLine: 2, headCol: 9 })
    expect(t.selection).toEqual({ anchorLine: 2, anchorCol: 5, headLine: 2, headCol: 9 })
  })

  it('preserves a reversed (bottom-up) selection', () => {
    const t = followTargetFromPeer({ line: 2, anchorLine: 6, anchorCol: 1, headLine: 2, headCol: 4 })
    expect(t.selection).toEqual({ anchorLine: 6, anchorCol: 1, headLine: 2, headCol: 4 })
  })

  it('normalises an empty column to 1', () => {
    const t = followTargetFromPeer({ line: 3, anchorLine: 1, anchorCol: 0, headLine: 3, headCol: 0 })
    expect(t.selection).toEqual({ anchorLine: 1, anchorCol: 1, headLine: 3, headCol: 1 })
  })

  it('treats a collapsed selection (anchor === head) as no selection', () => {
    expect(followTargetFromPeer({ line: 5, anchorLine: 5, anchorCol: 2, headLine: 5, headCol: 2 }).selection)
      .toBeUndefined()
  })

  it('ignores a selection missing one endpoint', () => {
    expect(followTargetFromPeer({ line: 5, anchorLine: 5, anchorCol: 2 }).selection).toBeUndefined()
    expect(followTargetFromPeer({ line: 5, headLine: 5, headCol: 2 }).selection).toBeUndefined()
  })
})

describe('targetSelectionKey', () => {
  it('is empty for no selection', () => {
    expect(targetSelectionKey(undefined)).toBe('')
  })

  it('is stable for the same range and changes when any endpoint moves', () => {
    const a = { anchorLine: 1, anchorCol: 2, headLine: 3, headCol: 4 }
    expect(targetSelectionKey(a)).toBe(targetSelectionKey({ ...a }))
    expect(targetSelectionKey({ ...a, headCol: 5 })).not.toBe(targetSelectionKey(a))
  })
})
