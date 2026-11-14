package workspace

import (
	"encoding/json"
	"net/http"
	"time"
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
func (m *Manager) HandleSessionsList(w http.ResponseWriter, r *http.Request) {
	sessions := m.Sessions()
	out := make([]dto, 0, len(sessions))
	for _, s := range sessions {
		out = append(out, toSessionDTO(s))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessions":  out,
		"templates": m.Templates(),
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
// legacy path-based creator; it creates a custom session.
func (m *Manager) HandleCreate(w http.ResponseWriter, r *http.Request) {
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
