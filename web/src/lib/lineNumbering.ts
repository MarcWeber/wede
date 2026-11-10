// lineNumbering.ts — CodeMirror 6 line-number gutter with three modes.
//
//   'normal' — the usual number per line (built-in lineNumbers()).
//   'smart'  — a single narrow column (about one character wide). At each
//               multiple of ten the full number is spelled downward across
//               consecutive lines, one bold digit per line: for 10 the "1" is
//               on line 10 and the "0" on line 11, for 1470 the "1"/"4"/"7"/"0"
//               run down lines 1470..1473. Every 5th line shows a dim "5",
//               every other line a faint dot. The first digit of each decade
//               (10, 20, 30, …) gets a 1px gray rule above it as a landmark.
//   'hidden' — no gutter.

import { gutter, GutterMarker, EditorView, lineNumbers } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

export type NumberingMode = 'normal' | 'smart' | 'hidden'

class CharMarker extends GutterMarker {
  constructor(readonly ch: string, readonly cls: string) { super() }
  eq(other: CharMarker) { return other.ch === this.ch && other.cls === this.cls }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.cls
    span.textContent = this.ch
    return span
  }
}

const fiveMarker = new CharMarker('5', 'cm-num cm-num-five')
const dotMarker = new CharMarker('·', 'cm-num cm-num-dot')

function smartMarker(ln: number): GutterMarker {
  // Each multiple of ten spells its number downward, starting on its own line.
  const base = Math.floor(ln / 10) * 10
  if (base >= 10) {
    const digits = String(base)
    const idx = ln - base
    if (idx < digits.length) {
      return new CharMarker(
        digits[idx],
        `cm-num cm-num-stackdigit${idx === 0 ? ' cm-num-decade' : ''}`,
      )
    }
  }
  if (ln % 5 === 0) return fiveMarker
  return dotMarker
}

const smartTheme = EditorView.theme({
  // Exactly one character wide — the spacer (a "0") sets the column width.
  '.cm-smartGutter': { minWidth: '0', width: '1ch' },
  '.cm-smartGutter .cm-gutterElement': {
    textAlign: 'center',
    padding: '0',
    minWidth: '1ch',
    overflow: 'visible',
  },
  '.cm-num': { display: 'inline-block', width: '1ch', textAlign: 'center' },
  '.cm-num-dot': { opacity: '0.3' },
  '.cm-num-five': { opacity: '0.6' },
  '.cm-num-stackdigit': { fontWeight: '600', color: 'var(--c-text-primary)' },
  // Landmark every ten lines: a 1px rule above the first digit of the decade.
  '.cm-num-decade': { boxShadow: 'inset 0 1px 0 0 var(--c-text-muted)' },
})

export function numberingGutter(mode: NumberingMode): Extension[] {
  if (mode === 'hidden') return []
  if (mode === 'normal') return [lineNumbers()]
  return [
    gutter({
      class: 'cm-smartGutter',
      lineMarker(view, line) {
        const ln = view.state.doc.lineAt(line.from).number
        return smartMarker(ln)
      },
      initialSpacer: () => new CharMarker('0', 'cm-num'),
    }),
    smartTheme,
  ]
}
