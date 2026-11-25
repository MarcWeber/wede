package workspace

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"wede/backend/internal/auth"
)

// dto is the JSON shape returned for a running workspace/session.
type dto struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Template    string `json:"template,omitempty"`
	Root        string `json:"root"`
	Users       int    `json:"users"`
	AgeSecs     int64  `json:"age_secs"`
	TimeoutSecs int    `json:"timeout_secs"`
}

func toDTO(r *Workspace) dto {
	return dto{
		ID: r.ID, Name: r.Name, Template: r.Template, Root: r.Root(),
		Users: r.Users(), AgeSecs: ageSecs(r), TimeoutSecs: r.timeoutSecs,
	}
}

func toSessionDTO(s SessionInfo) dto {
	return dto{
		ID: s.ID, Name: s.Name, Template: s.Template, Root: s.Root,
		Users: s.Users, AgeSecs: s.AgeSecs, TimeoutSecs: s.TimeoutSecs,
	}
}

func ageSecs(r *Workspace) int64 {
	return int64(time.Since(r.CreatedAt).Seconds())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// HandleList serves GET /api/workspaces (legacy alias for active sessions).
func (m *Manager) HandleList(w http.ResponseWriter, r *http.Request) {
	workspaces := m.List()
	out := make([]dto, 0, len(workspaces))
	for _, rm := range workspaces {
		if !m.allowsWorkspace(rm.ID, auth.GetUsername(r), auth.IsGuest(r), auth.GetRole(r)) {
			continue
		}
		out = append(out, toDTO(rm))
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": out})
}

// HandleSessionsList serves GET /api/sessions: active sessions plus the
// configured templates the login picker offers for new sessions. Both lists
// apply each template's lock policy; guest sessions only see their own session.
func (m *Manager) HandleSessionsList(w http.ResponseWriter, r *http.Request) {
	sessions := m.Sessions()
	out := make([]dto, 0, len(sessions))
	for _, s := range sessions {
		if auth.IsGuest(r) && s.ID != auth.GuestWorkspaceID(r) {
			continue
		}
		if !m.allowsWorkspace(s.ID, auth.GetUsername(r), auth.IsGuest(r), auth.GetRole(r)) {
			continue
		}
		d := toSessionDTO(s)
		if auth.IsGuest(r) {
			d.Root = s.Name
		}
		out = append(out, d)
	}
	username := auth.GetUsername(r)
	allTemplates := m.Templates()
	templates := make([]Template, 0, len(allTemplates))
	if !auth.IsGuest(r) {
		for _, t := range allTemplates {
			if t.Allows(username, false) {
				templates = append(templates, t)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessions":  out,
		"templates": templates,
	})
}

type anonymousTemplate struct {
	Name string `json:"name"`
	Lock string `json:"lock"`
}

func (t Template) Allows(username string, guest bool) bool {
	if guest {
		return t.Lock == "anon-ro" || t.Lock == "anon-rw"
	}
	switch t.Lock {
	case "users":
		return t.LegacyOpenToAnybody || slices.Contains(t.VisibleTo, username)
	case "anon-ro", "anon-rw":
		return true
	default:
		return false
	}
}

// HandleAnonymousTemplates is the public, deliberately minimal list used by
// the login screen. Paths and session IDs are not exposed before a guest joins.
func (m *Manager) HandleAnonymousTemplates(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	out := make([]anonymousTemplate, 0)
	for _, t := range m.Templates() {
		if t.Lock == "anon-ro" || t.Lock == "anon-rw" {
			out = append(out, anonymousTemplate{Name: t.Name, Lock: t.Lock})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": out})
}

// CreateAnonymousSession creates or reuses a public template session and
// returns the permissions that must be used for the issued guest credential.
func (m *Manager) CreateAnonymousSession(templateName, sessionName string) (*Workspace, auth.Role, error) {
	m.mu.RLock()
	tpl, ok := m.templates[templateName]
	m.mu.RUnlock()
	if !ok || (tpl.Lock != "anon-ro" && tpl.Lock != "anon-rw") {
		return nil, "", errors.New("anonymous access is not enabled for this workspace")
	}
	role := auth.RoleViewer
	if tpl.Lock == "anon-rw" {
		role = auth.RoleEditor
	}
	m.mu.RLock()
	for _, ws := range m.workspaces {
		if ws.Template == templateName {
			m.mu.RUnlock()
			return ws, role, nil
		}
	}
	m.mu.RUnlock()
	ws, err := m.CreateFromTemplate(templateName, sessionName)
	if err != nil {
		return nil, "", err
	}
	return ws, role, nil
}

// HandleSessionCreate serves POST /api/sessions with body {template, name?}.
// If a session for the template already exists, it returns that session instead
// of creating a duplicate — making the call idempotent so two users connecting
// after a server restart both join the same session.
func (m *Manager) HandleSessionCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Template string `json:"template"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Template == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "template required"})
		return
	}
	if !m.templateAllows(body.Template, auth.GetUsername(r), false) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace is not available to this user"})
		return
	}
	// Check if a session for this template already exists — return it instead
	// of creating a duplicate. This prevents two users from creating separate
	// sessions (e.g. "shared" and "shared-2") after a server restart.
	m.mu.RLock()
	for _, ws := range m.workspaces {
		if ws.Template == body.Template {
			rm := ws
			m.mu.RUnlock()
			writeJSON(w, http.StatusOK, toDTO(rm))
			return
		}
	}
	m.mu.RUnlock()

	rm, err := m.CreateFromTemplate(body.Template, body.Name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, toDTO(rm))
}

// AccessControl applies template locks to every workspace-scoped API route and
// prevents guest credentials from crossing their single workspace boundary.
func (m *Manager) AccessControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.IsGuest(r) {
			if r.Method == http.MethodGet && r.URL.Path == "/api/sessions" {
				next.ServeHTTP(w, r)
				return
			}
			id, ok := workspaceIDFromPath(r.URL.Path)
			if ok && id == auth.GuestWorkspaceID(r) && m.allowsWorkspace(id, auth.GetUsername(r), true, auth.GetRole(r)) {
				next.ServeHTTP(w, r)
				return
			}
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "guest access is limited to its public workspace"})
			return
		}
		if id, ok := workspaceIDFromPath(r.URL.Path); ok && !m.allowsWorkspace(id, auth.GetUsername(r), false, auth.GetRole(r)) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace is not available to this user"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/sessions/") {
			id := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
			if id != "" && strings.IndexByte(id, '/') < 0 && !m.allowsWorkspace(id, auth.GetUsername(r), false, auth.GetRole(r)) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "workspace is not available to this user"})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func workspaceIDFromPath(path string) (string, bool) {
	const prefix = "/api/workspaces/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	tail := strings.TrimPrefix(path, prefix)
	id, _, _ := strings.Cut(tail, "/")
	return id, id != ""
}

func (m *Manager) templateAllows(name, username string, guest bool) bool {
	m.mu.RLock()
	tpl, ok := m.templates[name]
	m.mu.RUnlock()
	if !ok {
		return !guest
	}
	return tpl.Allows(username, guest)
}

func (m *Manager) allowsWorkspace(id, username string, guest bool, role auth.Role) bool {
	ws, ok := m.Get(id)
	if !ok {
		return false
	}
	m.mu.RLock()
	tpl, exists := m.templates[ws.Template]
	m.mu.RUnlock()
	if !exists {
		return !guest
	}
	if !tpl.Allows(username, guest) {
		return false
	}
	return !guest || tpl.Lock != "anon-ro" || !role.CanMutate()
}

// HandleSessionClose serves DELETE /api/sessions/{id}.
func (m *Manager) HandleSessionClose(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !m.Close(id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}

// HandleCreate serves POST /api/workspaces with body {name?, path}. This is the
// legacy path-based creator; it creates a custom session when the deployment
// allows custom directories.
func (m *Manager) HandleCreate(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	allow := m.allowCustomDir
	m.mu.RUnlock()
	if !allow {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "custom workspace directories are disabled"})
		return
	}
	var body struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path required"})
		return
	}
	rm, err := m.Create(body.Name, body.Path)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, toDTO(rm))
}

// HandleTabSessionList serves GET /api/workspaces/{id}/tab_sessions?context=&dir=
// For connected members it also returns the username and open tabs from the
// presence roster so the UI can show who has which file open.
func (m *Manager) HandleTabSessionList(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	store := m.TabSessions()
	if store == nil {
		writeJSON(w, http.StatusOK, map[string]any{"tab_sessions": []any{}})
		return
	}
	ctx := r.URL.Query().Get("context")
	key := tabStateKey(id, ctx, r.URL.Query().Get("dir"))
	// Build a richer map from the presence roster for connected members.
	type memberInfo struct {
		username string
		tabs     []string
	}
	connectedInfo := map[string]memberInfo{}
	if rm, ok := m.Get(id); ok {
		for _, member := range rm.Presence().Roster() {
			if member.TabViewState == "" {
				continue
			}
			if ctx != "" && member.CollabContext != "" && member.CollabContext != ctx {
				continue
			}
			connectedInfo[member.TabViewState] = memberInfo{
				username: member.Username,
				tabs:     member.Tabs,
			}
		}
	}
	users := store.List(key)
	out := make([]map[string]any, 0, len(users))
	for _, u := range users {
		if st := store.Get(key, u); st != nil {
			info, ok := connectedInfo[st.Name]
			entry := map[string]any{
				"name":       st.Name,
				"updated_at": st.UpdatedAt,
				"data":       st.Data,
				"connected":  ok,
			}
			if ok {
				entry["username"] = info.username
				entry["tabs"] = info.tabs
			}
			out = append(out, entry)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tab_sessions": out})
}

// HandleTabSessionGet serves GET /api/workspaces/{id}/tab_sessions/{name}?context=&dir=
func (m *Manager) HandleTabSessionGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	store := m.TabSessions()
	if store == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tab session not found"})
		return
	}
	key := tabStateKey(id, r.URL.Query().Get("context"), r.URL.Query().Get("dir"))
	st := store.Get(key, name)
	if st == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tab session not found"})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// HandleTabSessionPut serves PUT /api/workspaces/{id}/tab_sessions/{name}?context=&dir=
// Only the session owner may update their tab view state — another user cannot
// overwrite a peer's layout.
// After saving, it broadcasts the updated file-tab list to all connected peers
// so the SessionTabs panel refreshes in real time.
func (m *Manager) HandleTabSessionPut(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	if strings.TrimSpace(name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name required"})
		return
	}
	username := auth.GetUsername(r)
	if !strings.HasPrefix(name, "user:"+username+":") {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not your session"})
		return
	}
	var body json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json body"})
		return
	}
	store := m.TabSessions()
	if store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "tab sessions disabled"})
		return
	}
	key := tabStateKey(id, r.URL.Query().Get("context"), r.URL.Query().Get("dir"))
	st := store.Put(key, name, body)

	// Broadcast the updated file-tab list to connected peers so SessionTabs
	// refreshes in real time without waiting for the client WebSocket message.
	if tabs := extractFileTabs(body); len(tabs) > 0 {
		if rm, ok := m.Get(id); ok {
			hub := rm.Presence()
			for _, member := range hub.Roster() {
				if member.TabViewState == name {
					hub.UpdateTabs(member.ID, tabs)
					break
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, st)
}

// extractFileTabs parses the opaque tab_view_state JSON body and returns the
// relative paths of file tabs (tabs without a type field). The body shape is
// {data: {tabs: [{rel, type?}, ...]}}.
func extractFileTabs(body json.RawMessage) []string {
	var outer struct {
		Data struct {
			Tabs []struct {
				Rel  string `json:"rel"`
				Type string `json:"type"`
			} `json:"tabs"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &outer); err != nil {
		return nil
	}
	var out []string
	for _, t := range outer.Data.Tabs {
		if t.Rel != "" && t.Type == "" {
			out = append(out, t.Rel)
		}
	}
	return out
}

// HandleTabSessionDelete serves DELETE /api/workspaces/{id}/tab_sessions/{name}?context=&dir=
// Only the session owner may delete their tab view state — another user cannot
// close a peer's session.
func (m *Manager) HandleTabSessionDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	name := r.PathValue("name")
	username := auth.GetUsername(r)
	if !strings.HasPrefix(name, "user:"+username+":") {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not your session"})
		return
	}
	store := m.TabSessions()
	if store == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "gone"})
		return
	}
	ctx := r.URL.Query().Get("context")
	key := tabStateKey(id, ctx, r.URL.Query().Get("dir"))
	store.Delete(key, name)
	if rm, ok := m.Get(id); ok {
		rm.Presence().KickTabViewState(ctx, name)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Scoped adapts a per-workspace handler into an http.HandlerFunc registered under a
// path containing the {id} wildcard. It resolves the workspace from the path, returns
// 404 if the workspace does not exist, and otherwise invokes the selected handler.
func (m *Manager) Scoped(pick func(*Workspace) http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		rm, ok := m.Get(id)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
			return
		}
		pick(rm)(w, r)
	}
}

// HandleGet serves GET /api/workspaces/{id}.
func (m *Manager) HandleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rm, ok := m.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
		return
	}
	d := toDTO(rm)
	if auth.IsGuest(r) {
		d.Root = rm.Name
	}
	writeJSON(w, http.StatusOK, d)
}

// HandleClose serves DELETE /api/workspaces/{id}.
func (m *Manager) HandleClose(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !m.Close(id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "workspace not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "closed"})
}
