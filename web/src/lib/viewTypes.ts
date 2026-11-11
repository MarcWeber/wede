// UI.txt type system: every view/tab has a type with one main colour.
// Weak = base tab tint, strong = selected item (30% background).

export type Tone = 'yellow' | 'cyan' | 'accent' | 'green' | 'peach' | 'pink' | 'mauve' | 'red'

// Where a flat tab sits inside its container (UI.txt TAB MENU → view modes).
// docked-* behave like CSS float (in-flow, not on top); `float` is the always
// floating overlay; `max` fills the window.
export type ViewMode =
  | 'center'
  | 'docked-left'
  | 'docked-right'
  | 'docked-bottom'
  | 'float'
  | 'max'

export const VIEW_MODES: { key: ViewMode; label: string }[] = [
  { key: 'docked-left', label: 'Docked left' },
  { key: 'docked-right', label: 'Docked right' },
  { key: 'docked-bottom', label: 'Docked bottom' },
  { key: 'center', label: 'Center' },
  { key: 'float', label: 'Float' },
  { key: 'max', label: 'Maximize' },
]

// T1…T9 plus the extra views the app already has (terminals, chat).
export const VIEW_TONES: Record<string, Tone> = {
  files: 'yellow',
  search: 'cyan',
  code: 'accent',
  web: 'cyan',
  terminals: 'green',
  git: 'red',
  chat: 'pink',
  api: 'mauve',
  settings: 'accent',
  log: 'green',
  help: 'cyan',
  container: 'peach',
}

export const TONE_VAR: Record<Tone, string> = {
  yellow: '--c-yellow',
  cyan: '--c-cyan',
  accent: '--c-accent',
  green: '--c-green',
  peach: '--c-peach',
  pink: '--c-pink',
  mauve: '--c-mauve',
  red: '--c-red',
}

export const TONE_WEAK: Record<Tone, string> = {
  yellow: 'bg-yellow/15',
  cyan: 'bg-cyan/15',
  accent: 'bg-accent/15',
  green: 'bg-green/15',
  peach: 'bg-peach/15',
  pink: 'bg-pink/15',
  mauve: 'bg-mauve/15',
  red: 'bg-red/15',
}

export const TONE_STRONG: Record<Tone, string> = {
  yellow: 'bg-yellow/30',
  cyan: 'bg-cyan/30',
  accent: 'bg-accent/30',
  green: 'bg-green/30',
  peach: 'bg-peach/30',
  pink: 'bg-pink/30',
  mauve: 'bg-mauve/30',
  red: 'bg-red/30',
}

export const TONE_TEXT: Record<Tone, string> = {
  yellow: 'text-yellow',
  cyan: 'text-cyan',
  accent: 'text-accent',
  green: 'text-green',
  peach: 'text-peach',
  pink: 'text-pink',
  mauve: 'text-mauve',
  red: 'text-red',
}

export const TONE_RING: Record<Tone, string> = {
  yellow: 'ring-yellow',
  cyan: 'ring-cyan',
  accent: 'ring-accent',
  green: 'ring-green',
  peach: 'ring-peach',
  pink: 'ring-pink',
  mauve: 'ring-mauve',
  red: 'ring-red',
}

export function toneForView(kind: string): Tone {
  return VIEW_TONES[kind] || 'yellow'
}

export function toneForTab(tab: { type?: string }): Tone {
  switch (tab.type) {
    case 'browser': return 'cyan'
    case 'gitgraph': return 'red'
    case 'apiclient': return 'mauve'
    default: return 'accent'
  }
}
