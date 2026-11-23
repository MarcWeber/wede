export default function HelpView() {
  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <pre className="text-sm whitespace-pre-wrap font-mono text-text-primary">{`

HOW TO USE WEB-DEVELOPMENT IDE

vscode isn't optimized for mobile phones. Today we need terminal, code editor
tab for review. that's it.

Highlights
  - Only tabs (for example code and coding agent)
  - Teacher mode / follow others
  - Mobile optimized terminal
      y-zoom x-zoom shrinking
      Scroll to cursor actions or scrolling
      Customize your own shortcuts (buttons with swipe actions)
        Terminal > settings buttons > help for details
      Shrink: y-shrink zoom or follow cursor when the keyboard takes up space
  - LSP support
  - Brightness/contrast dark/light slider
  - Tablet/desktop mode: move any window anywhere

Collaborative features
  - Collaborative editing in files
  - See cursors of others
  - Teacher mode forces others to follow open files, cursor location and selection

Tab types
  In the hamburger menu, swipe right to add a new tab for most types.
  Swipe files or search left to see every tab other people have open.

Files
  - Expand or close folders all at once
  - Multi-select: long-press a file or folder, then choose lock, open, close, rename, or remove
  - Click to open a file

Search
  Search file names and file contents.

Git
  Stage and commit files.

Log
  Watch log files.

Settings
  Choose which tabs appear in the menu, enable collaborative features,
  and set x/y shrink per orientation.

Tabs
  - Click a tab type to show/hide all tabs of that type
  - Drag or swipe left/right to scroll the strip
  - Swipe a tab up to expand/collapse the strip; swipe down for its menu
  - Swipe a tab to the top-right to close it (locked tabs stay)
  - Labels appear while dragging so the gesture is visible near the screen centre
  - Long-press a tab to enter select mode; long-press again or right-click for the menu
  - On desktop you can make tabs float above or dock

Selection mode
  - Long-press a tab, file, or search result to enter select mode
  - Open, close, lock, or unlock the selected items
  - Close also locked closes all tabs, including locked ones
  - Locked tabs cannot be closed
  - Close closes the current tab; Selected closes all selected tabs
  - Long-press again or right-click to open the menu

Desktop and mobile mode
  - Desktop: the hamburger menu is always open
  - Desktop: middle click closes a window; right click opens its menu
  - Mobile: open the hamburger menu; it closes automatically for some actions
  - Tablet/desktop mode: drag a window to the side or center to get floating windows

Mobile optimization
  Tabs:
    Swipe left/right to scroll. Swipe up to expand/collapse; swipe down for the menu;
    swipe top-right to close (locked tabs stay).
  Tab strip:
    Action labels are pulled toward the middle of the screen so your finger does not hide them.
  Keyboard layout:
    Terminal > settings > eye: Off, Follow cursor, Shrink & maximize, or Zoom (distort)
    when the keyboard opens.
  Terminal buttons:
    Terminal > settings > configure behavior: assign tap, swipe and long-press actions
    to each grid cell.
  1/2-finger swipe:
    Terminal > settings > single/two-finger swipe: cursor movement, PgUp/PgDn,
    Vim/Emacs paging, scroll events or native scrollback.

Voice to text:
google gboard keyboard for android allows to voice type (never
give private data to that!)

Glossary
  #collab: opening scroll cursor location following etc implemented
  Files:        directory tree; open files, long-press to open/rename/remove
  Search:       search file contents and names
  Code:         show/hide code file tabs #collab
  Web view:     show/hide embedded web views; many external sites disallow embedding
  Git:          stage and commit files
  API:          test APIs
  Settings:     configure collaborative features, visible tabs, and x/y shrink
  Session tabs: list this view's tabs (including hidden) and other people's tab views;
                join one or open its files here
  Log:          watch log files
  Help:         this page; terminal help is under terminal > settings > help

Shortcuts
  Command palette     Ctrl/Cmd + Shift + P
  Quick open          Ctrl/Cmd + P
  Save file           Ctrl/Cmd + S
  Go to line          Ctrl + G
  Search in file      Ctrl/Cmd + F
  Workspace search    Ctrl/Cmd + Shift + F
  Close tab           Ctrl/Cmd + W
  Multi-cursor        Alt + Click
  Column select       Alt + Drag

Help
  This page. Terminal help: terminal > settings > help.

Workspaces, Session

  workspace: controls who can login, base directory and settings
  workspace:session_name
        The session_name's default is the workspace. It controls who can collaborate
        on open files and follow each other. Join same session_name to collaborate
        in a group.
        directory -> what base directory to show

  A session controls what terminals eg are open (server state)
  If a session is closed, the terminals are closed and the shared
  session state is lost. Thus close below closes the state

  workspace:session_name:directory
  -> when clicked show submenu
      submenu:
      -> switch
      -> close & switch
      -> close & logout
  --------
  Logout (does not close)


`}</pre>
      </div>
    </div>
  )
}
