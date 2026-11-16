import { useEffect, useState } from 'react'
import { FolderOpen, Info, Minus, Plus, Check, User, ShieldCheck, Monitor } from 'lucide-react'
import TunnelSettings from './TunnelSettings'
import WedeLocation from './WedeLocation'
import type { AuthFetch, EditorSettings } from '../types'
import { Eye, EyeOff } from 'lucide-react'

interface TrustState {
  trusted: boolean
  hasProjectConfig: boolean
}

interface SettingsProps {
  visible: boolean
  onClose: () => void
  onOpenFolder: () => void
  workspace: string | null
  editorSettings: EditorSettings
  onEditorSettingsChange: (s: EditorSettings) => void
  lspAvailable: Record<string, boolean> | null
  authFetch: AuthFetch
  role: string
  workspaceId: string | null
  username: string
  onUsernameChange: (name: string) => void
  onTrustChange: () => void
  desktopMode: boolean
  onDesktopModeChange: (v: boolean) => void
  visibleTabTypes: Record<string, boolean> | null
  onVisibleTabTypesChange: (types: Record<string, boolean>) => void
}

export default function Settings({ visible, onClose, onOpenFolder, workspace, editorSettings, onEditorSettingsChange, lspAvailable, authFetch, role, workspaceId, username, onUsernameChange, onTrustChange, desktopMode, onDesktopModeChange, visibleTabTypes, onVisibleTabTypesChange }: SettingsProps) {
  const [name, setName] = useState(username || '')
  const [savedName, setSavedName] = useState(false)
  const saveName = () => {
    const v = name.trim()
    if (v && v !== username) { onUsernameChange?.(v); setSavedName(true); setTimeout(() => setSavedName(false), 1500) }
  }

  // Workspace trust — gates running formatters/tasks from the project's committed
  // .wede/ config (owner-only).
  const [trust, setTrust] = useState<TrustState | null>(null)
  useEffect(() => {
    if (!visible || role !== 'owner' || !authFetch) return
    authFetch('/api/trust').then((r) => r.json()).then(setTrust).catch(() => setTrust(null))
  }, [visible, role, authFetch, workspaceId])
  const toggleTrust = async (v: boolean) => {
    try {
      await authFetch('/api/trust', { method: v ? 'POST' : 'DELETE' })
      setTrust((t) => (t ? { ...t, trusted: v } : t))
      onTrustChange?.()
    } catch { /* ignore */ }
  }

  // Close on Escape.
  useEffect(() => {
    if (!visible) return undefined
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, onClose])

  if (!visible) return null

  const s = editorSettings || {}
  const fontSize  = s.fontSize  ?? 13
  const tabWidth  = s.tabWidth  ?? 2
  const wordWrap     = s.wordWrap     ?? false
  const autoSave     = s.autoSave     ?? true
  const minimap      = s.minimap      ?? false
  const lspOn        = s.lsp          ?? true
  const formatOnSave = s.formatOnSave ?? false
  const collab       = s.collab       ?? false
  const shareCursors = s.shareCursors ?? true
  const numbering    = s.numbering ?? 'smart'

  // Derive LSP status hint for the user.
  // lspAvailable: null = not yet fetched, {} = fetched (possibly empty), { go: '...' } = servers found
  const lspHint = (() => {
    if (lspAvailable === null) return null
    const names = Object.keys(lspAvailable)
    if (names.length === 0) return 'No language servers found on PATH. Install gopls, typescript-language-server, pylsp, etc. — or add any LSP server in ~/.wede/lsp.json.'
    return `Active for: ${names.join(', ')}. Add more in ~/.wede/lsp.json.`
  })()

  const update = (patch: Partial<EditorSettings>) => onEditorSettingsChange?.({ ...s, ...patch })

  return (
    <div className="h-full flex flex-col bg-bg-secondary overflow-y-auto">
      <div className="p-4 space-y-6">
        {/* Profile */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Profile</h3>
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary mb-1.5">
            <User className="w-3.5 h-3.5 text-text-muted" /> Display name
          </label>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveName() } }}
              placeholder="Your name"
              maxLength={40}
              className="flex-1 bg-bg-input border border-border rounded-md px-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 transition-colors"
            />
            <button
              onClick={saveName}
              disabled={!name.trim() || name.trim() === username}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {savedName ? <Check className="w-3.5 h-3.5" /> : null}
              {savedName ? 'Saved' : 'Save'}
            </button>
          </div>
          <p className="text-[11px] text-text-muted mt-1.5">Shown to collaborators in presence, chat, and live cursors.</p>
        </div>

        {/* Layout */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Layout</h3>
          <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
            <div className="flex items-start gap-2">
              <Monitor className="w-3.5 h-3.5 text-text-muted mt-0.5" />
              <div>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Desktop mode</span>
                <span className="block text-[10px] text-text-muted">Menu stays open on the left. Off = hamburger drawer.</span>
              </div>
            </div>
            <Toggle checked={desktopMode} onChange={onDesktopModeChange} />
          </label>
        </div>

        {/* Tab visibility */}
        {visibleTabTypes && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Tab visibility</h3>
            <p className="text-[10px] text-text-muted mb-2">Show or hide tab types in the menu. Controlled by workspace config.</p>
            <div className="space-y-1.5">
              {Object.entries(visibleTabTypes).map(([kind, shown]) => (
                <label key={kind} className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    {shown ? <Eye className="w-3.5 h-3.5 text-text-muted" /> : <EyeOff className="w-3.5 h-3.5 text-text-muted" />}
                    <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors capitalize">{kind}</span>
                  </div>
                  <Toggle checked={shown} onChange={(v) => {
                    const next = { ...visibleTabTypes, [kind]: v }
                    onVisibleTabTypesChange(next)
                  }} />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Editor settings */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Editor</h3>
          <div className="space-y-2">
            {/* Font size */}
            <div className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5">
              <span className="text-xs text-text-secondary">Font size</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => update({ fontSize: Math.max(10, fontSize - 1) })}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="text-xs font-mono text-text-primary w-6 text-center">{fontSize}</span>
                <button
                  onClick={() => update({ fontSize: Math.min(24, fontSize + 1) })}
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Tab width */}
            <div className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5">
              <span className="text-xs text-text-secondary">Tab width</span>
              <div className="flex items-center gap-1">
                {[2, 4, 8].map((n) => (
                  <button
                    key={n}
                    onClick={() => update({ tabWidth: n })}
                    className={`text-[11px] font-mono px-2 py-0.5 rounded transition-colors ${
                      tabWidth === n
                        ? 'bg-accent/15 text-accent border border-accent/30'
                        : 'text-text-muted hover:text-text-primary hover:bg-bg-hover border border-transparent'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Line numbers */}
            <div className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5">
              <div>
                <span className="text-xs text-text-secondary">Line numbers</span>
                <span className="block text-[10px] text-text-muted">Smart = one digit per line, bold 10s, 5s as markers</span>
              </div>
              <select
                value={numbering}
                onChange={(e) => update({ numbering: e.target.value as 'normal' | 'smart' | 'hidden' })}
                className="bg-bg-input border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="smart">Smart</option>
                <option value="normal">Show</option>
                <option value="hidden">Hide</option>
              </select>
            </div>

            {/* Word wrap */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Word wrap</span>
              <Toggle checked={wordWrap} onChange={(v) => update({ wordWrap: v })} />
            </label>

            {/* Auto-save */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <div>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Auto-save</span>
                <span className="block text-[10px] text-text-muted">1.5 s after last edit</span>
              </div>
              <Toggle checked={autoSave} onChange={(v) => update({ autoSave: v })} />
            </label>

            {/* Minimap */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Minimap</span>
              <Toggle checked={minimap} onChange={(v) => update({ minimap: v })} />
            </label>

            {/* Format on save */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <div>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Format on save</span>
                <span className="block text-[10px] text-text-muted">gofmt / prettier / black</span>
              </div>
              <Toggle checked={formatOnSave} onChange={(v) => update({ formatOnSave: v })} />
            </label>

            {/* LSP */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <div>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Language server (LSP)</span>
                <span className="block text-[10px] text-text-muted">Diagnostics &amp; hover</span>
              </div>
              <Toggle checked={lspOn} onChange={(v) => update({ lsp: v })} />
            </label>

            {/* LSP availability hint */}
            {lspHint && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-bg-primary border border-border">
                <Info className="w-3.5 h-3.5 text-text-muted shrink-0 mt-px" />
                <span className="text-[10px] text-text-muted leading-relaxed">{lspHint}</span>
              </div>
            )}

            {/* Collaborative editing */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <div>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Collaborative editing</span>
                <span className="block text-[10px] text-text-muted">Real-time multi-user editing for the active file (experimental)</span>
              </div>
              <Toggle checked={collab} onChange={(v) => update({ collab: v })} />
            </label>

            {/* Live cursors */}
            <label className="flex items-center justify-between bg-bg-primary border border-border rounded-lg px-3 py-2.5 cursor-pointer group">
              <div>
                <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">Show collaborators' cursors</span>
                <span className="block text-[10px] text-text-muted">See other users' live mouse pointers across the app</span>
              </div>
              <Toggle checked={shareCursors} onChange={(v) => update({ shareCursors: v })} />
            </label>
          </div>
        </div>

        {/* Workspace */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Workspace</h3>
          <div className="bg-bg-primary border border-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <FolderOpen className="w-4 h-4 text-yellow" />
              <span className="text-xs text-text-secondary font-mono truncate flex-1">
                {workspace || 'No folder open'}
              </span>
            </div>
            <button
              onClick={onOpenFolder}
              className="w-full text-xs py-2 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              Change Folder
            </button>
          </div>
        </div>

        {/* Workspace data location (owner only) */}
        {role === 'owner' && authFetch && workspaceId && (
          <div>
            <WedeLocation workspaceId={workspaceId} authFetch={authFetch} />
          </div>
        )}

        {/* Workspace trust (owner only) — run tools from this project's committed config */}
        {role === 'owner' && trust && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Workspace trust</h3>
            <label className={`flex items-center justify-between rounded-lg px-3 py-2.5 cursor-pointer group border ${
              trust.hasProjectConfig && !trust.trusted ? 'bg-yellow/5 border-yellow/30' : 'bg-bg-primary border-border'
            }`}>
              <div className="min-w-0 pr-3">
                <span className="flex items-center gap-1.5 text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                  <ShieldCheck className="w-3.5 h-3.5 text-text-muted" /> Trust this workspace
                </span>
                <span className="block text-[10px] text-text-muted mt-0.5 leading-relaxed">
                  {trust.hasProjectConfig
                    ? "Run formatters & tasks from this project's committed .wede/ config. Only trust workspaces you control — these commands run on your machine."
                    : 'No project tooling (.wede/lsp.json, formatters.json, tasks.json) committed yet.'}
                </span>
              </div>
              <Toggle checked={trust.trusted} onChange={(v) => { void toggleTrust(v) }} />
            </label>
          </div>
        )}

        {/* Public access (owner only) */}
        {role === 'owner' && authFetch && (
          <div>
            <TunnelSettings authFetch={authFetch} />
          </div>
        )}

        {/* Keyboard shortcuts */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Shortcuts</h3>
          <div className="space-y-1.5 text-xs">
            {[
              ['Command palette', 'Ctrl/Cmd + Shift + P'],
              ['Save file', 'Ctrl/Cmd + S'],
              ['Go to line', 'Ctrl + G'],
              ['Search in file', 'Ctrl/Cmd + F'],
              ['Workspace search', 'Ctrl/Cmd + Shift + F'],
              ['Close tab', 'Ctrl/Cmd + W'],
              ['Multi-cursor', 'Alt + Click'],
              ['Column select', 'Alt + Drag'],
            ].map(([action, keys]) => (
              <div key={action} className="flex items-center justify-between py-1.5 px-3 bg-bg-primary rounded-lg border border-border">
                <span className="text-text-secondary">{action}</span>
                <kbd className="text-[10px] font-mono text-text-muted bg-bg-hover px-1.5 py-0.5 rounded border border-border">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 shrink-0 cursor-pointer"
    />
  )
}
