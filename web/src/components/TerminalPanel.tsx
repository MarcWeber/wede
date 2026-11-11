import { useState } from 'react'
import { Plus, TerminalSquare, Maximize2, Minimize2, PictureInPicture2 } from 'lucide-react'
import Terminal from './Terminal'
import TerminalToolbar, { type TerminalInputDock } from './TerminalToolbar'
import Selectable, { SelectableGroup, type MenuEntry } from './Selectable'
import { TONE_WEAK, TONE_VAR } from '../lib/viewTypes'
import { useTheme } from '../hooks/useTheme'
import type { useTerminals } from '../hooks/useTerminals'

interface TerminalPanelProps {
  token: string | null | undefined
  workspaceId: string | null | undefined
  term: ReturnType<typeof useTerminals>
  visible: boolean
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  onPopOut?: () => void
  // When set, render only this terminal (it is a flat shell tab, so the tab
  // strip belongs to the container, not this panel).
  onlyId?: number
}

// TerminalPanel — the docked, tabbed terminal panel. Terminal state lives in the
// shared useTerminals hook (passed in as `term`) so it stays in sync with the
// floating window manager.
export default function TerminalPanel({ token, workspaceId, term, visible, isFullscreen, onToggleFullscreen, onPopOut, onlyId }: TerminalPanelProps) {
  const { terminalTheme } = useTheme()
  const { terminals, activeId, setActiveId, addTerminal, closeTerminal, closeSelected, setLocked, reorderTerminals, clearInitial, renameTerminal, autoNameTerminal, termRefs } = term
  const shown = onlyId != null ? terminals.filter((t) => t.id === onlyId) : terminals
  const currentActive = onlyId ?? activeId

  // Inline rename: double-click a tab to edit its name.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [inputDock, setInputDock] = useState<TerminalInputDock>(() => {
    try {
      const raw = localStorage.getItem('wede_terminal_input_dock')
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TerminalInputDock> & { hidden?: boolean }
        if (parsed.position === 'top' || parsed.position === 'bottom') {
          return {
            position: parsed.position,
            transparent: parsed.transparent ?? true,
            inputSend: parsed.inputSend ?? !parsed.hidden,
            more: parsed.more ?? false,
          }
        }
      }
    } catch { /* ignore */ }
    return { position: 'bottom', transparent: true, inputSend: true, more: false }
  })
  const updateDock = (next: TerminalInputDock) => {
    setInputDock(next)
    try { localStorage.setItem('wede_terminal_input_dock', JSON.stringify(next)) } catch { /* ignore */ }
  }
  const inputVisible = inputDock.inputSend || inputDock.more
  const docked = !inputDock.transparent && inputVisible
  const startRename = (t: { id: number; name: string }) => { setEditingId(t.id); setEditName(t.name) }
  const commitRename = () => { if (editingId != null) renameTerminal(editingId, editName); setEditingId(null) }
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const handleToolbarSend = (data: string) => {
    const ref = termRefs.current[currentActive]
    if (ref) ref.send(data)
  }

  if (!visible) return null

  return (
    <div className="h-full flex flex-col bg-bg-tertiary">
      {/* Terminal tab bar (hidden when this panel is a single flat tab) */}
      {onlyId == null && (
      <div className="flex items-center border-b border-border compact-touch shrink-0" style={{ height: 34 }}>
        <div className="flex items-center shrink-0 px-2.5 border-r border-border h-full">
          <TerminalSquare className="w-3.5 h-3.5 text-text-muted" />
        </div>

        <SelectableGroup className="flex items-center flex-1 min-w-0 overflow-x-auto h-full touch-pan-x" style={{ scrollbarWidth: 'none' }} selectedCount={selected.size} showMenuSelectMode onCancelSelection={() => setSelected(new Set())}>
          {terminals.map((t) => {
            const isActive = activeId === t.id
            const isChecked = selected.has(t.id)
            const targets = selected.size > 0 ? Array.from(selected) : [t.id]
            const allIds = terminals.map((x) => x.id)
            const menu: MenuEntry[] = [
              {
                key: 'closeSplit',
                kind: 'split',
                segments: [
                  { key: 'close', label: 'Close', onSelect: () => closeTerminal(t.id) },
                  { key: 'selected', label: 'Selected', tint: 'yellow', onSelect: () => closeSelected(targets, false) },
                  { key: 'all', label: 'All', onSelect: () => closeSelected(allIds, false) },
                  { key: 'locked', label: 'Locked', tint: 'red', onSelect: () => closeSelected(allIds, true) },
                ],
              },
              { key: 'sep1', kind: 'separator' },
              {
                key: 'lockSplit',
                kind: 'split',
                segments: [
                  { key: 'lock', label: 'Lock', onSelect: () => setLocked([t.id], true) },
                  { key: 'lockSel', label: 'Selected', tint: 'yellow', onSelect: () => setLocked(targets, true) },
                ],
              },
              {
                key: 'unlockSplit',
                kind: 'split',
                segments: [
                  { key: 'unlock', label: 'Unlock', onSelect: () => setLocked([t.id], false) },
                  { key: 'unlockSel', label: 'Selected', tint: 'yellow', onSelect: () => setLocked(targets, false) },
                ],
              },
            ]
            return (
              <Selectable
                key={t.id}
                checked={isChecked}
                locked={t.locked}
                onToggle={() => toggle(t.id)}
                onActivate={() => setActiveId(t.id)}
                onMiddleClick={() => closeTerminal(t.id)}
                menu={menu}
                label={`Select ${t.name}`}
                tone="green"
                dragId={String(t.id)}
                onReorder={(from, to) => reorderTerminals(Number(from), Number(to))}
                onDragAway={(id) => closeTerminal(Number(id))}
                className={`flex items-center gap-1.5 pl-1 pr-2 h-full min-w-[88px] text-[12px] font-medium border-r border-border shrink-0 cursor-pointer transition-colors ${TONE_WEAK.green} ${
                  isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
                }`}
              >
                {isActive && <span className="absolute top-0 left-0 right-0 h-[3px] z-10" style={{ backgroundColor: `var(${TONE_VAR.green})` }} />}
                {editingId === t.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="bg-bg-input border border-accent/50 rounded px-1 py-0.5 text-[12px] text-text-primary w-24 focus:outline-none focus:border-accent"
                  />
                ) : (
                  <span onDoubleClick={(e) => { e.stopPropagation(); startRename(t) }} title="Double-click to rename">{t.name}</span>
                )}
              </Selectable>
            )
          })}

          <button
            onClick={() => addTerminal()}
            className="flex items-center justify-center w-7 h-7 mx-1.5 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors shrink-0"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </SelectableGroup>

        {onPopOut && (
          <button
            onClick={onPopOut}
            className="p-1.5 mx-0.5 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors shrink-0"
            title="Open terminals as floating windows"
          >
            <PictureInPicture2 className="w-3.5 h-3.5" />
          </button>
        )}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="p-1.5 mx-1.5 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors shrink-0"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      )}

      {/* Terminal instances + input bar (floating overlay or docked). */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div className="relative flex-1 min-h-0">
          {shown.map((t) => (
            <Terminal
              key={t.id}
              ref={(r) => { if (r) termRefs.current[t.id] = r; else delete termRefs.current[t.id] }}
              token={token}
              workspaceId={workspaceId}
              sessionId={`term-${t.id}`}
              visible={currentActive === t.id && visible}
              terminalTheme={terminalTheme}
              initialCommand={t.initial}
              onInitialRun={() => clearInitial?.(t.id)}
              onTitle={(title) => autoNameTerminal(t.id, title)}
            />
          ))}
        </div>
        {inputVisible && (
          <TerminalToolbar onSend={handleToolbarSend} dock={inputDock} onDockChange={updateDock} docked={docked} />
        )}
        {!inputVisible && (
          <button
            onClick={() => updateDock({ ...inputDock, inputSend: true })}
            title="Show input"
            className={`absolute right-2 z-30 w-8 h-8 rounded-md border border-border bg-bg-secondary/90 text-[13px] font-bold text-text-secondary hover:text-text-primary active:bg-bg-active ${
              inputDock.position === 'top' ? 'top-2' : 'bottom-2'
            }`}
          >
            m
          </button>
        )}
      </div>
    </div>
  )
}
