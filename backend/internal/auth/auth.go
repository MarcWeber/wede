package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ── Context key for session role ──────────────────────────────────────────────

type contextKey int

const (
	roleCtxKey contextKey = iota
	usernameCtxKey
)

// GetRole returns the resolved Role that Middleware attached to the request
// context. Returns "" if Middleware has not run (shouldn't happen in normal
// operation — treat it as an unauthenticated call).
func GetRole(r *http.Request) Role {
	if v, ok := r.Context().Value(roleCtxKey).(Role); ok {
		return v
	}
	return ""
}

// GetUsername returns the authenticated session's display username that
// Middleware attached to the request context. Handlers should trust this value
// rather than a client-supplied query parameter, so a peer cannot impersonate
// another user. Returns "" if Middleware has not run or the session had no name.
func GetUsername(r *http.Request) string {
	if v, ok := r.Context().Value(usernameCtxKey).(string); ok {
		return v
	}
	return ""
}

// sessionEntry holds a token's creation timestamp for idle-TTL enforcement, the
// display username chosen at (or after) login, and the session's role.
type sessionEntry struct {
	CreatedAt time.Time `json:"created_at"`
	Username  string    `json:"username,omitempty"`
	Role      Role      `json:"role,omitempty"` // empty (legacy) → owner
}

// maxUsernameLen bounds a stored username.
const maxUsernameLen = 32

// sanitizeUsername trims and length-caps a chosen username. An empty result is
// allowed; the presence layer substitutes a default ("anon").
func sanitizeUsername(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxUsernameLen {
		s = s[:maxUsernameLen]
	}
	return s
}

// SessionTTL is the idle lifetime of a session token (24 hours).
const SessionTTL = 24 * time.Hour

// defaultMaxAttempts is the number of wrong owner-password attempts allowed per
// client address inside defaultLockoutWindow. The lockout is per-IP and
// time-based: one noisy client (or a bot) cannot permanently lock the owner out
// from every other address, and it expires on its own.
const defaultMaxAttempts = 20

// defaultLockoutWindow is how long a client address stays locked after reaching
// defaultMaxAttempts. It is also the window in which failures are counted.
const defaultLockoutWindow = 10 * time.Minute

// lockoutFile is the basename of the file used to persist lockout state.
const lockoutFile = "lockout.json"

// clientAttempt is the persisted failure state for one client address.
type clientAttempt struct {
	Count   int       `json:"count"`
	ResetAt time.Time `json:"reset_at"`
}

// lockoutState is persisted so brute-force lockout survives server restarts.
// The legacy Attempts/Locked fields are accepted so an old global lockout file
// does not keep the owner locked out after upgrading; loadLockout ignores them.
type lockoutState struct {
	Clients  map[string]clientAttempt `json:"clients,omitempty"`
	Attempts int                      `json:"attempts,omitempty"`
	Locked   bool                     `json:"locked,omitempty"`
}

type Handler struct {
	password      string
	users         map[string]string // username -> password (plain or "sha256:hex")
	teachers      map[string]bool   // set of teacher usernames
	mu            sync.Mutex
	attempts      map[string]clientAttempt // client address -> failures
	maxAttempts   int
	lockoutWindow time.Duration
	sessions      map[string]sessionEntry
	tokens        map[string]shareToken
	dataDir       string

	redeemMu   sync.Mutex
	redeemHits map[string]*redeemBucket // per-IP rate limiting for invite redemption
}

func New(password string) *Handler {
	home, _ := os.UserHomeDir()
	dataDir := filepath.Join(home, ".wede")
	return NewWithDataDir(password, dataDir)
}

// NewWithDataDir creates a Handler that stores sessions, tokens, and lockout state
// in dir instead of the default ~/.wede. Useful when the storage location must be
// explicitly controlled (e.g. tests, alternate deployment paths).
func NewWithDataDir(password, dir string) *Handler {
	os.MkdirAll(dir, 0700)
	h := &Handler{
		password:      password,
		maxAttempts:   defaultMaxAttempts,
		lockoutWindow: defaultLockoutWindow,
		attempts:      make(map[string]clientAttempt),
		sessions:      make(map[string]sessionEntry),
		tokens:        make(map[string]shareToken),
		dataDir:       dir,
		redeemHits:    make(map[string]*redeemBucket),
	}
	h.loadSessions()
	h.loadLockout()
	h.loadTokens()
	return h
}

func (h *Handler) sessionsFile() string {
	return filepath.Join(h.dataDir, "sessions.json")
}

func (h *Handler) lockoutFilePath() string {
	return filepath.Join(h.dataDir, lockoutFile)
}

// loadSessions reads persisted sessions and prunes expired ones. Sessions are
// keyed by the SHA-256 hash of the token, so the stored map keys are hashes and
// can be loaded directly.
func (h *Handler) loadSessions() {
	data, err := os.ReadFile(h.sessionsFile())
	if err != nil {
		return
	}
	var stored map[string]sessionEntry
	if json.Unmarshal(data, &stored) == nil {
		now := time.Now()
		for k, e := range stored {
			if now.Sub(e.CreatedAt) < SessionTTL {
				h.sessions[k] = e
			}
		}
	}
}

// saveSessions writes the current session map to disk (must be called with mu held or
// after acquiring it if the caller doesn't hold it). The map is keyed by token
// hash, so no raw session token is ever persisted: an attacker who reads
// ~/.wede/sessions.json cannot recover a usable token.
func (h *Handler) saveSessions() {
	data, _ := json.Marshal(h.sessions)
	os.WriteFile(h.sessionsFile(), data, 0600)
}

// loadLockout restores per-client attempt state from disk, dropping expired
// entries. A missing file means no client is locked. Legacy global state is
// ignored deliberately: it used to lock every address at once.
func (h *Handler) loadLockout() {
	h.attempts = make(map[string]clientAttempt)
	data, err := os.ReadFile(h.lockoutFilePath())
	if err != nil {
		return
	}
	var s lockoutState
	if json.Unmarshal(data, &s) != nil {
		return
	}
	now := time.Now()
	for ip, a := range s.Clients {
		if a.Count > 0 && now.Before(a.ResetAt) {
			h.attempts[ip] = a
		}
	}
}

// saveLockout persists the current per-client state (must be called with mu held
// or immediately after the critical section that changed it).
func (h *Handler) saveLockout() {
	data, _ := json.Marshal(lockoutState{Clients: h.attempts})
	os.WriteFile(h.lockoutFilePath(), data, 0600)
}

// clientKey identifies the caller for lockout purposes. Behind a loopback
// reverse proxy/tunnel, use the forwarded address when present; otherwise every
// tunneled visitor would share 127.0.0.1 and one bot could lock them all.
func clientKey(r *http.Request) string {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		host = h
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if first := strings.TrimSpace(strings.Split(xff, ",")[0]); first != "" {
				return first
			}
		}
		if xr := strings.TrimSpace(r.Header.Get("X-Real-IP")); xr != "" {
			return xr
		}
	}
	return host
}

// lockedFor returns how long the client must wait before another attempt, or 0
// when it is not locked. mu must be held.
func (h *Handler) lockedFor(ip string, now time.Time) time.Duration {
	a, ok := h.attempts[ip]
	if !ok || a.Count < h.maxAttempts || !now.Before(a.ResetAt) {
		return 0
	}
	return a.ResetAt.Sub(now)
}

// recordFailure increments the client's failure count, starting a new window
// when the previous one expired. It returns the remaining attempts (0 when the
// client just became locked) and the lock duration. mu must be held.
func (h *Handler) recordFailure(ip string, now time.Time) (int, time.Duration) {
	a := h.attempts[ip]
	if !now.Before(a.ResetAt) {
		a = clientAttempt{ResetAt: now.Add(h.lockoutWindow)}
	}
	a.Count++
	h.attempts[ip] = a
	if a.Count >= h.maxAttempts {
		return 0, a.ResetAt.Sub(now)
	}
	return h.maxAttempts - a.Count, 0
}

func lockoutMessage(wait time.Duration) string {
	secs := int(wait.Round(time.Second) / time.Second)
	if secs < 60 {
		return fmt.Sprintf("Too many failed attempts from this address. Try again in %ds.", secs)
	}
	return fmt.Sprintf("Too many failed attempts from this address. Try again in %dm.", (secs+59)/60)
}

// pruneExpired removes sessions whose idle TTL has elapsed. mu must be held.
func (h *Handler) pruneExpired() {
	now := time.Now()
	for k, e := range h.sessions {
		if now.Sub(e.CreatedAt) >= SessionTTL {
			delete(h.sessions, k)
		}
	}
}

// validSession checks whether token is present and not expired. mu must be held.
// Lookups are keyed by the token's hash so the raw token is never used as a map
// key (and thus never persisted).
func (h *Handler) validSession(token string) bool {
	key := hashToken(token)
	e, ok := h.sessions[key]
	if !ok {
		return false
	}
	if time.Since(e.CreatedAt) >= SessionTTL {
		delete(h.sessions, key)
		return false
	}
	return true
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var body struct {
		Password string `json:"password"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	// Re-read lockout state so deleting ~/.wede/lockout.json unlocks a running
	// server (the in-memory map otherwise survives the file removal).
	h.loadLockout()
	ip := clientKey(r)
	now := time.Now()
	if wait := h.lockedFor(ip, now); wait > 0 {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]any{
			"error":   "locked",
			"message": lockoutMessage(wait),
		})
		return
	}

	// When per-user passwords are configured, authenticate against the users map.
	username := sanitizeUsername(body.Username)
	if h.users != nil && len(h.users) > 0 {
		storedPass, ok := h.users[username]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "unknown user"})
			return
		}
		if !checkPassword(storedPass, body.Password) {
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "wrong password"})
			return
		}
		// Per-user login → editor role, with teacher flag if applicable.
		sessionToken := h.newSession(username, RoleEditor)
		isTeacher := h.teachers != nil && h.teachers[username]
		// Do NOT set a cookie: the frontend uses sessionStorage + Authorization header.
		// A shared cookie would cause cross-user interference when multiple users
		// log in from the same browser (even different tabs) — the last login wins.
		json.NewEncoder(w).Encode(map[string]any{
			"token":    sessionToken,
			"username": username,
			"role":     string(RoleEditor),
			"teacher":  isTeacher,
		})
		return
	}

	// Fallback: owner-password login.
	if subtle.ConstantTimeCompare([]byte(body.Password), []byte(h.password)) != 1 {
		remaining, wait := h.recordFailure(ip, now)
		h.saveLockout()
		if wait > 0 {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "locked",
				"message": lockoutMessage(wait),
			})
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]any{
			"error":     "wrong_password",
			"remaining": remaining,
		})
		return
	}

	delete(h.attempts, ip)
	h.saveLockout()

	// Owner-password login → owner role.
	sessionToken := h.newSession(username, RoleOwner)
	// Do NOT set a cookie: the frontend uses sessionStorage + Authorization header.
	json.NewEncoder(w).Encode(map[string]any{
		"token":    sessionToken,
		"username": username,
		"role":     string(RoleOwner),
		"teacher":  true,
	})
}

// isHTTPS reports whether the request arrived over HTTPS, checking both the
// direct TLS connection and the X-Forwarded-Proto header set by a trusted
// reverse proxy.
func isHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" {
		return true
	}
	return false
}

// checkPassword compares a password against a stored value that may be plain
// text or "sha256:hex" prefixed.
func checkPassword(stored, plain string) bool {
	if strings.HasPrefix(stored, "sha256:") {
		hashed := "sha256:" + sha256Hex(plain)
		return subtle.ConstantTimeCompare([]byte(hashed), []byte(stored)) == 1
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(plain)) == 1
}

// sha256Hex returns the hex-encoded SHA-256 of the input string.
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// newSession creates, stores, and persists a session, returning its token. The
// caller must hold h.mu.
func (h *Handler) newSession(username string, role Role) string {
	raw := make([]byte, 32)
	rand.Read(raw)
	token := hex.EncodeToString(raw)
	h.sessions[hashToken(token)] = sessionEntry{
		CreatedAt: time.Now(),
		Username:  sanitizeUsername(username),
		Role:      role,
	}
	h.pruneExpired()
	h.saveSessions()
	return token
}

// Role returns the role for a valid session token, or "" if unknown/expired.
// A session with no stored role (created before Wave 9) is treated as owner.
func (h *Handler) Role(token string) Role {
	h.mu.Lock()
	defer h.mu.Unlock()
	if e, ok := h.sessions[hashToken(token)]; ok && time.Since(e.CreatedAt) < SessionTTL {
		return normalizeRole(e.Role)
	}
	return ""
}

// SetUsername updates the display username on the caller's session. Mounted
// behind the auth middleware (POST /api/auth/username). When per-user passwords
// are configured (h.users), the username is fixed and cannot be changed.
func (h *Handler) SetUsername(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	token := r.Header.Get("Authorization")
	if token == "" {
		token = r.URL.Query().Get("token")
	}

	var body struct {
		Username string `json:"username"`
	}
	json.NewDecoder(r.Body).Decode(&body) //nolint:errcheck — empty body => empty name
	name := sanitizeUsername(body.Username)

	key := hashToken(token)
	h.mu.Lock()
	defer h.mu.Unlock()

	e, ok := h.sessions[key]
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		return
	}

	// When per-user passwords are configured, usernames are fixed.
	if h.users != nil && len(h.users) > 0 {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: username is fixed"})
		return
	}

	e.Username = name
	h.sessions[key] = e
	h.saveSessions()

	json.NewEncoder(w).Encode(map[string]string{"username": name})
}

// IsAuthenticated reports whether r carries a valid session credential,
// checking the Authorization header, ?token= query param, and the
// wede_session cookie (set on browser login).
func (h *Handler) IsAuthenticated(r *http.Request) bool {
	token := r.Header.Get("Authorization")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		if c, err := r.Cookie("wede_session"); err == nil {
			token = c.Value
		}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.validSession(token)
}

// Username returns the username for a valid session token, or "" if the token is
// unknown/expired. Used by the collab layer to attribute presence.
func (h *Handler) Username(token string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if e, ok := h.sessions[hashToken(token)]; ok && time.Since(e.CreatedAt) < SessionTTL {
		return e.Username
	}
	return ""
}

// Logout revokes the caller's session token server-side.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	token := r.Header.Get("Authorization")
	if token == "" {
		token = r.URL.Query().Get("token")
	}

	h.mu.Lock()
	delete(h.sessions, hashToken(token))
	h.saveSessions()
	h.mu.Unlock()
	// Clear the cookie if it was ever set (for backward compatibility).
	http.SetCookie(w, &http.Cookie{
		Name:     "wede_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) Check(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	token := r.Header.Get("Authorization")
	if token == "" {
		token = r.URL.Query().Get("token")
	}

	key := hashToken(token)
	h.mu.Lock()
	// Re-read from disk so deleting ~/.wede/lockout.json (or a config change)
	// is reflected without restarting the server.
	h.loadLockout()
	valid := h.validSession(token)
	locked := h.lockedFor(clientKey(r), time.Now()) > 0
	username := ""
	role := Role("")
	if valid {
		username = h.sessions[key].Username
		role = normalizeRole(h.sessions[key].Role)
	}
	// Owner is always a teacher; otherwise check the teachers list.
	isTeacher := valid && (role == RoleOwner || h.teachers[username])
	h.mu.Unlock()

	userCount := 0
	if h.users != nil {
		userCount = len(h.users)
	}
	json.NewEncoder(w).Encode(map[string]any{
		"authenticated": valid,
		"locked":        locked,
		"username":      username,
		"role":          string(role),
		"teacher":       isTeacher,
		"userCount":     userCount,
	})
}

func (h *Handler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		// WebSocket clients (terminal) can't set headers, so they pass the token
		// as an "auth.<token>" subprotocol in Sec-WebSocket-Protocol. Read it here
		// so the token never appears in URLs or access logs.
		if token == "" {
			for _, p := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
				if p = strings.TrimSpace(p); strings.HasPrefix(p, "auth.") {
					token = strings.TrimPrefix(p, "auth.")
					break
				}
			}
		}

		key := hashToken(token)
		h.mu.Lock()
		valid := h.validSession(token)
		role := Role("")
		username := ""
		if valid {
			role = normalizeRole(h.sessions[key].Role)
			username = h.sessions[key].Username
		}
		h.mu.Unlock()

		if !valid {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		ctx := context.WithValue(r.Context(), roleCtxKey, role)
		ctx = context.WithValue(ctx, usernameCtxKey, username)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireEditor rejects requests from viewer-role sessions with 403 Forbidden.
// Owner and editor sessions pass through. Must be composed after Middleware so
// that the role is already in the request context.
func (h *Handler) RequireEditor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := GetRole(r)
		if !role.CanMutate() {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: editor or owner role required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireOwner rejects requests from non-owner sessions with 403 Forbidden.
// Must be composed after Middleware so that the role is already in the request
// context.
func (h *Handler) RequireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := GetRole(r)
		if role != RoleOwner {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "forbidden: owner role required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// SetCredentials updates the owner password and per-user password map.
// Per-user passwords may be plain text or "sha256:hex" prefixed.
func (h *Handler) SetCredentials(password string, users map[string]string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.password = password
	h.users = users
}

// SetTeachers updates the set of teacher usernames.
func (h *Handler) SetTeachers(teachers []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.teachers = make(map[string]bool, len(teachers))
	for _, t := range teachers {
		h.teachers[t] = true
	}
}

// IsTeacher reports whether the given username is in the teachers list.
func (h *Handler) IsTeacher(username string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.teachers != nil && h.teachers[username]
}

// SetUsers updates the per-user password map and revokes sessions for users
// that are no longer in the map. When users is nil, the restriction is lifted
// and all sessions are valid again.
func (h *Handler) SetUsers(users map[string]string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.users = users
	// Revoke sessions for removed users.
	if users != nil {
		for key, e := range h.sessions {
			if e.Username != "" && users[e.Username] == "" {
				delete(h.sessions, key)
			}
		}
		h.saveSessions()
	}
}
