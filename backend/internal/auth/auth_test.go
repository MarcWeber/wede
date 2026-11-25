package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// newTestHandler builds a Handler whose state writes to an isolated temp dir, so
// tests never touch the real ~/.wede.
func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	h := New("wede-test-passphrase")
	h.dataDir = t.TempDir()
	h.sessions = make(map[string]sessionEntry) // discard anything loaded from home
	h.tokens = make(map[string]shareToken)     // isolate from real ~/.wede/tokens.json
	h.attempts = make(map[string]clientAttempt)
	return h
}

func TestConfiguredSessionTTLLoadsAndExpiresPersistedSessions(t *testing.T) {
	dir := t.TempDir()
	const token = "session-token-for-ttl-test"
	h := NewWithDataDirAndSessionTTL("test-password", dir, 48*time.Hour)
	h.mu.Lock()
	h.sessions[hashToken(token)] = sessionEntry{
		CreatedAt: time.Now().Add(-30 * time.Hour),
		Username:  "alice",
		Role:      RoleEditor,
	}
	h.saveSessions()
	h.mu.Unlock()

	restored := NewWithDataDirAndSessionTTL("test-password", dir, 48*time.Hour)
	restored.mu.Lock()
	valid := restored.validSession(token)
	restored.mu.Unlock()
	if !valid {
		t.Fatal("session older than 24 hours should survive the configured 48-hour TTL")
	}

	restored.SetSessionTTL(24 * time.Hour)
	restored.mu.Lock()
	valid = restored.validSession(token)
	restored.mu.Unlock()
	if valid {
		t.Fatal("session older than the reloaded 24-hour TTL should expire")
	}
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

func oneTimeLogin(t *testing.T, h *Handler, token, username string) (int, map[string]any) {
	t.Helper()
	body, err := json.Marshal(map[string]string{"login_token": token, "username": username})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	h.Login(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func createOneTimeLoginFile(t *testing.T, dir, token string) string {
	t.Helper()
	path := filepath.Join(dir, oneTimeLoginFilePrefix+token)
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestOneTimeLoginDisabledByDefault(t *testing.T) {
	h := newTestHandler(t)
	dir := t.TempDir()
	token := "wede-zxj9k2m4"
	path := createOneTimeLoginFile(t, dir, token)

	status, _ := oneTimeLogin(t, h, token, "alice")
	if status != http.StatusUnauthorized {
		t.Fatalf("disabled token login status = %d, want 401", status)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("disabled token login changed token file: %v", err)
	}
}

func TestOneTimeLoginRemoveConsumesTokenAndCreatesEditor(t *testing.T) {
	h := newTestHandler(t)
	dir := t.TempDir()
	token := "wede-zxj9k2m4"
	path := createOneTimeLoginFile(t, dir, token)
	h.SetTokenLinkLogin("remove", dir)

	status, out := oneTimeLogin(t, h, token, " alice ")
	if status != http.StatusOK {
		t.Fatalf("token login status = %d, want 200: %v", status, out)
	}
	if out["username"] != "alice" || out["role"] != string(RoleEditor) || out["teacher"] != false {
		t.Errorf("token login response = %+v, want alice/editor/non-teacher", out)
	}
	if got := h.Role(out["token"].(string)); got != RoleEditor {
		t.Errorf("session role = %q, want editor", got)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("consumed token file still exists (stat err = %v)", err)
	}
	if status, _ := oneTimeLogin(t, h, token, "alice"); status != http.StatusUnauthorized {
		t.Errorf("second token login status = %d, want 401", status)
	}
}

func TestOneTimeLoginKeepAllowsReuse(t *testing.T) {
	h := newTestHandler(t)
	dir := t.TempDir()
	token := "wede-zxj9k2m4"
	path := createOneTimeLoginFile(t, dir, token)
	h.SetTokenLinkLogin("keep", dir)

	firstStatus, first := oneTimeLogin(t, h, token, "alice")
	secondStatus, second := oneTimeLogin(t, h, token, "bob")
	if firstStatus != http.StatusOK || secondStatus != http.StatusOK {
		t.Fatalf("keep login statuses = %d, %d; want 200, 200", firstStatus, secondStatus)
	}
	if first["token"] == second["token"] {
		t.Error("reused link should issue distinct session tokens")
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("keep mode removed token file: %v", err)
	}
}

func TestOneTimeLoginTokenStrength(t *testing.T) {
	h := newTestHandler(t)
	dir := t.TempDir()
	h.SetTokenLinkLogin("keep", dir)

	t.Run("accepts minimum length token", func(t *testing.T) {
		token := "wede-zxj9k2m"
		createOneTimeLoginFile(t, dir, token)
		if status, _ := oneTimeLogin(t, h, token, "alice"); status != http.StatusOK {
			t.Fatalf("12-character strong token login status = %d, want 200", status)
		}
	})

	t.Run("rejects common token", func(t *testing.T) {
		token := strings.Repeat("qwerty", 6)
		createOneTimeLoginFile(t, dir, token)
		if status, _ := oneTimeLogin(t, h, token, "alice"); status != http.StatusUnauthorized {
			t.Fatalf("common token login status = %d, want 401", status)
		}
	})

	if validOneTimeLoginToken("wede-zxj9k") {
		t.Error("11-character token should be invalid")
	}
}

func TestCreateOneTimeLoginTokenFile(t *testing.T) {
	dir := t.TempDir()
	token, err := CreateOneTimeLoginTokenFile(dir)
	if err != nil {
		t.Fatalf("CreateOneTimeLoginTokenFile: %v", err)
	}
	if !validOneTimeLoginToken(token) {
		t.Fatalf("generated token does not pass validation: %q", token)
	}
	info, err := os.Stat(filepath.Join(dir, oneTimeLoginFilePrefix+token))
	if err != nil {
		t.Fatalf("stat generated token file: %v", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		t.Errorf("generated file mode = %v, want regular file readable only by owner", info.Mode())
	}
	contents, err := os.ReadFile(filepath.Join(dir, oneTimeLoginFilePrefix+token))
	if err != nil {
		t.Fatalf("read generated token file: %v", err)
	}
	if len(contents) != 0 {
		t.Errorf("generated token file is not empty: %q", contents)
	}
}

func TestOneTimeLoginSharesPasswordLockout(t *testing.T) {
	h := newTestHandler(t)
	h.maxAttempts = 2
	dir := t.TempDir()
	token := "wede-zxj9k2m"
	createOneTimeLoginFile(t, dir, token)
	h.SetTokenLinkLogin("keep", dir)

	if out := login(t, h, "wrong-password", ""); out["error"] != "wrong_password" {
		t.Fatalf("first password failure = %v, want wrong_password", out["error"])
	}
	if status, _ := oneTimeLogin(t, h, "missingtoken1", "alice"); status != http.StatusForbidden {
		t.Fatalf("token failure at shared attempt limit = %d, want 403", status)
	}
	if status, _ := oneTimeLogin(t, h, token, "alice"); status != http.StatusForbidden {
		t.Fatalf("valid token during shared lockout = %d, want 403", status)
	}
	if _, err := os.Stat(filepath.Join(dir, oneTimeLoginFilePrefix+token)); err != nil {
		t.Errorf("locked token login changed token file: %v", err)
	}
}

func TestOneTimeLoginExpiryDate(t *testing.T) {
	now := time.Now()
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	validThroughMinute := now.Add(5 * time.Minute).Format("2006-01-02 15:04")
	expiredMinute := now.Add(-5 * time.Minute).Format("2006-01-02 15:04")

	for _, tc := range []struct {
		name       string
		contents   string
		wantStatus int
	}{
		{name: "today is valid", contents: today, wantStatus: http.StatusOK},
		{name: "future date is valid", contents: tomorrow, wantStatus: http.StatusOK},
		{name: "future date and time is valid", contents: validThroughMinute, wantStatus: http.StatusOK},
		{name: "past date is expired", contents: yesterday, wantStatus: http.StatusUnauthorized},
		{name: "past date and time is expired", contents: expiredMinute, wantStatus: http.StatusUnauthorized},
		{name: "invalid date is rejected", contents: "not-a-date", wantStatus: http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := newTestHandler(t)
			dir := t.TempDir()
			token := "wede-zxj9k2m4"
			path := createOneTimeLoginFile(t, dir, token)
			if err := os.WriteFile(path, []byte(tc.contents+"\n"), 0600); err != nil {
				t.Fatal(err)
			}
			h.SetTokenLinkLogin("keep", dir)

			status, _ := oneTimeLogin(t, h, token, "alice")
			if status != tc.wantStatus {
				t.Fatalf("login status = %d, want %d", status, tc.wantStatus)
			}
		})
	}
}

func TestOneTimeLoginRejectsUnsafeTokenAndTeacherUsername(t *testing.T) {
	h := newTestHandler(t)
	dir := t.TempDir()
	h.SetTokenLinkLogin("keep", dir)
	if status, _ := oneTimeLogin(t, h, "../../etc/passwd", "alice"); status != http.StatusUnauthorized {
		t.Errorf("unsafe token status = %d, want 401", status)
	}

	token := "wede-zxj9k2m4"
	path := createOneTimeLoginFile(t, dir, token)
	h.SetTeachers([]string{"teacher"})
	if status, _ := oneTimeLogin(t, h, token, "teacher"); status != http.StatusUnauthorized {
		t.Errorf("teacher username token login status = %d, want 401", status)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("rejected teacher login consumed token file: %v", err)
	}
}

func TestOneTimeLoginRemoveIsSingleUseUnderConcurrency(t *testing.T) {
	h := newTestHandler(t)
	dir := t.TempDir()
	token := "wede-zxj9k2m4"
	createOneTimeLoginFile(t, dir, token)
	h.SetTokenLinkLogin("remove", dir)

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i := range statuses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			body := `{"login_token":"` + token + `","username":"alice"}`
			req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
			rec := httptest.NewRecorder()
			h.Login(rec, req)
			statuses[i] = rec.Code
		}(i)
	}
	wg.Wait()
	if (statuses[0] == http.StatusOK) == (statuses[1] == http.StatusOK) {
		t.Errorf("concurrent statuses = %v, want exactly one success", statuses)
	}
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

// An old global lockout file must not keep the owner locked out after upgrading
// to per-client lockouts.
func TestLegacyGlobalLockoutIsIgnored(t *testing.T) {
	dir := t.TempDir()
	stale := `{"attempts":3,"locked":true}`
	if err := os.WriteFile(filepath.Join(dir, lockoutFile), []byte(stale), 0600); err != nil {
		t.Fatal(err)
	}

	h := NewWithDataDir("wede-test-passphrase", dir)
	if out := login(t, h, "wede-test-passphrase", ""); out["token"] == nil {
		t.Fatalf("login after legacy lockout failed: %+v", out)
	}
}

func TestLockoutIsPerClientAndExpires(t *testing.T) {
	dir := t.TempDir()
	h := NewWithDataDir("wede-test-passphrase", dir)
	h.lockoutWindow = 20 * time.Millisecond

	for i := 1; i <= defaultMaxAttempts; i++ {
		out := login(t, h, "wrong", "")
		if i < defaultMaxAttempts {
			if out["error"] != "wrong_password" {
				t.Fatalf("attempt %d: error = %v, want wrong_password", i, out["error"])
			}
			continue
		}
		if out["error"] != "locked" {
			t.Fatalf("attempt %d: error = %v, want locked", i, out["error"])
		}
	}

	// A different client address is not affected by this client's failures.
	other := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"password":"wede-test-passphrase"}`))
	other.RemoteAddr = "198.51.100.7:1234"
	rec := httptest.NewRecorder()
	h.Login(rec, other)
	var out map[string]any
	json.NewDecoder(rec.Result().Body).Decode(&out)
	if out["token"] == nil {
		t.Fatalf("different client was locked out: %+v", out)
	}

	// The lock expires on its own; deleting the file also unlocks immediately.
	time.Sleep(30 * time.Millisecond)
	if out := login(t, h, "wede-test-passphrase", ""); out["token"] == nil {
		t.Fatalf("login after lockout expired failed: %+v", out)
	}
}

func TestDeletingLockoutFileUnlocks(t *testing.T) {
	dir := t.TempDir()
	h := NewWithDataDir("wede-test-passphrase", dir)

	for i := 1; i <= defaultMaxAttempts; i++ {
		login(t, h, "wrong", "")
	}

	if err := os.Remove(filepath.Join(dir, lockoutFile)); err != nil {
		t.Fatal(err)
	}
	if out := login(t, h, "wede-test-passphrase", ""); out["token"] == nil {
		t.Fatalf("login after deleting lockout file failed: %+v", out)
	}
}
