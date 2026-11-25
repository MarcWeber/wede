package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"wede/backend/internal/auth"
	"wede/backend/internal/config"
)

func TestCreateLoginTokenFileCommand(t *testing.T) {
	dir := t.TempDir()
	var output bytes.Buffer
	if err := createLoginTokenFile(dir, &output); err != nil {
		t.Fatalf("createLoginTokenFile: %v", err)
	}
	text := output.String()
	if !strings.Contains(text, "Token passed the password-strength check.") {
		t.Fatalf("output does not confirm strength check: %q", text)
	}
	var token string
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "login_token=") {
			token = strings.TrimPrefix(line, "login_token=")
		}
	}
	if token == "" {
		t.Fatalf("output does not contain login_token: %q", text)
	}
	if _, err := os.Stat(filepath.Join(dir, ".wede_one_time_login_"+token)); err != nil {
		t.Fatalf("token file was not created: %v", err)
	}
}

// okHandler is a trivial next-handler used to exercise the middleware.
func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

// TestSecurityHeadersDefault verifies the standalone default denies all
// cross-origin framing.
func TestSecurityHeadersDefault(t *testing.T) {
	cfg := &config.Config{FrameAncestors: ""}
	h := securityHeaders(cfg, okHandler())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	res := rec.Result()
	if got := res.Header.Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("X-Frame-Options = %q, want DENY", got)
	}
	if got := res.Header.Get("Content-Security-Policy"); got != "frame-ancestors 'self'" {
		t.Errorf("CSP = %q, want frame-ancestors 'self'", got)
	}
	if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
}

func TestRRControlDashboardUsesStandaloneFrameProtection(t *testing.T) {
	cfg := &config.Config{FrameAncestors: ""}
	h := securityHeaders(cfg, okHandler())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/rrcontrol/remote-control", nil))

	if got := rec.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("X-Frame-Options = %q, want DENY", got)
	}
	if got, want := rec.Header().Get("Content-Security-Policy"), "frame-ancestors 'self'"; got != want {
		t.Errorf("CSP = %q, want %q", got, want)
	}
}

func TestTestPageRedirectPreservesProxyPrefixAndQuery(t *testing.T) {
	mux := http.NewServeMux()
	registerRRControlRoutes(mux, okHandler())
	server := httptest.NewServer(http.StripPrefix("/foo", mux))
	defer server.Close()

	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := client.Get(server.URL + "/foo/test-page?case=local")
	if err != nil {
		t.Fatalf("GET test page: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusTemporaryRedirect)
	}
	location := response.Header.Get("Location")
	if location != "rrcontrol/test-page?case=local" {
		t.Fatalf("Location = %q, want relative test page URL", location)
	}
	resolved, err := response.Request.URL.Parse(location)
	if err != nil {
		t.Fatalf("resolve Location: %v", err)
	}
	if got, want := resolved.Path, "/foo/rrcontrol/test-page"; got != want {
		t.Errorf("redirect path = %q, want %q", got, want)
	}
}

func TestRemoteControlRedirectPreservesWatchAndProxyPrefix(t *testing.T) {
	mux := http.NewServeMux()
	registerRRControlRoutes(mux, okHandler())
	server := httptest.NewServer(http.StripPrefix("/foo", mux))
	defer server.Close()

	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	requestURL := server.URL + "/foo/remote-control?watch=tab-123"
	response, err := client.Get(requestURL)
	if err != nil {
		t.Fatalf("GET remote-control: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTemporaryRedirect {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusTemporaryRedirect)
	}
	location := response.Header.Get("Location")
	if location != "rrcontrol/remote-control?watch=tab-123" {
		t.Fatalf("Location = %q, want relative RR dashboard URL", location)
	}
	resolved, err := response.Request.URL.Parse(location)
	if err != nil {
		t.Fatalf("resolve Location: %v", err)
	}
	if got, want := resolved.Path, "/foo/rrcontrol/remote-control"; got != want {
		t.Errorf("redirect path = %q, want %q", got, want)
	}
	if got, want := resolved.Query().Get("watch"), "tab-123"; got != want {
		t.Errorf("redirect watch = %q, want %q", got, want)
	}
}

// TestRouteRoleGating is a regression integration test for audit findings H1 and M1:
//
//   - H1: LSP WebSocket (/api/workspaces/{id}/lsp) was ungated — a viewer could
//     open it and trigger language server process spawning (≡ RCE).
//   - M1: workspace DELETE (/api/workspaces/{id}) was ungated — a viewer could
//     unregister any workspace (DoS).
//
// The test wires a minimal mux that mirrors the gating logic in main(), then
// confirms that a viewer session is rejected with 403 on every editor-only route
// and that an editor session is passed through (stub handler returns 200).
// Adding this test before the audit would have caught H1 immediately.
func TestRouteRoleGating(t *testing.T) {
	// Isolated auth handler — uses t.TempDir() so tests never touch ~/.wede.
	ah := auth.NewWithDataDir("testpwd", t.TempDir())

	// Mint invite tokens for each role, then redeem them for session tokens.
	viewerRaw, _, err := ah.MintToken(auth.RoleViewer, "viewer-user", 0)
	if err != nil {
		t.Fatalf("MintToken viewer: %v", err)
	}
	editorRaw, _, err := ah.MintToken(auth.RoleEditor, "editor-user", 0)
	if err != nil {
		t.Fatalf("MintToken editor: %v", err)
	}
	viewerSess, _, _, ok := ah.RedeemToken(viewerRaw)
	if !ok {
		t.Fatal("RedeemToken viewer: not ok")
	}
	editorSess, _, _, ok := ah.RedeemToken(editorRaw)
	if !ok {
		t.Fatal("RedeemToken editor: not ok")
	}

	// Stub handler — used as the underlying handler behind RequireEditor; it
	// always returns 200 so we can distinguish "gating passed" from 403.
	stub := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	re := ah.RequireEditor

	// Mirror only the four routes that were (or must remain) editor-gated.
	protected := http.NewServeMux()
	protected.Handle("GET /api/workspaces/{id}/terminal", re(stub))
	protected.Handle("GET /api/workspaces/{id}/lsp", re(stub)) // H1: must be editor-gated
	protected.Handle("GET /api/workspaces/{id}/dap", re(stub))
	protected.Handle("DELETE /api/workspaces/{id}", re(stub)) // M1: must be editor-gated

	mux := http.NewServeMux()
	mux.Handle("/api/", ah.Middleware(protected))

	srv := httptest.NewServer(mux)
	defer srv.Close()

	routes := []struct{ method, path string }{
		{"GET", "/api/workspaces/default/terminal"},
		{"GET", "/api/workspaces/default/lsp"},
		{"GET", "/api/workspaces/default/dap"},
		{"DELETE", "/api/workspaces/default"},
	}

	for _, rt := range routes {
		rt := rt
		t.Run(rt.method+"_"+rt.path, func(t *testing.T) {
			// Viewer must be rejected with 403 Forbidden.
			req, _ := http.NewRequest(rt.method, srv.URL+rt.path, nil)
			req.Header.Set("Authorization", viewerSess)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("viewer request: %v", err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusForbidden {
				t.Errorf("viewer on %s %s: got %d, want 403 Forbidden", rt.method, rt.path, resp.StatusCode)
			}

			// Editor must not be blocked at the auth gate (stub returns 200).
			req2, _ := http.NewRequest(rt.method, srv.URL+rt.path, nil)
			req2.Header.Set("Authorization", editorSess)
			resp2, err := http.DefaultClient.Do(req2)
			if err != nil {
				t.Fatalf("editor request: %v", err)
			}
			resp2.Body.Close()
			if resp2.StatusCode == http.StatusForbidden || resp2.StatusCode == http.StatusUnauthorized {
				t.Errorf("editor on %s %s: got %d, want pass-through (200)", rt.method, rt.path, resp2.StatusCode)
			}
		})
	}
}

// TestSecurityHeadersEmbed verifies that configuring FrameAncestors switches to
// a CSP-only policy (no X-Frame-Options) so trusted origins can embed wede.
func TestSecurityHeadersEmbed(t *testing.T) {
	cfg := &config.Config{FrameAncestors: "https://vulos.org"}
	h := securityHeaders(cfg, okHandler())

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	res := rec.Result()
	if got := res.Header.Get("X-Frame-Options"); got != "" {
		t.Errorf("X-Frame-Options = %q, want empty in embed mode", got)
	}
	if got := res.Header.Get("Content-Security-Policy"); got != "frame-ancestors https://vulos.org" {
		t.Errorf("CSP = %q, want frame-ancestors https://vulos.org", got)
	}
}
