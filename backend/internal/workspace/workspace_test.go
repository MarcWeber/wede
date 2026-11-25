package workspace

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"wede/backend/internal/auth"
	"wede/backend/internal/folder"
)

func TestCreateAndIsolation(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()

	m := NewManager("", "")
	a, err := m.Create("alpha", dirA)
	if err != nil {
		t.Fatalf("create alpha: %v", err)
	}
	b, err := m.Create("", dirB) // empty name -> base of path
	if err != nil {
		t.Fatalf("create beta: %v", err)
	}

	if a.ID == b.ID {
		t.Fatal("expected distinct workspace ids")
	}
	if a.Root() == b.Root() {
		t.Fatalf("expected distinct roots, both %q", a.Root())
	}
	if a.Name != "alpha" {
		t.Errorf("name = %q, want alpha", a.Name)
	}
	if b.Name == "" {
		t.Error("empty name should default to path base")
	}

	// Mutating one workspace's workspace must not affect the other.
	if a.Root() == b.Root() {
		t.Fatal("workspaces share a root — not isolated")
	}
}

// TestCrossRoomConfinement proves that each workspace's file operations are jailed to
// its own root: workspace A cannot reach workspace B's files via path traversal, because
// A's files handler is bound to A's root-pinned workspace and safePath rejects
// any path that escapes it.
func TestCrossRoomConfinement(t *testing.T) {
	parent := t.TempDir()
	dirA := filepath.Join(parent, "roomA")
	dirB := filepath.Join(parent, "roomB")
	if err := os.Mkdir(dirA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(dirB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dirB, "secret.txt"), []byte("top secret"), 0o644); err != nil {
		t.Fatal(err)
	}

	m := NewManager("", "")
	a, _ := m.Create("A", dirA)
	b, _ := m.Create("B", dirB)

	// Attempt to list workspace B's directory from workspace A via "../roomB" traversal.
	traversal := "../" + filepath.Base(dirB)
	req := httptest.NewRequest(http.MethodGet, "/?path="+url.QueryEscape(traversal), nil)
	rec := httptest.NewRecorder()
	a.Files().List(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-workspace traversal: got %d (%s), want 403", rec.Code, rec.Body.String())
	}

	// Sanity: workspace B can legitimately list its own root (so the 403 above is the
	// confinement check firing, not an unrelated failure).
	reqB := httptest.NewRequest(http.MethodGet, "/?path=", nil)
	recB := httptest.NewRecorder()
	b.Files().List(recB, reqB)
	if recB.Code != http.StatusOK {
		t.Fatalf("workspace B listing own root: got %d (%s), want 200", recB.Code, recB.Body.String())
	}
}

func TestCreateRejectsBadPath(t *testing.T) {
	m := NewManager("", "")
	if _, err := m.Create("x", "/no/such/path/wede-test"); err == nil {
		t.Fatal("expected error for non-existent path")
	}
}

func TestGetListClose(t *testing.T) {
	m := NewManager("", "")
	r1, _ := m.Create("one", t.TempDir())
	r2, _ := m.Create("two", t.TempDir())

	if got, ok := m.Get(r1.ID); !ok || got.ID != r1.ID {
		t.Fatalf("Get(%s) failed", r1.ID)
	}
	if _, ok := m.Get("missing"); ok {
		t.Fatal("Get(missing) should fail")
	}

	list := m.List()
	if len(list) != 2 {
		t.Fatalf("List len = %d, want 2", len(list))
	}
	if list[0].ID != r1.ID || list[1].ID != r2.ID {
		t.Error("List did not preserve creation order")
	}

	if !m.Close(r1.ID) {
		t.Fatal("Close(r1) returned false")
	}
	if m.Close(r1.ID) {
		t.Fatal("double Close should return false")
	}
	if len(m.List()) != 1 {
		t.Fatalf("after close, List len = %d, want 1", len(m.List()))
	}
}

func TestLazyHandlersAreStable(t *testing.T) {
	m := NewManager("", "")
	r, _ := m.Create("x", t.TempDir())

	if r.Files() != r.Files() {
		t.Error("Files() should return a stable instance")
	}
	if r.Git() != r.Git() {
		t.Error("Git() should return a stable instance")
	}
	if r.Search() != r.Search() {
		t.Error("Search() should return a stable instance")
	}
	if r.Terminal() != r.Terminal() {
		t.Error("Terminal() should return a stable instance")
	}
	if r.LSP() != r.LSP() {
		t.Error("LSP() should return a stable instance")
	}
}

func TestWatcherLifecycle(t *testing.T) {
	m := NewManager("", "")
	r, _ := m.Create("x", t.TempDir())

	w := r.Watcher()
	if w == nil {
		t.Fatal("Watcher() returned nil")
	}
	if r.Watcher() != w {
		t.Error("Watcher() should return a stable instance")
	}

	// Bring up terminal + lsp handlers (no PTY/process spawned until a WS
	// connects) so Close exercises their teardown paths too.
	_ = r.Terminal()
	_ = r.LSP()

	// Close tears the workspace down (watcher + terminal + lsp) without panicking,
	// and the workspace is gone from the manager afterward.
	if !m.Close(r.ID) {
		t.Fatal("Close returned false")
	}
	if _, ok := m.Get(r.ID); ok {
		t.Error("workspace still present after Close")
	}
}

func TestScopedDispatch(t *testing.T) {
	m := NewManager("", "")
	r, _ := m.Create("x", t.TempDir())

	called := false
	h := m.Scoped(func(rm *Workspace) http.HandlerFunc {
		return func(w http.ResponseWriter, _ *http.Request) {
			if rm.ID != r.ID {
				t.Errorf("dispatched to wrong workspace: %s", rm.ID)
			}
			called = true
			w.WriteHeader(http.StatusOK)
		}
	})

	// Found: dispatches to the picked handler.
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+r.ID+"/files", nil)
	req.SetPathValue("id", r.ID)
	rec := httptest.NewRecorder()
	h(rec, req)
	if !called {
		t.Fatal("scoped handler was not invoked for existing workspace")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}

	// Missing: 404, picked handler never runs.
	called = false
	req2 := httptest.NewRequest(http.MethodGet, "/api/workspaces/missing/files", nil)
	req2.SetPathValue("id", "missing")
	rec2 := httptest.NewRecorder()
	h(rec2, req2)
	if called {
		t.Error("scoped handler ran for a missing workspace")
	}
	if rec2.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec2.Code)
	}
}

func TestRegisterAdoptsWorkspace(t *testing.T) {
	dir := t.TempDir()
	ws := folder.New(dir)
	m := NewManager("", "")
	r := m.Register("seeded", ws)

	if r.Root() != ws.Current() {
		t.Errorf("adopted root = %q, want %q", r.Root(), ws.Current())
	}
	if r.Folder() != ws {
		t.Error("Register should adopt the exact workspace instance")
	}
}

func TestCreateFromTemplateAndSessionList(t *testing.T) {
	dir := t.TempDir()
	m := NewManager("", "")
	m.SetTemplates(map[string]Template{
		"lab": {Name: "lab", Path: dir, TimeoutSecs: 600},
	})
	r, err := m.CreateFromTemplate("lab", "")
	if err != nil {
		t.Fatalf("CreateFromTemplate: %v", err)
	}
	if r.Name != "lab" || r.Template != "lab" || r.Root() != dir {
		t.Fatalf("session = %+v root=%s", r, r.Root())
	}
	r2, err := m.CreateFromTemplate("lab", "lab")
	if err != nil {
		t.Fatalf("CreateFromTemplate duplicate: %v", err)
	}
	if r2.Name == "lab" {
		t.Errorf("duplicate session name was not made unique: %q", r2.Name)
	}
	sessions := m.Sessions()
	if len(sessions) != 2 {
		t.Fatalf("sessions = %d, want 2", len(sessions))
	}
	if sessions[0].Template != "lab" || sessions[0].TimeoutSecs != 600 {
		t.Errorf("session info = %+v", sessions[0])
	}
	if _, err := m.CreateFromTemplate("missing", ""); err == nil {
		t.Fatal("expected unknown template error")
	}
}

func TestHandleSessionCreateEnforcesVisibleUsers(t *testing.T) {
	m := NewManager("", "")
	m.SetTemplates(map[string]Template{
		"private": {Name: "private", Path: t.TempDir(), TimeoutSecs: 600, Lock: "users", VisibleTo: []string{"alice"}},
	})

	authHandler := auth.NewWithDataDir("test-password", t.TempDir())
	create := func(username string) *httptest.ResponseRecorder {
		loginBody := bytes.NewBufferString(`{"username":"` + username + `","password":"test-password"}`)
		loginResponse := httptest.NewRecorder()
		authHandler.Login(loginResponse, httptest.NewRequest(http.MethodPost, "/api/auth/login", loginBody))
		var result struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(loginResponse.Body.Bytes(), &result); err != nil || result.Token == "" {
			t.Fatalf("login token missing for %s: response=%s err=%v", username, loginResponse.Body.String(), err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/sessions", bytes.NewBufferString(`{"template":"private"}`))
		req.Header.Set("Authorization", result.Token)
		rec := httptest.NewRecorder()
		authHandler.Middleware(http.HandlerFunc(m.HandleSessionCreate)).ServeHTTP(rec, req)
		return rec
	}
	allowed := create("alice")
	if allowed.Code != http.StatusCreated {
		t.Fatalf("listed user creation status = %d, want 201 (%s)", allowed.Code, allowed.Body.String())
	}
	denied := create("bob")
	if denied.Code != http.StatusForbidden {
		t.Fatalf("unlisted user creation status = %d, want 403 (%s)", denied.Code, denied.Body.String())
	}
}

func TestGuestAccessIsScopedAndUsesConfiguredRole(t *testing.T) {
	m := NewManager("", "")
	m.SetTemplates(map[string]Template{
		"public":  {Name: "public", Path: t.TempDir(), Lock: "anon-ro"},
		"private": {Name: "private", Path: t.TempDir(), Lock: "closed"},
	})
	publicSession, err := m.CreateFromTemplate("public", "")
	if err != nil {
		t.Fatalf("create public session: %v", err)
	}
	privateSession, err := m.CreateFromTemplate("private", "")
	if err != nil {
		t.Fatalf("create private session: %v", err)
	}

	authHandler := auth.NewWithDataDir("", t.TempDir())
	token := authHandler.NewGuestSession(publicSession.ID, auth.RoleViewer)
	if token == "" {
		t.Fatal("guest session token was empty")
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	handler := authHandler.Middleware(m.AccessControl(next))

	allowed := httptest.NewRecorder()
	allowedReq := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+publicSession.ID+"/files", nil)
	allowedReq.Header.Set("Authorization", token)
	handler.ServeHTTP(allowed, allowedReq)
	if allowed.Code != http.StatusNoContent {
		t.Fatalf("guest public workspace status = %d, want 204", allowed.Code)
	}

	denied := httptest.NewRecorder()
	deniedReq := httptest.NewRequest(http.MethodGet, "/api/workspaces/"+privateSession.ID+"/files", nil)
	deniedReq.Header.Set("Authorization", token)
	handler.ServeHTTP(denied, deniedReq)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("guest cross-workspace status = %d, want 403", denied.Code)
	}

	if _, role, err := m.CreateAnonymousSession("public", ""); err != nil || role != auth.RoleViewer {
		t.Fatalf("anon-ro join role = %q, err=%v; want viewer", role, err)
	}
	m.SetTemplates(map[string]Template{"public": {Name: "public", Path: t.TempDir(), Lock: "anon-rw"}})
	if _, role, err := m.CreateAnonymousSession("public", ""); err != nil || role != auth.RoleEditor {
		t.Fatalf("anon-rw join role = %q, err=%v; want editor", role, err)
	}
}

func TestAnonymousTemplateListDoesNotExposePaths(t *testing.T) {
	root := t.TempDir()
	m := NewManager("", "")
	m.SetTemplates(map[string]Template{
		"public":  {Name: "public", Path: root, Lock: "anon-ro"},
		"private": {Name: "private", Path: t.TempDir(), Lock: "closed"},
	})
	rec := httptest.NewRecorder()
	m.HandleAnonymousTemplates(rec, httptest.NewRequest(http.MethodGet, "/api/anonymous/sessions", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("anonymous template list status = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), root) || strings.Contains(rec.Body.String(), "private") {
		t.Fatalf("anonymous template response exposed private data: %s", rec.Body.String())
	}
}

func TestIdleSessionExpiresOnlyAfterLastUserLeaves(t *testing.T) {
	dir := t.TempDir()
	m := NewManager("", "")
	m.SetTemplates(map[string]Template{
		"lab": {Name: "lab", Path: dir, TimeoutSecs: 1},
	})
	r, err := m.CreateFromTemplate("lab", "one")
	if err != nil {
		t.Fatal(err)
	}

	// A connected user keeps it alive regardless of age.
	id, ch := r.Presence().Join("alice")
	defer r.Presence().Leave(id)
	_ = ch
	if got := m.CloseIdle(time.Now().Add(2 * time.Hour)); len(got) != 0 {
		t.Fatalf("occupied session expired: %v", got)
	}

	r.Presence().Leave(id)
	// First empty tick starts the idle clock.
	if got := m.CloseIdle(time.Now()); len(got) != 0 {
		t.Fatalf("expired immediately after leave: %v", got)
	}
	if got := m.CloseIdle(time.Now().Add(2 * time.Second)); len(got) != 1 {
		t.Fatalf("idle session did not expire: %v", got)
	}
	if _, ok := m.Get(r.ID); ok {
		t.Fatal("expired session still registered")
	}
}

func TestZeroTimeoutNeverExpires(t *testing.T) {
	dir := t.TempDir()
	m := NewManager("", "")
	m.SetTemplates(map[string]Template{
		"lab": {Name: "lab", Path: dir, TimeoutSecs: 0},
	})
	r, err := m.CreateFromTemplate("lab", "forever")
	if err != nil {
		t.Fatal(err)
	}
	if got := m.CloseIdle(time.Now().Add(1000 * time.Hour)); len(got) != 0 {
		t.Fatalf("zero-timeout session expired: %v", got)
	}
	if _, ok := m.Get(r.ID); !ok {
		t.Fatal("zero-timeout session disappeared")
	}
}

func TestHandleCreateHonorsCustomDirectoryFlag(t *testing.T) {
	dir := t.TempDir()
	body, _ := json.Marshal(map[string]string{"name": "custom", "path": dir})

	m := NewManager("", "")
	rr := httptest.NewRecorder()
	m.HandleCreate(rr, httptest.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewReader(body)))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("disabled custom dir: status = %d, want 403 (%s)", rr.Code, rr.Body.String())
	}

	m.SetAllowCustomDirectory(true)
	rr = httptest.NewRecorder()
	m.HandleCreate(rr, httptest.NewRequest(http.MethodPost, "/api/workspaces", bytes.NewReader(body)))
	if rr.Code != http.StatusCreated {
		t.Fatalf("enabled custom dir: status = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
}
