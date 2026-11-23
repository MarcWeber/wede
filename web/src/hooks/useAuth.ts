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

// SECURITY NOTE — session token storage.
//
// The session token is kept in sessionStorage (per-tab, not shared across tabs)
// so that two users on the same browser can each open their own tab and log in
// independently without kicking the other out. The token is readable by
// WebSocket clients (terminal/collab/chat) that pass it as an "auth.<token>"
// subprotocol. The downside is that any successful XSS could read it. The
// primary stored-XSS vector (rendering collaborators' markdown) is now closed by
// sanitizing with DOMPurify in MarkdownPreview, so a token-stealing payload can
// no longer be planted via file content.
//
// The robust fix is to move the token to an HttpOnly, SameSite cookie so JS can
// never read it. That is a backend change (Set-Cookie on login/redeem, read the
// cookie in auth.Middleware, clear it on logout, and switch the WS handshake to
// cookie auth) and is tracked as follow-up work; it is intentionally not done in
// this change to avoid destabilizing the WS auth path. Until then, keep the XSS
// surface minimal (DOMPurify above) and treat the token as sensitive.
export function useAuth() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('wede_token'))
  const [username, setUsername] = useState<string>(() => sessionStorage.getItem('wede_username') || '')
  const [role, setRole] = useState<string>(() => sessionStorage.getItem('wede_role') || '')
  const [teacher, setTeacher] = useState<boolean>(() => sessionStorage.getItem('wede_teacher') === '1')
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  // Undefined until the server reports a count, so the login form does not
  // claim a made-up number of attempts remaining before the first try.
  const [remaining, setRemaining] = useState<number | undefined>(undefined)

  // On mount: confirm role from /api/auth/check so a persisted viewer/editor
  // session gets the correct role even after a page reload.

  useEffect(() => {
    const t = sessionStorage.getItem('wede_token')
    if (!t) return
    fetch(`${apiBase()}/auth/check`, { headers: { Authorization: t } })
      .then(r => r.json())
      .then((data: AuthCheckResponse) => {
        setLocked(!!data.locked)
        if (data.authenticated && data.role) {
          setRole(data.role)
          sessionStorage.setItem('wede_role', data.role)
          setTeacher(!!data.teacher)
          sessionStorage.setItem('wede_teacher', data.teacher ? '1' : '0')
        } else if (!data.authenticated) {
          // Session expired server-side; clear stored credentials.
          sessionStorage.removeItem('wede_token')
          sessionStorage.removeItem('wede_username')
          sessionStorage.removeItem('wede_role')
          sessionStorage.removeItem('wede_teacher')
          setToken(null)
          setUsername('')
          setRole('')
          setTeacher(false)
        }
      })
      .catch(() => {})
  }, []) // intentionally run once on mount only


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
        sessionStorage.setItem('wede_token', data.token)
        sessionStorage.removeItem('wede_session_id')
        setToken(data.token)
        const resolved = data.username || name || ''
        sessionStorage.setItem('wede_username', resolved)
        setUsername(resolved)
        const resolvedRole = data.role || 'owner'
        sessionStorage.setItem('wede_role', resolvedRole)
        setRole(resolvedRole)
        const resolvedTeacher = !!data.teacher
        sessionStorage.setItem('wede_teacher', resolvedTeacher ? '1' : '0')
        setTeacher(resolvedTeacher)
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
        sessionStorage.setItem('wede_token', data.token)
        sessionStorage.removeItem('wede_session_id')
        setToken(data.token)
        const resolved = data.username || ''
        sessionStorage.setItem('wede_username', resolved)
        setUsername(resolved)
        const resolvedRole = data.role || 'viewer'
        sessionStorage.setItem('wede_role', resolvedRole)
        setRole(resolvedRole)
        const resolvedTeacher = !!data.teacher
        sessionStorage.setItem('wede_teacher', resolvedTeacher ? '1' : '0')
        setTeacher(resolvedTeacher)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  const logout = useCallback(() => {
    const t = sessionStorage.getItem('wede_token')
    sessionStorage.removeItem('wede_token')
    sessionStorage.removeItem('wede_username')
    sessionStorage.removeItem('wede_role')
    sessionStorage.removeItem('wede_teacher')
    sessionStorage.removeItem('wede_session_id')
    setToken(null)
    setRole('')
    setTeacher(false)
    if (t) {
      // Revoke the token server-side (fire-and-forget; ignore network errors)
      fetch(`${apiBase()}/auth/logout`, {
        method: 'DELETE',
        headers: { Authorization: t },
      }).catch(() => {})
    }
  }, [])

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
    const v = (name || '').trim()
    setUsername(v)
    try {
      if (v) sessionStorage.setItem('wede_username', v)
      else sessionStorage.removeItem('wede_username')
    } catch { /* ignore */ }
  }, [])

  return { token, username, role, teacher, login, logout, redeem, error, locked, remaining, authFetch, updateUsername }
}
