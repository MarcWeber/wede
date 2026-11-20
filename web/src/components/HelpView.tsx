import { useBranding } from '../hooks/useBranding'
import { Item, KeyRows, List, P, Rows, Section } from './HelpBits'

export default function HelpView() {
  const branding = useBranding()

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-text-primary mb-1">How to use {branding}</h1>
        <div className="mb-7 space-y-2">
          <P>
            A web-based development platform. The most common alternative is VS Code as a
            website, but {branding} is optimized for AI, mobile use, and collaboration.
          </P>
          <P>One layout on desktop and mobile: the menu, the view tabs, and the content area.</P>
        </div>

        <Section title="Highlights">
          <List items={[
            'x-zoom shrinking',
            'Only tabs (for example code and coding agent)',
            'Teacher mode / follow others',
            <>
              <span className="text-text-primary font-medium">Mobile optimized terminal</span>
              <List className="mt-1" items={[
                'Scroll to cursor actions or scrolling',
                <>
                  Customize your own shortcuts (buttons with swipe actions)
                  <span className="block text-text-muted">Terminal &gt; settings buttons &gt; help for details</span>
                </>,
                'Shrink: y-shrink zoom or follow cursor when the keyboard takes up space',
              ]} />
            </>,
            'LSP support',
            'Brightness/contrast dark/light slider',
            'Tablet/desktop mode: move any window anywhere',
          ]} />
        </Section>

        <Section title="Collaborative features">
          <List items={[
            'Collaborative editing in files',
            'See cursors of others',
            'Teacher mode forces others to follow open files, cursor location and selection',
          ]} />
        </Section>

        <Section title="Tab types">
          <P className="mb-2">In the hamburger menu, swipe right to add a new tab for most types.</P>
          <List items={[
            <Item label="Files">directory tree; open files, long-press to open/rename/remove</Item>,
            <Item label="Search">search file contents and names</Item>,
            <Item label="Code">show/hide code file tabs</Item>,
            <Item label="Web view">show/hide embedded web views; many external sites disallow embedding</Item>,
            <Item label="Git">stage and commit files</Item>,
            <Item label="API">test APIs</Item>,
            <Item label="Settings">configure collaborative features, visible tabs, and x/y shrink</Item>,
            <Item label="Log">watch log files</Item>,
            <Item label="Help">this page; terminal help is under terminal &gt; settings &gt; help</Item>,
          ]} />
        </Section>

        <Section title="Files">
          <List items={[
            'Expand or close folders all at once',
            'Multi-select: long-press a file or folder, then choose lock, open, close, rename, or remove',
            'Click to open a file',
          ]} />
        </Section>

        <Section title="Search">
          <P>Search file names and file contents.</P>
        </Section>

        <Section title="Git">
          <P>Stage and commit files.</P>
        </Section>

        <Section title="Log">
          <P>Watch log files.</P>
        </Section>

        <Section title="Settings">
          <P>
            Choose which tabs appear in the menu, enable collaborative features, and set x/y
            shrink per orientation.
          </P>
        </Section>

        <Section title="Tabs">
          <List items={[
            'Click a tab type to show/hide all tabs of that type',
            'Swipe down to expand the strip and see all tabs; swipe up to return to one line',
            'Swipe a tab up-right to close it (locked tabs stay)',
            'Long-press a tab to enter select mode; long-press again or right-click for the menu',
            'On desktop you can make tabs float above or dock',
          ]} />
        </Section>

        <Section title="Selection mode">
          <List items={[
            'Long-press a tab, file, or search result to enter select mode',
            'Open, close, lock, or unlock the selected items',
            'Close also locked closes all tabs, including locked ones',
            'Locked tabs cannot be closed',
            'Close closes the current tab; Selected closes all selected tabs',
            'Long-press again or right-click to open the menu',
          ]} />
        </Section>

        <Section title="Desktop and mobile mode">
          <List items={[
            'Desktop: the hamburger menu is always open',
            'Desktop: middle click closes a window; right click opens its menu',
            'Mobile: open the hamburger menu; it closes automatically for some actions',
            'Tablet/desktop mode: drag a window to the side or center to get floating windows',
          ]} />
        </Section>

        <Section title="Mobile optimization">
          <Rows rows={[
            ['Tabs', 'Swipe up to hide/show all tabs. Swipe a tab up-right to close it (locked tabs stay).'],
            ['Tab strip', 'Swipe down to expand the strip; swipe up to return to one line.'],
            ['Keyboard layout', 'Terminal > settings > eye: Off, Follow cursor, Shrink & maximize, or Zoom (distort) when the keyboard opens.'],
            ['Terminal buttons', 'Terminal > settings > configure behavior: assign tap, swipe and long-press actions to each grid cell.'],
            ['1/2-finger swipe', 'Terminal > settings > single/two-finger swipe: cursor movement, PgUp/PgDn, Vim/Emacs paging, scroll events or native scrollback.'],
          ]} />
        </Section>

        <Section title="Shortcuts">
          <KeyRows rows={[
            ['Command palette', 'Ctrl/Cmd + Shift + P'],
            ['Quick open', 'Ctrl/Cmd + P'],
            ['Save file', 'Ctrl/Cmd + S'],
            ['Go to line', 'Ctrl + G'],
            ['Search in file', 'Ctrl/Cmd + F'],
            ['Workspace search', 'Ctrl/Cmd + Shift + F'],
            ['Close tab', 'Ctrl/Cmd + W'],
            ['Multi-cursor', 'Alt + Click'],
            ['Column select', 'Alt + Drag'],
          ]} />
        </Section>

        <Section title="Help">
          <P>This page. Terminal help: terminal &gt; settings &gt; help.</P>
        </Section>
      </div>
    </div>
  )
}
