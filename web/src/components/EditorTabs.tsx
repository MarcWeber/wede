import { useState } from 'react'
import { Globe } from 'lucide-react'
import type { Tab } from '../types'
import Selectable, { type MenuEntry } from './Selectable'

export interface EditorTabsProps {
  tabs: Tab[]
  activeTab: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onCloseSelected: (paths: string[], includeLocked: boolean) => void
  onSetLocked: (paths: string[], locked: boolean) => void
}

export default function EditorTabs({ tabs, activeTab, onSelect, onClose, onCloseSelected, onSetLocked }: EditorTabsProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (tabs.length === 0) return null

  const toggle = (path: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  return (
    <div className="flex bg-bg-secondary border-b border-border overflow-x-auto shrink-0 compact-touch" style={{ scrollbarWidth: 'none' }}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.path
        const isBrowser = tab.type === 'browser'
        const isChecked = selected.has(tab.path)
        const targets = selected.size > 0 ? Array.from(selected) : [tab.path]
        const allTargets = tabs.map((t) => t.path)
        const menu: MenuEntry[] = [
          {
            key: 'closeSplit',
            kind: 'split',
            segments: [
              { key: 'close', label: 'Close', onSelect: () => onClose(tab.path) },
              { key: 'selected', label: 'Selected', tint: 'yellow', onSelect: () => onCloseSelected(targets, false) },
              { key: 'all', label: 'All', onSelect: () => onCloseSelected(allTargets, false) },
              { key: 'locked', label: 'Locked', tint: 'red', onSelect: () => onCloseSelected(allTargets, true) },
            ],
          },
          { key: 'sep1', kind: 'separator' },
          {
            key: 'lockSplit',
            kind: 'split',
            segments: [
              { key: 'lock', label: 'Lock', onSelect: () => onSetLocked([tab.path], true) },
              { key: 'lockSel', label: 'Selected', tint: 'yellow', onSelect: () => onSetLocked(targets, true) },
            ],
          },
          {
            key: 'unlockSplit',
            kind: 'split',
            segments: [
              { key: 'unlock', label: 'Unlock', onSelect: () => onSetLocked([tab.path], false) },
              { key: 'unlockSel', label: 'Selected', tint: 'yellow', onSelect: () => onSetLocked(targets, false) },
            ],
          },
        ]
        return (
          <Selectable
            key={tab.path}
            checked={isChecked}
            locked={tab.locked}
            onToggle={() => toggle(tab.path)}
            onActivate={() => onSelect(tab.path)}
            menu={menu}
            label={`Select ${tab.name}`}
            className={`flex items-center gap-1.5 pl-1 pr-2 h-10 min-w-[88px] border-r border-border shrink-0 select-none cursor-pointer transition-colors ${
              isActive
                ? 'bg-bg-primary text-text-primary'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {isActive && (
              <span className="absolute top-0 left-0 right-0 h-[1.5px] bg-accent rounded-b z-10" />
            )}
            {isBrowser && <Globe className="w-3 h-3 text-cyan shrink-0" />}
            {!isBrowser && tab.modified && (
              <span className="w-1.5 h-1.5 rounded-full bg-yellow shrink-0" />
            )}
            <span className={`text-[12px] truncate max-w-40 font-medium leading-none ${
              tab.preview && !tab.modified ? 'italic' : ''
            }`}>{tab.name}</span>
          </Selectable>
        )
      })}
    </div>
  )
}
