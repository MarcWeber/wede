import { useState, useCallback, useEffect } from 'react'
import { apiBase } from '../api'
import { scopedUrl } from '../lib/activeWorkspace'
import type { AuthFetch } from '../types'

interface AuthCheckResponse {
  authenticated?: boolean
  role?: string
  teacher?: boolean
  locked?: boolean
  userCount?: number
  debug?: boolean
}

interface LoginResponse {
  // (string & {}) rather than plain `string`: keeps 'locked' / 'wrong_password'
  // as autocomplete/documentation hints for the known server values without
  // TS collapsing the union to bare `string` (which no-redundant-type-constituents
  // flags, since a plain `string` member does make the literals redundant).
  error?: 'locked' | 'wrong_password' | (string & {})
  message?: string
  remaining?: number
  token?: string
  username?: string
  role?: string
  teacher?: boolean
}

interface RedeemResponse {
  token?: string
  username?: string
  role?: string
  teacher?: boolean
}

interface AnonymousLoginResponse {
  error?: string
  token?: string
  username?: string
  role?: string
  session?: { id?: string }
}

const AUTH_STORAGE_KEYS = ['wede_token', 'wede_username', 'wede_role', 'wede_teacher'] as const
const GUEST_STORAGE_KEYS = ['wede_guest_token', 'wede_guest_role', 'wede_guest_workspace'] as const
type AuthStorageKey = (typeof AUTH_STORAGE_KEYS)[number]

function readGuestValue(key: (typeof GUEST_STORAGE_KEYS)[number]): string | null {
  return sessionStorage.getItem(key)
}

function clearGuestValues(): void {
  for (const key of GUEST_STORAGE_KEYS) sessionStorage.removeItem(key)
}

function readAuthValue(key: AuthStorageKey): string | null {
  return localStorage.getItem(key) || sessionStorage.getItem(key)
}

function writeAuthValue(key: AuthStorageKey, value: string): void {
  localStorage.setItem(key, value)
  sessionStorage.removeItem(key)
}

function clearAuthValues(): void {
  for (const key of AUTH_STORAGE_KEYS) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  }
}

// SECURITY NOTE — session token storage.
//
// Authentication is shared across tabs in localStorage. Workspace/session
// selection remains tab-specific. The token is readable by WebSocket clients
// that pass it as an "auth.<token>" subprotocol, so treat it as sensitive.
export function useAuth() {
  const [token, setToken] = useState<string | null>(() => readGuestValue('wede_guest_token') || readAuthValue('wede_token'))
  const [username, setUsername] = useState<string>(() => readGuestValue('wede_guest_token') ? 'anon' : readAuthValue('wede_username') || '')
  const [role, setRole] = useState<string>(() => readGuestValue('wede_guest_role') || readAuthValue('wede_role') || '')
  const [teacher, setTeacher] = useState<boolean>(() => !readGuestValue('wede_guest_token') && readAuthValue('wede_teacher') === '1')
  const [guest, setGuest] = useState<boolean>(() => !!readGuestValue('wede_guest_token'))
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  // Undefined until the server reports a count, so the login form does not
  // claim a made-up number of attempts remaining before the first try.
  const [remaining, setRemaining] = useState<number | undefined>(undefined)
  const [debug, setDebug] = useState(false) // server debug mode (server-log + client-log)

  // Migrate credentials from the former per-tab storage to shared browser storage.
  useEffect(() => {
    if (readGuestValue('wede_guest_token')) return
    for (const key of AUTH_STORAGE_KEYS) {
      const current = localStorage.getItem(key)
      const previous = sessionStorage.getItem(key)
      if (!current && previous) localStorage.setItem(key, previous)
      sessionStorage.removeItem(key)
    }
  }, [])

  useEffect(() => {
    const guestToken = readGuestValue('wede_guest_token')
    const t = guestToken || localStorage.getItem('wede_token')
    if (!t) return
    fetch(`${apiBase()}/auth/check`, { headers: { Authorization: t } })
      .then(r => r.json())
      .then((data: AuthCheckResponse) => {
        setLocked(!!data.locked)
        setDebug(!!data.debug)
        if (data.authenticated && data.role) {
          setRole(data.role)
          if (guestToken) {
            sessionStorage.setItem('wede_guest_role', data.role)
            setTeacher(false)
          } else {
            writeAuthValue('wede_role', data.role)
            setTeacher(!!data.teacher)
            writeAuthValue('wede_teacher', data.teacher ? '1' : '0')
          }
        } else if (!data.authenticated) {
          // Session expired server-side; clear stored credentials.
          if (guestToken) clearGuestValues()
          else clearAuthValues()
          setToken(null)
          setUsername('')
          setRole('')
          setTeacher(false)
          setGuest(false)
        }
      })
      .catch(() => {})
  }, []) // intentionally run once on mount only

  useEffect(() => {
    const syncAuth = (event: StorageEvent) => {
      if (readGuestValue('wede_guest_token')) return
      if (event.key !== null && !AUTH_STORAGE_KEYS.includes(event.key as AuthStorageKey)) return
      setToken(localStorage.getItem('wede_token'))
      setUsername(localStorage.getItem('wede_username') || '')
      setRole(localStorage.getItem('wede_role') || '')
      setTeacher(localStorage.getItem('wede_teacher') === '1')
      setGuest(false)
    }
    window.addEventListener('storage', syncAuth)
    return () => window.removeEventListener('storage', syncAuth)
  }, [])

  const login = useCallback(async (password: string, name = ''): Promise<boolean> => {
    setError(null)
    try {
      const res = await fetch(`${apiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, username: name }),
      })
      const data: LoginResponse = await res.json()
      if (data.error === 'locked') {
        setLocked(true)
        setRemaining(undefined)
        setError(data.message ?? 'Too many failed attempts from this address. Try again later.')
        return false
      }
      if (data.error === 'wrong_password') {
        setRemaining(data.remaining ?? 0)
        setError(`Wrong password. ${data.remaining} attempt${data.remaining !== 1 ? 's' : ''} remaining.`)
        return false
      }
      if (data.token) {
        clearGuestValues()
        writeAuthValue('wede_token', data.token)
        sessionStorage.removeItem('wede_session_id')
        setToken(data.token)
        const resolved = data.username || name || ''
        writeAuthValue('wede_username', resolved)
        setUsername(resolved)
        const resolvedRole = data.role || 'owner'
        writeAuthValue('wede_role', resolvedRole)
        setRole(resolvedRole)
        const resolvedTeacher = !!data.teacher
        writeAuthValue('wede_teacher', resolvedTeacher ? '1' : '0')
        setTeacher(resolvedTeacher)
        setGuest(false)
        setLocked(false)
        setRemaining(undefined)
        return true
      }
      setError('Unknown error')
      return false
    } catch {
      setError('Cannot connect to server')
      return false
    }
  }, [])

  const loginWithToken = useCallback(async (token: string, name = ''): Promise<boolean> => {
    setError(null)
    try {
      const res = await fetch(`${apiBase()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_token: token, username: name }),
      })
      const data = await res.json() as LoginResponse
      if (!res.ok || !data.token) {
        setError('This login link is invalid, expired, or disabled.')
        return false
      }
      writeAuthValue('wede_token', data.token)
      clearGuestValues()
      sessionStorage.removeItem('wede_session_id')
      setToken(data.token)
      const resolved = data.username || name || ''
      writeAuthValue('wede_username', resolved)
      setUsername(resolved)
      const resolvedRole = data.role || 'editor'
      writeAuthValue('wede_role', resolvedRole)
      setRole(resolvedRole)
      const resolvedTeacher = !!data.teacher
      writeAuthValue('wede_teacher', resolvedTeacher ? '1' : '0')
      setTeacher(resolvedTeacher)
      setGuest(false)
      setLocked(false)
      setRemaining(undefined)
      return true
    } catch {
      setError('Cannot connect to server')
      return false
    }
  }, [])

  // redeem exchanges a raw invite token for a new session and stores the result
  // exactly like login does.
  const redeem = useCallback(async (inviteToken: string): Promise<boolean> => {
    try {
      const res = await fetch(`${apiBase()}/auth/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken }),
      })
      if (!res.ok) return false
      const data: RedeemResponse = await res.json()
      if (data.token) {
        writeAuthValue('wede_token', data.token)
        clearGuestValues()
        sessionStorage.removeItem('wede_session_id')
        setToken(data.token)
        const resolved = data.username || ''
        writeAuthValue('wede_username', resolved)
        setUsername(resolved)
        const resolvedRole = data.role || 'viewer'
        writeAuthValue('wede_role', resolvedRole)
        setRole(resolvedRole)
        const resolvedTeacher = !!data.teacher
        writeAuthValue('wede_teacher', resolvedTeacher ? '1' : '0')
        setTeacher(resolvedTeacher)
        setGuest(false)
        return true
      }
      return false
    } catch {
      return false
    }
 }, [])

  const loginAnonymous = useCallback(async (template: string): Promise<string> => {
    const res = await fetch(`${apiBase()}/anonymous/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    })
    const data = await res.json() as AnonymousLoginResponse
    if (!res.ok || !data.token || !data.session?.id) {
      throw new Error(data.error || 'Could not join anonymously')
    }
    clearGuestValues()
    sessionStorage.setItem('wede_guest_token', data.token)
    sessionStorage.setItem('wede_guest_role', data.role || 'viewer')
    sessionStorage.setItem('wede_guest_workspace', data.session.id)
    setToken(data.token)
    setUsername(data.username || 'anon')
    setRole(data.role || 'viewer')
    setTeacher(false)
    setGuest(true)
    return data.session.id
  }, [])

  const logout = useCallback(() => {
    const t = guest ? readGuestValue('wede_guest_token') : readAuthValue('wede_token')
    if (guest) clearGuestValues()
    else clearAuthValues()
    sessionStorage.removeItem('wede_session_id')
    setToken(null)
    setUsername('')
    setRole('')
    setTeacher(false)
    setGuest(false)
    if (t) {
      // Revoke the token server-side (fire-and-forget; ignore network errors)
      fetch(`${apiBase()}/auth/logout`, {
        method: 'DELETE',
        headers: { Authorization: t },
      }).catch(() => {})
    }
  }, [guest])

  const authFetch: AuthFetch = useCallback(async (url, options = {}) => {
    // String(token) matches fetch's own implicit coercion of a null header
    // value (the untyped original passed `token` straight through).
    const headers = { ...options.headers, Authorization: String(token) }
    const res = await fetch(scopedUrl(url), { ...options, headers })
    if (res.status === 401) {
      logout()
      throw new Error('unauthorized')
    }
    return res
  }, [token, logout])

  const updateUsername = useCallback((name: string | null | undefined) => {
    if (guest) return
    const v = (name || '').trim()
    setUsername(v)
    try {
      if (v) writeAuthValue('wede_username', v)
      else {
        localStorage.removeItem('wede_username')
        sessionStorage.removeItem('wede_username')
      }
    } catch { /* ignore */ }
  }, [guest])

  return { token, username, role, teacher, guest, debug, login, loginWithToken, loginAnonymous, logout, redeem, error, locked, remaining, authFetch, updateUsername }
}
