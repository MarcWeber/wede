import { useState, type ReactNode } from 'react'
import {
  X, LogOut, FolderOpen, Moon, Sun, Monitor, Users,
  LayoutPanelLeft, ChevronDown, ChevronRight, RotateCcw,
  Eye, Radio, Scaling,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useRowMenu } from './Selectable'
import type { ViewTab } from './ViewTabs'
import { TONE_STRONG, TONE_TEXT, TONE_WEAK, toneForView } from '../lib/viewTypes'
import { useTheme, type ThemeLevel } from '../hooks/useTheme'

export type MenuPlacement =
  | 'left-icons'
  | 'left-icons-and-text'
  | 'bottom-icons'
  | 'left-of-tabs'
  | 'right-of-tabs'

interface MenuRowProps {
  kind?: string
  icon: LucideIcon
  label: string
  checked: boolean
  onToggle: () => void
  onSwipeRight?: () => void
  hint?: string
  slim?: boolean
  disabled?: boolean
}

// One menu row: icon + label. The whole row toggles visibility. Rows that can
// have multiple instances (web, terminals, API) also add one on a right swipe.
function MenuRow({ kind, icon: Icon, label, checked, onToggle, onSwipeRight, hint, slim, disabled }: MenuRowProps) {
  const { bind, consumeSwipe } = useRowMenu(
    [], onSwipeRight ? { swipe: 'right', onSwipe: onSwipeRight } : {},
  )
  const tone = toneForView(kind || 'files')
  return (
    <div
      {...bind}
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      aria-label={label}
      title={slim ? label : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (disabled || consumeSwipe()) return; onToggle() }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
      }}
      className={`flex items-center gap-2.5 h-9 cursor-pointer select-none border-l-2 transition-colors ${slim ? 'justify-center px-0' : 'pl-2.5 pr-3'} ${
        disabled ? 'opacity-45 cursor-not-allowed' : ''
      } ${
        kind ? TONE_WEAK[tone] : ''
      } ${
        checked
          ? `${TONE_STRONG[tone]} ${TONE_TEXT[tone]} border-current`
          : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-bg-hover'
      }`}
      style={{ touchAction: onSwipeRight ? 'pan-y' : undefined }}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${checked ? '' : 'text-text-muted'}`} />
      {!slim && <span className="text-[12px] font-medium truncate">{label}</span>}
      {!slim && hint && <span className={`ml-auto text-[10px] shrink-0 ${checked ? 'opacity-60' : 'text-text-muted'}`}>{hint}</span>}
    </div>
  )
}

interface SectionRowProps {
  icon: LucideIcon
  label: string
  expanded: boolean
  onClick: () => void
  onSwipeRight?: () => void
  slim?: boolean
}

function SectionRow({ icon: Icon, label, expanded, onClick, onSwipeRight, slim }: SectionRowProps) {
  const { bind, consumeSwipe } = useRowMenu(
    [], onSwipeRight ? { swipe: 'right', onSwipe: onSwipeRight } : {},
  )
  return (
    <div
      {...bind}
      role="menuitem"
      aria-label={label}
      title={slim ? label : undefined}
      tabIndex={0}
      onClick={() => { if (consumeSwipe()) return; onClick() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      }}
      className={`flex items-center gap-2.5 h-9 cursor-pointer select-none text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors ${slim ? 'justify-center px-0' : 'pl-2.5 pr-3'}`}
      style={{ touchAction: onSwipeRight ? 'pan-y' : undefined }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
      {!slim && <span className="text-[12px] font-medium truncate">{label}</span>}
      {!slim && (expanded ? <ChevronDown className="w-3 h-3 ml-auto text-text-muted" /> : <ChevronRight className="w-3 h-3 ml-auto text-text-muted" />)}
    </div>
  )
}

const PLACEMENTS: { key: MenuPlacement; label: string }[] = [
  { key: 'left-icons', label: 'Left icons' },
  { key: 'left-icons-and-text', label: 'Left icons + text' },
  { key: 'bottom-icons', label: 'Bottom icons' },
  { key: 'left-of-tabs', label: 'Left of tabs' },
  { key: 'right-of-tabs', label: 'Right of tabs' },
]

function ThemeLevelRow({ slim }: { slim: boolean }) {
  const { level, setLevel } = useTheme()
  return (
    <div
      className={`border-l-2 border-transparent ${slim ? 'px-1 py-1.5' : 'px-2.5 py-2'}`}
      title={`Theme level ${level} / 6 — 1–3 light, 4–6 dark`}
    >
      <div className={slim ? 'flex flex-col items-center gap-1' : 'flex items-center gap-2'}>
        <Moon className={`${slim ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 text-text-muted`} />
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={7 - level}
          onChange={(e) => setLevel((7 - Number(e.target.value)) as ThemeLevel)}
          className={`${slim ? 'w-full' : 'flex-1'} accent-accent cursor-pointer`}
          aria-label="Theme brightness and contrast"
        />
        <Sun className={`${slim ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 text-text-muted`} />
      </div>
    </div>
  )
}

export interface ViewMenuProps {
  views: ViewTab[]
  visible: Record<string, boolean>
  onToggle: (kind: string) => void
  onAdd: (kind: string) => void
  onOpenFolder: () => void
  onLogout: () => void
  onClose?: () => void
  desktop: boolean
  folderName: string
  workspaceSwitcher?: ReactNode
  onToggleDesktop: () => void
  uiScaleIsSet: boolean
  uiScaleEnabled: boolean
  onToggleUiScale: () => void
  placement: MenuPlacement
  onPlacement: (p: MenuPlacement) => void
  onResetView: () => void
  username: string
  users: { id: string; username?: string; line?: number }[]
  selfId?: string | null
  teacher?: boolean
  presenter?: { id: string; username: string } | null
  followTargetId?: string | null
  followMode?: 'open' | 'live' | null
  onFollow?: (id: string, mode: 'open' | 'live') => void
  onUnfollow?: () => void
  onLeadChange?: (on: boolean) => void
}

// ViewMenu — the app menu. On desktop it is a persistent column attached to the
// left; on mobile it opens as a left drawer. It is the only place that shows or
// hides a tab type, adds instances, and changes global options.
export default function ViewMenu({
  views, visible, onToggle, onAdd, onOpenFolder,
  onLogout, onClose, desktop, folderName, workspaceSwitcher,
  onToggleDesktop, uiScaleIsSet, uiScaleEnabled, onToggleUiScale, placement, onPlacement,
  onResetView, username, users,
  selfId, teacher = false, presenter = null,
  followTargetId = null, followMode = null,
  onFollow, onUnfollow, onLeadChange,
}: ViewMenuProps) {
  const [showPlacement, setShowPlacement] = useState(false)
  const [followMenuId, setFollowMenuId] = useState<string | null>(null)
  const slim = desktop && (placement === 'left-icons' || placement === 'bottom-icons')
  const isSelf = (u: { id: string; username?: string }) =>
    selfId ? u.id === selfId : (u.username || '') === username
  const selfMember = users.find(isSelf)
  const others = users.filter((u) => !isSelf(u))
  const selfName = selfMember?.username || username || 'anon'
  const isLeading = !!presenter && isSelf({ id: presenter.id, username: presenter.username })
  const leadBlocked = !!presenter && !isLeading

  const body = (
    <>
      <nav className="flex-1 min-h-0 overflow-y-auto py-1" role="menu">
        {views.map((view) => (
          <MenuRow
            key={view.kind}
            kind={view.kind}
            icon={view.icon}
            label={view.label}
            checked={!!visible[view.kind]}
            onToggle={() => onToggle(view.kind)}
            onSwipeRight={
              view.kind === 'files' || view.kind === 'web' || view.kind === 'terminals' || view.kind === 'api' || view.kind === 'search' || view.kind === 'log'
                ? () => onAdd(view.kind)
                : undefined
            }
            hint={
              view.kind === 'files' || view.kind === 'web' || view.kind === 'terminals' || view.kind === 'api' || view.kind === 'search' || view.kind === 'log' ? 'swipe → add'
                : view.kind === 'settings' || view.kind === 'help' ? 'show' : undefined
            }
            slim={slim}
          />
        ))}

        <div className="my-1 border-t border-border" />

        {!slim && <ThemeLevelRow slim={false} />}
        {uiScaleIsSet && (
          <MenuRow
            icon={Scaling}
            label="UI scale active"
            checked={uiScaleEnabled}
            onToggle={onToggleUiScale}
            slim={slim}
          />
        )}
        <MenuRow
          icon={Monitor}
          label="Desktop mode"
          checked={desktop}
          onToggle={onToggleDesktop}
          slim={slim}
        />

        <div className="my-1 border-t border-border" />

        {teacher && (
          <>
            <MenuRow
              icon={Radio}
              label="Lead the rest"
              checked={isLeading}
              disabled={leadBlocked}
              hint={leadBlocked ? `${presenter?.username || 'Someone'} leads` : isLeading ? 'forced' : undefined}
              onToggle={() => onLeadChange?.(!isLeading)}
              slim={slim}
            />
            <div className="my-1 border-t border-border" />
          </>
        )}

        {slim ? (
          <div
            className="flex justify-center py-2"
            title={[`${selfName} (you)`, ...others.map((u) => `${u.username || u.id}${presenter?.id === u.id ? ' (leading)' : ''}`)].join('\n')}
          >
            <Users className="w-3.5 h-3.5 text-text-muted" />
          </div>
        ) : (
          <div className="px-2.5 py-1.5">
            <div className="flex items-center gap-2.5 h-7 text-text-secondary">
              <Users className="w-3.5 h-3.5 shrink-0 text-text-muted" />
              <span className="text-[12px] font-medium">Users</span>
            </div>
            <div className="pl-6 space-y-1">
              <div className="text-[11px] text-text-secondary truncate flex items-center gap-1">
                <span className={isLeading ? 'font-semibold text-text-primary' : ''}>{selfName}</span>
                <span className="text-text-muted">(you)</span>
                {isLeading && <Radio className="w-3 h-3 text-accent shrink-0" aria-label="Leading" />}
              </div>
              {others.map((u) => {
                const presenting = presenter?.id === u.id
                const following = followTargetId === u.id
                const mode = presenting ? 'live' : following ? followMode : null
                return (
                  <div key={u.id}>
                    <button
                      type="button"
                      onClick={() => setFollowMenuId((cur) => (cur === u.id ? null : u.id))}
                      title="Follow this user"
                      className="w-full flex items-center gap-1.5 text-left text-[11px] text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <span className={`truncate ${mode ? 'font-semibold text-text-primary' : ''}`}>
                        {u.username || u.id}
                      </span>
                      {presenting && <span className="text-[9px] uppercase tracking-wide text-accent shrink-0">leading</span>}
                      {mode === 'open' && <Eye className="w-3 h-3 text-accent shrink-0" aria-label="Following open" />}
                      {mode === 'live' && <Radio className="w-3 h-3 text-accent shrink-0" aria-label="Following live" />}
                    </button>
                    {followMenuId === u.id && (
                      <div role="menu" className="mt-1 mb-1 rounded-md border border-border bg-bg-primary p-1 space-y-0.5 shadow-sm">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { onFollow?.(u.id, 'open'); setFollowMenuId(null) }}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                        >
                          <Eye className="w-3 h-3 shrink-0" /> Follow open
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { onFollow?.(u.id, 'live'); setFollowMenuId(null) }}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                        >
                          <Radio className="w-3 h-3 shrink-0" /> Follow live
                        </button>
                        {following && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { onUnfollow?.(); setFollowMenuId(null) }}
                            className="w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] text-text-secondary hover:text-red hover:bg-bg-hover"
                          >
                            <X className="w-3 h-3 shrink-0" /> Stop following
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {others.length === 0 && <div className="text-[10px] text-text-muted">No other users yet</div>}
            </div>
          </div>
        )}

        {slim ? (
          <SectionRow
            icon={LayoutPanelLeft}
            label="Menu placement"
            expanded={false}
            onClick={() => {
              const i = PLACEMENTS.findIndex((p) => p.key === placement)
              onPlacement(PLACEMENTS[(i + 1) % PLACEMENTS.length].key)
            }}
            slim
          />
        ) : (
          <>
            <SectionRow icon={LayoutPanelLeft} label="Container menu placement" expanded={showPlacement} onClick={() => setShowPlacement((v) => !v)} />
            {showPlacement && (
              <div className="pl-3 pr-2 pb-1.5">
                {PLACEMENTS.map((p) => (
                  <button key={p.key} onClick={() => onPlacement(p.key)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] transition-colors ${
                      placement === p.key ? 'bg-accent/30 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${placement === p.key ? 'bg-accent' : 'border border-text-muted'}`} />
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="my-1 border-t border-border" />
        <button
          onClick={onResetView}
          role="menuitem"
          title="Reset view — close all tabs and restore the default layout"
          className={`w-full flex items-center gap-2.5 h-9 text-text-secondary hover:text-red hover:bg-bg-hover transition-colors ${slim ? 'justify-center px-0' : 'px-3'}`}>
          <RotateCcw className="w-3.5 h-3.5 shrink-0" /> {!slim && 'Reset view'}
        </button>
        {/* Footer lives inside the scroll area so it never steals height in
            portrait mode. */}
        <div className="mt-1 border-t border-border py-1">
          {!slim && (
            <div className="px-2 pb-1">
              <button onClick={onOpenFolder}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                title="Open Folder (change workspace)">
                <FolderOpen className="w-3.5 h-3.5 text-yellow shrink-0" />
                <span className="truncate font-medium">{folderName}</span>
              </button>
              {workspaceSwitcher && <div className="mt-1">{workspaceSwitcher}</div>}
            </div>
          )}
          <button onClick={onLogout}
            title="Logout"
            className={`w-full flex items-center gap-2.5 h-9 text-[12px] text-text-secondary hover:text-red hover:bg-bg-hover transition-colors ${slim ? 'justify-center px-0' : 'px-3'}`}>
            <LogOut className="w-3.5 h-3.5 shrink-0" /> {!slim && 'Logout'}
          </button>
        </div>
      </nav>
    </>
  )

  if (desktop) {
    return (
      <aside className={`${slim ? 'w-14' : 'w-56'} shrink-0 h-full flex flex-col bg-bg-tertiary border-r border-border select-none`}>
        {body}
      </aside>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <aside className="relative w-64 h-full flex flex-col bg-bg-tertiary border-r border-border select-none animate-fade-in"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}
          className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover bg-bg-tertiary/80"
          title="Close menu">
          <X className="w-4 h-4" />
        </button>
        {body}
      </aside>
    </div>
  )
}
