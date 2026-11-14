package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestHandler builds a Handler whose state writes to an isolated temp dir, so
// tests never touch the real ~/.wede.
func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	h := New("wede-test-passphrase")
	h.dataDir = t.TempDir()
	h.sessions = make(map[string]sessionEntry) // discard anything loaded from home
	h.tokens = make(map[string]shareToken)     // isolate from real ~/.wede/tokens.json
	h.attempts = 0
	h.locked = false
	return h
}

func login(t *testing.T, h *Handler, password, username string) map[string]any {
	t.Helper()
	body := `{"password":"` + password + `","username":"` + username + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	var out map[string]any
	json.NewDecoder(rec.Result().Body).Decode(&out)
	return out
}

func TestLoginStoresAndReturnsUsername(t *testing.T) {
	h := newTestHandler(t)
	out := login(t, h, "wede-test-passphrase", "alice")

	token, _ := out["token"].(string)
	if token == "" {
		t.Fatalf("no token returned: %+v", out)
	}
	if out["username"] != "alice" {
		t.Errorf("login username = %v, want alice", out["username"])
	}

	// Check echoes the username for the valid session.
	req := httptest.NewRequest(http.MethodGet, "/api/auth/check", nil)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	h.Check(rec, req)
	var chk map[string]any
	json.NewDecoder(rec.Result().Body).Decode(&chk)
	if chk["authenticated"] != true {
		t.Errorf("authenticated = %v, want true", chk["authenticated"])
	}
	if chk["username"] != "alice" {
		t.Errorf("check username = %v, want alice", chk["username"])
	}

	// Username() helper resolves the same.
	if got := h.Username(token); got != "alice" {
		t.Errorf("Username() = %q, want alice", got)
	}
}

func TestLoginWithoutUsernameIsEmpty(t *testing.T) {
	h := newTestHandler(t)
	out := login(t, h, "wede-test-passphrase", "")
	if out["username"] != "" {
		t.Errorf("username = %v, want empty", out["username"])
	}
	if out["token"] == "" {
		t.Error("expected a token even without username")
	}
}

func TestUsernameIsTrimmedAndCapped(t *testing.T) {
	h := newTestHandler(t)
	long := strings.Repeat("x", 50)
	out := login(t, h, "wede-test-passphrase", "  "+long+"  ")
	got, _ := out["username"].(string)
	if len(got) != maxUsernameLen {
		t.Errorf("username len = %d, want %d (capped)", len(got), maxUsernameLen)
	}
}

func TestSetUsernameUpdatesSession(t *testing.T) {
	h := newTestHandler(t)
	out := login(t, h, "wede-test-passphrase", "alice")
	token := out["token"].(string)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/username", strings.NewReader(`{"username":"alice2"}`))
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	h.SetUsername(rec, req)

	if h.Username(token) != "alice2" {
		t.Errorf("after SetUsername, Username() = %q, want alice2", h.Username(token))
	}
}

func TestSetUsernameRejectsUnknownToken(t *testing.T) {
	h := newTestHandler(t)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/username", strings.NewReader(`{"username":"x"}`))
	req.Header.Set("Authorization", "bogus")
	rec := httptest.NewRecorder()
	h.SetUsername(rec, req)
	if rec.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Result().StatusCode)
	}
}

func TestLoginUsesConfiguredUsers(t *testing.T) {
	h := newTestHandler(t)
	h.SetUsers(map[string]string{"alice": "a-pass", "bob": "sha256:96269289f71e7bd4b2fbd9034983bfcdc71080a598f07551e6cbe6dca133af9f"})
	h.SetTeachers([]string{"alice"})

	out := login(t, h, "a-pass", "alice")
	if out["token"] == "" {
		t.Fatalf("alice login failed: %+v", out)
	}
	if out["teacher"] != true {
		t.Errorf("alice teacher = %v, want true", out["teacher"])
	}
	if out["username"] != "alice" {
		t.Errorf("username = %v", out["username"])
	}

	// bob's value is sha256("wede-test-passphrase").
	if out := login(t, h, "wede-test-passphrase", "bob"); out["token"] == "" {
		t.Fatalf("bob sha256 login failed: %+v", out)
	}
	if out := login(t, h, "wrong", "alice"); out["token"] != nil {
		t.Fatalf("alice accepted wrong password: %+v", out)
	}
	if out := login(t, h, "a-pass", "carol"); out["token"] != nil {
		t.Fatalf("unknown user accepted: %+v", out)
	}
}

func TestSetUsernameRejectedWhenUsersConfigured(t *testing.T) {
	h := newTestHandler(t)
	h.SetUsers(map[string]string{"alice": "a-pass"})
	out := login(t, h, "a-pass", "alice")
	token := out["token"].(string)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/username", strings.NewReader(`{"username":"teacher"}`))
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	h.SetUsername(rec, req)
	if rec.Result().StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Result().StatusCode)
	}
	if h.Username(token) != "alice" {
		t.Errorf("username changed despite fixed config users: %q", h.Username(token))
	}
}

func TestSetUsersRevokesRemovedUserSessions(t *testing.T) {
	h := newTestHandler(t)
	h.SetUsers(map[string]string{"alice": "a-pass", "bob": "b-pass"})
	alice := login(t, h, "a-pass", "alice")["token"].(string)
	bob := login(t, h, "b-pass", "bob")["token"].(string)

	h.SetUsers(map[string]string{"alice": "a-pass"})
	if h.Username(bob) != "" {
		t.Error("bob's session should be revoked")
	}
	if h.Username(alice) != "alice" {
		t.Error("alice's session should survive")
	}
}
