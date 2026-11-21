// Package workspace introduces the multi-project ("workspace") model that replaces wede's
// former single global workspace. Each Workspace owns an isolated project root via its
// own folder.Manager, which satisfies the WorkspaceProvider interface that the
// files/git/search/filewatcher/terminal/lsp handlers depend on. A RoomManager owns
// the set of live workspaces.
//
// This is the backbone of the collaborative rebuild: per-workspace state instead of one
// global singleton. Route-scoping of the per-workspace services (/api/workspaces/{id}/...) is
// layered on in subsequent slices; this file establishes the registry and lifecycle.
package workspace

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	ywebsocket "github.com/reearth/ygo/provider/websocket"

	"wede/backend/internal/apiclient"
	"wede/backend/internal/chat"
	"wede/backend/internal/collab"
	"wede/backend/internal/collabdoc"
	"wede/backend/internal/dap"
	"wede/backend/internal/files"
	"wede/backend/internal/filewatcher"
	"wede/backend/internal/folder"
	"wede/backend/internal/git"
	"wede/backend/internal/lsp"
	"wede/backend/internal/presence"
	"wede/backend/internal/search"
	"wede/backend/internal/terminal"
)

// Workspace is one open project. It is rooted at an immutable path on disk, surfaced
// through its folder.Manager (which the per-workspace service handlers consume).
// The service handlers (files/git/search) are constructed lazily and bound to
// this workspace's workspace, so each workspace operates on its own isolated root.
type Workspace struct {
	ID        string
	Name      string
	Template  string
	CreatedAt time.Time

	ws *folder.Manager

	// Session lifecycle: timeoutSecs is this session's idle timeout (0 = never).
	// activityMu guards the occupancy tracker used by the idle janitor.
	timeoutSecs int
	activityMu  sync.Mutex
	lastActive  time.Time
	occupied    bool

	// frameAncestors is threaded into the terminal/lsp WebSocket origin checks.
	frameAncestors string
	// canLead reports whether a username may start a forced-follow lead.
	canLead func(username string) bool
	// visibleTabTypes controls which tab types are shown in the hamburger menu.
	// nil means all tabs are visible.
	visibleTabTypes map[string]bool

	mu          sync.Mutex
	files       *files.Handler
	git         *git.Handler
	search      *search.Handler
	watcher     *filewatcher.Handler
	terminal    *terminal.Handler
	lsp         *lsp.Handler
	dap         *dap.Handler
	presence    *presence.Hub
	collab      *collab.Handler
	chatPublic  *chat.Hub
	chatPrivate *chat.Hub
	apiClient   *apiclient.Handler
	docs        *collabdoc.DocStore
	docServer   *ywebsocket.Server         // ygo sync+awareness WS server (one doc per file)
	docPersist  *collabdoc.DiskPersistence // seeds from + writes back to disk
}

// Workspace returns the workspace's folder.Manager, satisfying the WorkspaceProvider
// interfaces (Current/OnChange) the service handlers require.
func (r *Workspace) Folder() *folder.Manager { return r.ws }

// Root is the absolute project path this workspace is pinned to.
func (r *Workspace) Root() string { return r.ws.Current() }

// Users returns the number of live presence members. A session with any user
// connected is never expired by the idle janitor.
func (r *Workspace) Users() int {
	r.mu.Lock()
	p := r.presence
	r.mu.Unlock()
	if p == nil {
		return 0
	}
	return len(p.Roster())
}

// shouldExpire advances the occupancy tracker and reports whether this session
// has been empty for longer than its timeout.
func (r *Workspace) shouldExpire(now time.Time) bool {
	r.activityMu.Lock()
	defer r.activityMu.Unlock()
	if users := r.Users(); users > 0 {
		r.lastActive = now
		r.occupied = true
		return false
	}
	if r.occupied {
		// The moment the last user left: start the idle clock now.
		r.lastActive = now
		r.occupied = false
		return false
	}
	if r.timeoutSecs <= 0 {
		return false
	}
	return now.Sub(r.lastActive) >= time.Duration(r.timeoutSecs)*time.Second
}

// Files returns this workspace's files handler, bound to the workspace's workspace.
func (r *Workspace) Files() *files.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.files == nil {
		r.files = files.New(r.ws)
	}
	return r.files
}

// Git returns this workspace's git handler, bound to the workspace's workspace.
func (r *Workspace) Git() *git.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.git == nil {
		r.git = git.New(r.ws)
	}
	return r.git
}

// Search returns this workspace's search handler, bound to the workspace's workspace.
func (r *Workspace) Search() *search.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.search == nil {
		r.search = search.New(r.ws)
	}
	return r.search
}

// Watcher returns this workspace's filewatcher, lazily starting an fsnotify watch on
// the workspace's root on first use.
func (r *Workspace) Watcher() *filewatcher.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.watcher == nil {
		r.watcher = filewatcher.New(r.ws)
	}
	return r.watcher
}

// Terminal returns this workspace's terminal handler (shared PTY sessions), lazily
// constructed and bound to the workspace's root.
func (r *Workspace) Terminal() *terminal.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.terminal == nil {
		r.terminal = terminal.New(r.ws, r.frameAncestors)
	}
	return r.terminal
}

// LSP returns this workspace's language-server proxy, lazily constructed and bound to
// the workspace's root.
func (r *Workspace) LSP() *lsp.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lsp == nil {
		r.lsp = lsp.New(r.ws, r.frameAncestors)
	}
	return r.lsp
}

// DAP returns this workspace's debug-adapter proxy, lazily created on first use.
func (r *Workspace) DAP() *dap.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.dap == nil {
		r.dap = dap.New(r.ws, r.frameAncestors)
	}
	return r.dap
}

// Presence returns this workspace's presence hub (who is connected and what they are
// viewing), lazily created on first use.
func (r *Workspace) Presence() *presence.Hub {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.presence == nil {
		r.presence = presence.NewHub()
	}
	return r.presence
}

// Collab returns this workspace's collaboration WebSocket handler, bound to the
// workspace's presence hub. Lazily created on first use.
func (r *Workspace) Collab() *collab.Handler {
	hub := r.Presence() // acquires/releases r.mu internally; must not hold it here
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.collab == nil {
		r.collab = collab.New(r.frameAncestors, hub, r.canLead, r.visibleTabTypes)
	}
	return r.collab
}

// Chat returns this workspace's chat hub for the given channel ("public" or
// "private"; anything else falls back to public), lazily created on first use.
// Public persists to <root>/.wede/chat.md (committed, LLM-readable) and polls git
// for activity; private persists to <root>/.wede/private/chat.md, which wede
// gitignores by default.
//
//	GET /api/workspaces/{id}/chat?channel=public|private -> Chat(channel).HandleWS
func (r *Workspace) Chat(channel string) *chat.Hub {
	// .wede lives under the chosen host folder (root/host); git still resolves
	// upward from there, so the chat hub gets the correct .wede location.
	hostRoot := r.wedeHostRoot() // reads ws.Current() + persisted host; does not take r.mu
	r.mu.Lock()
	defer r.mu.Unlock()
	if channel == chat.ChannelPrivate {
		if r.chatPrivate == nil {
			r.chatPrivate = chat.NewHub(hostRoot, chat.ChannelPrivate, r.frameAncestors)
		}
		return r.chatPrivate
	}
	if r.chatPublic == nil {
		r.chatPublic = chat.NewHub(hostRoot, chat.ChannelPublic, r.frameAncestors)
	}
	return r.chatPublic
}

// APIClient returns this workspace's built-in HTTP API client (Postman-style),
// persisting requests/environments under the workspace's .wede directory. The
// bound wedeDir resolver is read per-request, so it follows .wede relocation.
func (r *Workspace) APIClient() *apiclient.Handler {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.apiClient == nil {
		r.apiClient = apiclient.New(r.WedeDir)
	}
	return r.apiClient
}

// Docs returns this workspace's collaborative document store (server-authoritative
// CRDT doc per open file), lazily created on first use.
func (r *Workspace) Docs() *collabdoc.DocStore {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.docs == nil {
		r.docs = collabdoc.NewDocStore()
	}
	return r.docs
}

// DocServer returns this workspace's ygo collaboration server (y-protocols sync +
// awareness), lazily created. The provider "workspace" name is a file's workspace-relative
// path; documents are seeded from disk via DiskPersistence rooted at this workspace.
func (r *Workspace) DocServer() *ywebsocket.Server {
	root := r.Root() // reads ws.Current(); does not take r.mu
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.docServer == nil {
		persist := collabdoc.NewDiskPersistence(root)
		srv := ywebsocket.NewServerWithPersistence(persist)
		persist.SetProvider(srv) // enable debounced write-back of edits to disk
		if r.frameAncestors != "" {
			srv.AllowedOrigins = strings.Fields(r.frameAncestors)
		}
		r.docServer = srv
		r.docPersist = persist
	}
	return r.docServer
}

// shutdown tears down the workspace's long-lived subsystems. Called by Manager.Close.
func (r *Workspace) shutdown() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.watcher != nil {
		r.watcher.Close()
		r.watcher = nil
	}
	if r.terminal != nil {
		r.terminal.Close()
		r.terminal = nil
	}
	if r.lsp != nil {
		r.lsp.Close()
		r.lsp = nil
	}
	if r.presence != nil {
		r.presence.Close()
		r.presence = nil
	}
	if r.chatPublic != nil {
		r.chatPublic.Close()
		r.chatPublic = nil
	}
	if r.chatPrivate != nil {
		r.chatPrivate.Close()
		r.chatPrivate = nil
	}
	if r.docs != nil {
		r.docs.CloseAll()
		r.docs = nil
	}
	if r.docPersist != nil {
		r.docPersist.Stop() // final flush of pending edits while docs are still alive
		r.docPersist = nil
	}
	if r.docServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		r.docServer.Shutdown(ctx) //nolint:errcheck
		cancel()
		r.docServer = nil
	}
}

// Manager owns the set of live workspaces. Safe for concurrent use.
type Manager struct {
	mu              sync.RWMutex
	workspaces      map[string]*Workspace
	order           []string // preserves creation order for stable listing
	templates       map[string]Template
	defaultTimeout  int
	frameAncestors  string // threaded into per-workspace terminal/lsp origin checks
	allowedRoot     string // base dir under which new workspaces may be created ("" = no restriction)
	allowCustomDir  bool   // permit POST /api/workspaces from an arbitrary path
	canLead         func(username string) bool
	visibleTabTypes map[string]bool // global visible tab types from config
}

// Template is a configured workspace blueprint. Sessions are created from it.
type Template struct {
	Name            string          `json:"name"`
	Path            string          `json:"path"`
	TimeoutSecs     int             `json:"timeout_secs"`
	LSP             []string        `json:"lsp,omitempty"`
	VisibleTabTypes map[string]bool `json:"visible_tab_types,omitempty"`
}

// SessionInfo is a snapshot of a running session for the picker/API.
type SessionInfo struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Template    string    `json:"template"`
	Root        string    `json:"root"`
	Users       int       `json:"users"`
	AgeSecs     int64     `json:"age_secs"`
	TimeoutSecs int       `json:"timeout_secs"`
	CreatedAt   time.Time `json:"created_at"`
}

// NewManager returns an empty Manager. frameAncestors mirrors the frame_ancestors
// config and is passed to each workspace's terminal/lsp handlers for WebSocket
// origin checking. allowedRoot is the base directory under which new workspaces
// may be created (see folder.ValidateRoot); an empty value disables that check.
func NewManager(frameAncestors, allowedRoot string) *Manager {
	return &Manager{
		workspaces:     make(map[string]*Workspace),
		templates:      make(map[string]Template),
		defaultTimeout: 600,
		frameAncestors: frameAncestors,
		allowedRoot:    allowedRoot,
	}
}

// SetAllowCustomDirectory controls whether POST /api/workspaces may create a
// workspace from an arbitrary path. Templates and the boot workspace are
// unaffected.
func (m *Manager) SetAllowCustomDirectory(allow bool) {
	m.mu.Lock()
	m.allowCustomDir = allow
	m.mu.Unlock()
}

// SetDefaultTimeout sets the fallback idle timeout for new sessions.
func (m *Manager) SetDefaultTimeout(secs int) {
	if secs < 0 {
		return
	}
	m.mu.Lock()
	m.defaultTimeout = secs
	m.mu.Unlock()
}

// SetTemplates replaces the configured workspace templates. Running sessions
// are unaffected.
func (m *Manager) SetTemplates(templates map[string]Template) {
	next := make(map[string]Template, len(templates))
	for name, t := range templates {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		t.Name = name
		if strings.TrimSpace(t.Path) == "" {
			t.Path = "."
		}
		if t.TimeoutSecs < 0 {
			t.TimeoutSecs = 0
		}
		next[name] = t
	}
	m.mu.Lock()
	m.templates = next
	m.mu.Unlock()
}

// Templates returns configured templates sorted by name.
func (m *Manager) Templates() []Template {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Template, 0, len(m.templates))
	for _, t := range m.templates {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// SetTeacherChecker installs the teacher-permission predicate used by each
// workspace's collab handler. Call during startup (before/after Register is
// both safe); existing workspaces are updated too.
func (m *Manager) SetTeacherChecker(fn func(username string) bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.canLead = fn
	for _, r := range m.workspaces {
		r.mu.Lock()
		r.canLead = fn
		r.mu.Unlock()
	}
}

// SetVisibleTabTypes sets the global visible tab types from config. Existing
// workspaces are updated too (custom workspaces use the global value; template
// workspaces keep their template-level override).
func (m *Manager) SetVisibleTabTypes(types map[string]bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.visibleTabTypes = types
	for _, r := range m.workspaces {
		r.mu.Lock()
		// Only update custom workspaces; template workspaces keep their own value
		if r.Template == "custom" {
			r.visibleTabTypes = types
		}
		r.mu.Unlock()
	}
}

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand should never fail; fall back to a fixed-length marker so
		// callers still get a non-empty id rather than a panic.
		return "0000000000000000"
	}
	return hex.EncodeToString(b)
}

// register inserts r under the manager's lock.
func (m *Manager) register(r *Workspace) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.workspaces[r.ID] = r
	m.order = append(m.order, r.ID)
}

// Register adopts an existing folder.Manager as a workspace. Used to seed the
// default workspace from the boot workspace so the solo-user case works with no setup.
func (m *Manager) Register(name string, ws *folder.Manager) *Workspace {
	if name == "" {
		name = filepath.Base(ws.Current())
	}
	m.mu.RLock()
	timeout := m.defaultTimeout
	m.mu.RUnlock()
	now := time.Now()
	r := &Workspace{
		ID: newID(), Name: name, Template: name, CreatedAt: now,
		ws: ws, frameAncestors: m.frameAncestors, canLead: m.canLead,
		timeoutSecs: timeout, lastActive: now,
		visibleTabTypes: m.visibleTabTypes,
	}
	m.register(r)
	return r
}

// Create opens a new workspace rooted at the given path. The path is expanded (~),
// absolutised, symlink-resolved, and validated against the manager's allowed root
// (rejecting $HOME, /, dotfile dirs, and traversal) before being adopted.
func (m *Manager) Create(name, root string) (*Workspace, error) {
	abs, err := folder.ValidateRoot(root, m.allowedRoot)
	if err != nil {
		return nil, err
	}
	ws := folder.New(abs)
	if !ws.HasWorkspace() {
		return nil, fmt.Errorf("invalid workspace path: %s", abs)
	}
	if name == "" {
		name = filepath.Base(abs)
	}
	m.mu.RLock()
	timeout := m.defaultTimeout
	m.mu.RUnlock()
	now := time.Now()
	r := &Workspace{
		ID: newID(), Name: name, Template: "custom", CreatedAt: now,
		ws: ws, frameAncestors: m.frameAncestors, canLead: m.canLead,
		timeoutSecs: timeout, lastActive: now,
		visibleTabTypes: m.visibleTabTypes,
	}
	m.register(r)
	return r, nil
}

// CreateFromTemplate instantiates a configured template as a new active
// session. An empty session name defaults to the template name, with a numeric
// suffix if that name is already in use.
func (m *Manager) CreateFromTemplate(templateName, sessionName string) (*Workspace, error) {
	m.mu.RLock()
	tpl, ok := m.templates[templateName]
	timeout := m.defaultTimeout
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown workspace template %q", templateName)
	}
	if tpl.TimeoutSecs >= 0 {
		timeout = tpl.TimeoutSecs
	}
	abs, err := filepath.Abs(tpl.Path)
	if err != nil {
		return nil, fmt.Errorf("resolve template path: %w", err)
	}
	ws := folder.New(abs)
	if !ws.HasWorkspace() {
		return nil, fmt.Errorf("invalid workspace path: %s", abs)
	}
	name := sanitizeSessionName(sessionName)
	if name == "" {
		name = templateName
	}
	name = m.uniqueSessionName(name)
	now := time.Now()
	r := &Workspace{
		ID: newID(), Name: name, Template: templateName, CreatedAt: now,
		ws: ws, frameAncestors: m.frameAncestors, canLead: m.canLead,
		timeoutSecs: timeout, lastActive: now,
		visibleTabTypes: tpl.VisibleTabTypes,
	}
	m.register(r)
	return r, nil
}

func sanitizeSessionName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Join(strings.Fields(name), " ")
	if len(name) > 48 {
		name = name[:48]
	}
	return name
}

func (m *Manager) uniqueSessionName(base string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	used := make(map[string]bool, len(m.workspaces))
	for _, r := range m.workspaces {
		used[r.Name] = true
	}
	if !used[base] {
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if !used[candidate] {
			return candidate
		}
	}
}

// Get returns the workspace with the given id.
func (m *Manager) Get(id string) (*Workspace, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	r, ok := m.workspaces[id]
	return r, ok
}

// List returns workspaces in creation order.
func (m *Manager) List() []*Workspace {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Workspace, 0, len(m.order))
	for _, id := range m.order {
		if r, ok := m.workspaces[id]; ok {
			out = append(out, r)
		}
	}
	return out
}

// Sessions returns a snapshot of active sessions in creation order.
func (m *Manager) Sessions() []SessionInfo {
	m.mu.RLock()
	list := make([]*Workspace, 0, len(m.order))
	for _, id := range m.order {
		if r, ok := m.workspaces[id]; ok {
			list = append(list, r)
		}
	}
	m.mu.RUnlock()
	now := time.Now()
	out := make([]SessionInfo, 0, len(list))
	for _, r := range list {
		out = append(out, SessionInfo{
			ID: r.ID, Name: r.Name, Template: r.Template, Root: r.Root(),
			Users: r.Users(), AgeSecs: int64(now.Sub(r.CreatedAt).Seconds()),
			TimeoutSecs: r.timeoutSecs, CreatedAt: r.CreatedAt,
		})
	}
	return out
}

// StartJanitor periodically closes idle sessions. A session with connected
// users never expires; after the last user leaves, its timeout clock starts.
func (m *Manager) StartJanitor(interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for now := range t.C {
			m.CloseIdle(now)
		}
	}()
}

// CloseIdle closes every session that has been empty longer than its timeout.
// It is exported for deterministic tests.
func (m *Manager) CloseIdle(now time.Time) []string {
	m.mu.Lock()
	var closed []string
	var workspaces []*Workspace
	for id, r := range m.workspaces {
		if r.shouldExpire(now) {
			workspaces = append(workspaces, r)
			closed = append(closed, id)
			delete(m.workspaces, id)
		}
	}
	if len(closed) > 0 {
		closedSet := make(map[string]bool, len(closed))
		for _, id := range closed {
			closedSet[id] = true
		}
		next := m.order[:0]
		for _, id := range m.order {
			if !closedSet[id] {
				next = append(next, id)
			}
		}
		m.order = next
	}
	m.mu.Unlock()
	for _, r := range workspaces {
		r.shutdown()
	}
	return closed
}

// Close removes a workspace from the manager and tears down its long-lived
// subsystems (currently the filewatcher; terminal/lsp join as they are scoped).
func (m *Manager) Close(id string) bool {
	m.mu.Lock()
	r, ok := m.workspaces[id]
	if !ok {
		m.mu.Unlock()
		return false
	}
	delete(m.workspaces, id)
	for i, oid := range m.order {
		if oid == id {
			m.order = append(m.order[:i], m.order[i+1:]...)
			break
		}
	}
	m.mu.Unlock()

	// Tear down outside the manager lock so subsystem shutdown can't block other
	// workspace operations.
	r.shutdown()
	return true
}
