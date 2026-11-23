import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, FolderOpen, Lock, LogOut, User } from 'lucide-react'
import Logo from './Logo'
import type { WorkspaceSummary, WorkspaceTemplate } from '../types'
import { useBranding } from '../hooks/useBranding'

interface LoginProps {
  onLogin: (password: string, name?: string) => Promise<boolean>
  error: string | null
  remaining?: number
  authenticated?: boolean
  username?: string
  sessions?: WorkspaceSummary[]
  templates?: WorkspaceTemplate[]
  sessionsLoading?: boolean
  onJoinSession?: (id: string) => void
  onCreateSession?: (template: string, name: string) => Promise<unknown>
  onLogout?: () => void
}

function ageLabel(secs: number | undefined): string {
  const s = Math.max(0, Math.floor(secs || 0))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function sessionLabel(s: WorkspaceSummary): string {
  const users = s.users ?? 0
  const bits = [`${users} user${users === 1 ? '' : 's'}`, ageLabel(s.age_secs)]
  const prefix = s.template && s.template !== s.name ? `${s.template}:` : ''
  return `${prefix}${s.name} (${bits.join(' | ')})`
}

export default function Login({
  onLogin, error, remaining, authenticated = false, username = '',
  sessions = [], templates = [], sessionsLoading = false,
  onJoinSession, onCreateSession, onLogout,
}: LoginProps) {
  const branding = useBranding()
  const [password, setPassword] = useState('')
  const [name, setName] = useState(() => sessionStorage.getItem('wede_username') || '')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const options = useMemo(() => {
    const list: string[] = []
    for (const s of sessions) list.push(`s:${s.id}`)
    for (const t of templates) list.push(`t:${t.name}`)
    return list
  }, [sessions, templates])

  useEffect(() => {
    if (!authenticated || options.length === 0) return
    if (!options.includes(choice)) setChoice(options[0])
  }, [authenticated, options, choice])

  const selectedTemplate = choice.startsWith('t:') ? choice.slice(2) : ''
  useEffect(() => {
    if (selectedTemplate) setSessionName(selectedTemplate)
  }, [selectedTemplate])

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    await onLogin(password, name.trim())
    setLoading(false)
    setPassword('')
  }

  const handleJoin = async () => {
    setWorkspaceError(null)
    if (choice.startsWith('s:')) {
      onJoinSession?.(choice.slice(2))
      return
    }
    if (choice.startsWith('t:')) {
      if (!onCreateSession) return
      setLoading(true)
      try {
        await onCreateSession(choice.slice(2), sessionName.trim())
      } catch (err) {
        setWorkspaceError(err instanceof Error ? err.message : 'Could not create session')
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-xs animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-bg-elevated border border-border mb-4 shadow-lg shadow-shadow overflow-hidden">
            <Logo size={36} />
          </div>
          <h1 className="text-xl font-semibold text-text-primary tracking-tight">{branding}</h1>
          <p className="text-text-muted text-[13px] mt-0.5">Web Development Environment</p>
        </div>

        <form
          onSubmit={(e) => { if (authenticated) { e.preventDefault(); void handleJoin() } else void handleLogin(e) }}
          className="bg-bg-elevated border border-border rounded-xl p-6 shadow-xl shadow-shadow"
        >
          {authenticated ? (
            <>
              <div className="mb-4">
                <div className="text-[12px] font-semibold text-text-secondary uppercase tracking-widest mb-1.5">
                  Choose workspace
                </div>
                <p className="text-text-muted text-[11px] mb-2">Signed in as {username || 'user'}</p>
                {sessionsLoading ? (
                  <div className="text-text-muted text-[12px] py-2">Loading workspaces…</div>
                ) : options.length === 0 ? (
                  <div className="text-text-muted text-[12px] py-2">No workspaces configured.</div>
                ) : (
                  <>
                    <div className="relative">
                      <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                      <select
                        value={choice}
                        onChange={(e) => { setChoice(e.target.value); setWorkspaceError(null) }}
                        className="w-full bg-bg-input border border-border rounded-md pl-9 pr-3 py-2.5 text-[13px] text-text-primary focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/15 transition-colors"
                        disabled={loading}
                      >
                        {sessions.length > 0 && (
                          <optgroup label="Active sessions">
                            {sessions.map((s) => (
                              <option key={`s:${s.id}`} value={`s:${s.id}`}>{sessionLabel(s)}</option>
                            ))}
                          </optgroup>
                        )}
                        {templates.length > 0 && (
                          <optgroup label="New session">
                            {templates.map((t) => (
                              <option key={`t:${t.name}`} value={`t:${t.name}`}>{t.name} (new)</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                    {selectedTemplate && (
                      <div className="mt-3">
                        <label className="block text-[11px] font-semibold text-text-secondary mb-1 uppercase tracking-widest">
                          Session name
                        </label>
                        <input
                          type="text"
                          value={sessionName}
                          onChange={(e) => setSessionName(e.target.value)}
                          className="w-full bg-bg-input border border-border rounded-md px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/15 transition-colors"
                          placeholder={selectedTemplate}
                          maxLength={48}
                          disabled={loading}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {workspaceError && (
                <div className="mb-4 px-3 py-2.5 bg-red/8 border border-red/20 rounded-md text-red text-[12px]">
                  {workspaceError}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || options.length === 0}
                className="w-full bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold py-2.5 rounded-md transition-all shadow-sm shadow-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Joining…' : 'Join'}
              </button>

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 text-text-muted hover:text-text-secondary text-[11px] py-1"
                >
                  <LogOut className="w-3 h-3" /> Use another account
                </button>
              )}
            </>
          ) : (
            <>
              <div className="mb-4">
                <label className="block text-[12px] font-semibold text-text-secondary mb-1.5 uppercase tracking-widest">
                  Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md pl-9 pr-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/15 transition-colors"
                    placeholder="Your name"
                    maxLength={32}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[12px] font-semibold text-text-secondary mb-1.5 uppercase tracking-widest">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-bg-input border border-border rounded-md pl-9 pr-9 py-2.5 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/15 transition-colors"
                    placeholder="Enter password"
                    autoFocus
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2.5 bg-red/8 border border-red/20 rounded-md text-red text-[12px]">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold py-2.5 rounded-md transition-all shadow-sm shadow-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>

              {remaining !== undefined && (
                <p className="mt-3 text-center text-text-muted text-[11px]">
                  {remaining} attempt{remaining !== 1 ? 's' : ''} remaining
                </p>
              )}
            </>
          )}
        </form>
      </div>
    </div>
  )
}
