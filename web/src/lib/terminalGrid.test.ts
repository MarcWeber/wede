import { describe, it, expect } from 'vitest'
import {
  defaultGrid, gridBounds, gridOrder, hasSettingsAction, setCellAction,
  seqForAction, actionLabel, dirFromDelta, applyQuick, QUICK_ASSIGNMENTS,
} from './terminalGrid'

describe('terminalGrid', () => {
  it('default grid is 2x2 and keeps a settings action', () => {
    const g = defaultGrid()
    expect(gridBounds(g)).toEqual({ rows: 2, cols: 2 })
    expect(hasSettingsAction(g)).toBe(true)
    expect(gridOrder(g)).toEqual(['A2', 'A1', 'B2', 'B1'])
    expect(actionLabel(g.B2!.T!)).toBe('=')
  })

  it('decodes key actions to PTY bytes', () => {
    expect(seqForAction('send-ctrl-u')).toBe('\x15')
    expect(seqForAction('send-esc-x')).toBe('\x1bx')
    expect(seqForAction('send-f5')).toBe('\x1b[15~')
    expect(seqForAction('send-key-tab')).toBe('\t')
    expect(seqForAction('send-text-~')).toBe('~')
    expect(seqForAction('send-text-fg\n')).toBe('fg\n')
  })

  it('maps swipe sectors to the grid directions', () => {
    expect(dirFromDelta(0, -40)).toBe('t')
    expect(dirFromDelta(40, -40)).toBe('tr')
    expect(dirFromDelta(40, 0)).toBe('r')
    expect(dirFromDelta(40, 40)).toBe('br')
    expect(dirFromDelta(0, 40)).toBe('b')
    expect(dirFromDelta(-40, 40)).toBe('bl')
    expect(dirFromDelta(-40, 0)).toBe('l')
    expect(dirFromDelta(-40, -40)).toBe('tl')
  })

  it('detects when the last settings action would be removed', () => {
    const g = setCellAction(defaultGrid(), 'B2', 'T', null)
    expect(hasSettingsAction(g)).toBe(false)
  })

  it('presets replace the whole cell', () => {
    const g = applyQuick(defaultGrid(), 'A1', 'hamburger')
    expect(g.A1).toEqual(QUICK_ASSIGNMENTS.hamburger.actions)
  })
})
