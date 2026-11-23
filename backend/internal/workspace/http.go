package workspace

import (
	"encoding/json"
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
		out = append(out, toDTO(rm))
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspaces": out})
}

// HandleSessionsList serves GET /api/sessions: active sessions plus the
// configured templates the login picker offers for new sessions.
// Templates with open_to_anybody=false (default) are filtered: if visible_to
// is non-empty, only listed users see it; if visible_to is empty and
// open_to_anybody is false, the template is hidden from everyone.
// When open_to_anybody=true, the template is visible to all authenticated users.
func (m *Manager) HandleSessionsList(w http.ResponseWriter, r *http.Request) {
	sessions := m.Sessions()
	out := make([]dto, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, toSessionDTO(s))
	}
	username := auth.GetUsername(r)
	allTemplates := m.Templates()
	templates := make([]Template, 0, len(allTemplates))
	for _, t := range allTemplates {
		// If open to anybody, show to all authenticated users.
		if t.OpenToAnybody {
			templates = append(templates, t)
			continue
		}
		// Otherwise, require the user to be in the visible_to list.
		// If visible_to is empty, the workspace is hidden (not open to anybody).
		if len(t.VisibleTo) == 0 {
			continue
		}
		if !slices.Contains(t.VisibleTo, username) {
			continue
		}
		templates = append(templates, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessions":  out,
		"templates": templates,
	})
}

// HandleSessionCreate serves POST /api/sessions with body {template, name?}.
func (m *Manager) HandleSessionCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Template string `json:"template"`
		Name     string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Template == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "template required"})
		return
	}
	rm, err := m.CreateFromTemplate(body.Template, body.Name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, toDTO(rm))
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
	writeJSON(w, http.StatusOK, toDTO(rm))
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
