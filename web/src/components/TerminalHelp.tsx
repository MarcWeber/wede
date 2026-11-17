import type { ReactNode } from 'react'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-2 first:pt-0">
      <div className="text-text-primary font-semibold">{title}</div>
      <div className="mt-0.5 space-y-1">{children}</div>
    </section>
  )
}

function K({ children }: { children: ReactNode }) {
  return <span className="font-mono text-accent">{children}</span>
}

function KeyLine({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <span className="font-mono text-accent shrink-0 min-w-[52px]">{keys}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

export default function TerminalHelp() {
  return (
    <div data-testid="terminal-help" className="px-3 py-2 text-[11px] text-text-secondary leading-relaxed space-y-1">
      <div className="text-sm text-text-primary font-semibold pb-1">Terminal help</div>
      <p>
        A phone keyboard lacks many keys a terminal expects. Terminals also use
        mouse/scroll modes, signals and application-specific keys, so this
        terminal gives you a configurable button grid.
      </p>

      <Section title="What a terminal is for">
        <div>Launch programs, stop and resume them, send signals, complete paths, edit command lines, search history and scroll output.</div>
        <div><K>Ctrl-Z</K> stops a foreground program; <K>fg</K> resumes it. <K>Ctrl-C</K> interrupts it and often quits.</div>
      </Section>

      <Section title="Keys that usually work">
        <KeyLine keys="C-A / C-E">start / end of line</KeyLine>
        <KeyLine keys="C-U / C-K">delete to start / end of line</KeyLine>
        <KeyLine keys="C-R">search earlier commands</KeyLine>
        <KeyLine keys="C-P / C-N">previous / next command</KeyLine>
        <KeyLine keys="C-Q / C-S">stop / resume terminal output</KeyLine>
        <KeyLine keys="C-L">clear and redraw</KeyLine>
        <KeyLine keys="Esc-F / Esc-B">next / previous word</KeyLine>
        <KeyLine keys="PgUp / PgDn">scroll output (or use the wheel)</KeyLine>
        <KeyLine keys="/ and ?">search and help in many programs</KeyLine>
        <KeyLine keys="q">quit pagers such as less and man</KeyLine>
        <div><K>$NAME</K> is an environment variable; <K>~</K> means your home directory.</div>
        <div><K>F1</K>–<K>F12</K> and <K>Esc-…</K> can trigger application actions.</div>
      </Section>

      <Section title="Common programs">
        <div><K>less</K>: scroll with arrows/PgUp/PgDn, search with <K>/</K>, quit with <K>q</K>.</div>
        <div><K>man</K> / <K>info</K>: read documentation; quit with <K>q</K>.</div>
        <div><K>vim</K>, <K>emacs</K> and <K>opencode</K> have their own keys. The same key can do different things in different programs.</div>
        <div>For anything else try <K>man PROGRAM</K>, <K>info PROGRAM</K> or <K>PROGRAM --help</K>.</div>
      </Section>

      <Section title="Buttons and gestures">
        <div><span className="text-text-primary">Tap</span> a cell to run its <K>T</K> action.</div>
        <div><span className="text-text-primary">Swipe</span> in one of 8 directions to run that direction's action.</div>
        <div><span className="text-text-primary">Long-press</span> to show a radial menu with the assigned directions.</div>
        <div>Empty cells do nothing. Use the direction labels in the radial menu to see what is assigned.</div>
      </Section>

      <Section title="Default grid">
        <div>Settings (<K>=</K>) is the tap action on the default menu cell. Its swipes send <K>C-P</K>, <K>fg</K>, <K>C-L</K>, <K>C-C</K>, <K>Tab</K>, <K>C-N</K>, <K>C-Z</K> and <K>C-R</K>.</div>
        <div>The defaults also include single/two-finger swipe selectors, <K>F1</K>–<K>F12</K>, special characters, delete keys and arrow keys.</div>
        <div>Quick assignments: menu, special chars, Fx, F10-F12, delete keys, arrow keys, and single/two-finger swipe behavior.</div>
      </Section>

      <Section title="Assigning actions">
        <div>Open <K>configure behavior</K>, choose a cell, then a direction, then an action group: special actions, typed text, Fx, Ctrl combinations, Esc combinations or special characters.</div>
        <div>A settings action must remain on the grid. The app rejects a change (including JSON) that would remove the last settings action.</div>
        <div>Long-pressing a cell opens its radial menu. To assign actions, use <K>configure behavior</K>, choose a cell and a direction, then pick an action.</div>
      </Section>

      <Section title="Settings menu">
        <div><span className="text-text-primary">follow mode / margin</span>: choose the keyboard layout, then enable follow cursor separately. Margin keeps the cursor away from the edges.</div>
        <div><span className="text-text-primary">dock</span>: put the grid at the top or bottom; also toggles a transparent grid.</div>
        <div><span className="text-text-primary">font size / min columns / min rows</span>: change the terminal grid. Minimum size makes the terminal scroll instead of shrinking.</div>
        <div><span className="text-text-primary">single/two-finger swipe</span>: cursor movement, scroll events, PgUp/PgDn, Vim <K>C-U/C-D</K>, Emacs <K>C-V/M-V</K> or native scrollback.</div>
        <div><span className="text-text-primary">transparency / swipe step</span>: overlay opacity and pixels of swipe per arrow key.</div>
        <div><span className="text-text-primary">special keys / show more keys</span>: send keys that are hard to type; the menu closes after one key.</div>
        <div><span className="text-text-primary">menu config (JSON)</span>: copy, paste, download or load the whole grid as JSON.</div>
        <div><span className="text-text-primary">reset to defaults</span>: restore the default grid.</div>
      </Section>

      <Section title="Follow / shrink / zoom">
        <div><span className="text-text-primary">Off</span>: normal layout; no automatic scrolling.</div>
        <div><span className="text-text-primary">Follow cursor</span>: normal layout; scroll only when the cursor gets close to an edge.</div>
        <div><span className="text-text-primary">Shrink &amp; maximize</span>: reduce the terminal height above the software keyboard so the prompt stays visible.</div>
        <div><span className="text-text-primary">Zoom (distort)</span>: keep the row and column count and scale the terminal vertically into the space above the keyboard.</div>
        <div>Follow cursor is a separate toggle and works with every layout. It is what keeps the shell cursor visible; vim also keeps its own cursor visible.</div>
        <div><span className="text-text-primary">Maximize on keyboard</span>: expands the whole terminal panel to the viewport while the keyboard is open, then restores it. Works with every layout.</div>
        <div>Shrink, zoom and maximize depend on detecting the on-screen keyboard. Browser chrome changes and pinch zoom are ignored.</div>
      </Section>

      <Section title="If something looks wrong">
        <div>Open the <span className="text-text-primary">Log</span> tab and select <K>ui</K>. Reproduce the problem, then copy the lines. The UI log records keyboard open/close, viewport geometry and terminal resizing decisions.</div>
        <div>It is also available in the browser console as <K>window.wedeLog</K>. Use <K>window.clearWedeLog()</K> to reset it.</div>
        <div>If keys behave differently in a program, check that program's help; terminal applications intentionally disagree about many keys.</div>
      </Section>
    </div>
  )
}
