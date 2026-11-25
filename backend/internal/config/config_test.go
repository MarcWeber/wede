package config

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseDefaults(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x"}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.Port != "9090" {
		t.Errorf("Port = %q, want default 9090", cfg.Port)
	}
	if cfg.Host != "127.0.0.1" {
		t.Errorf("Host = %q, want default 127.0.0.1", cfg.Host)
	}
	// ServeLanding is cloud-only: a local self-hosted wede must default to off so
	// the marketing landing never shadows the IDE's own /assets/*.
	if cfg.ServeLanding {
		t.Error("ServeLanding should default to false")
	}
	if cfg.TunnelEnabled {
		t.Error("TunnelEnabled should default to false")
	}
	if cfg.TokenLinkLogin != "off" {
		t.Errorf("TokenLinkLogin = %q, want default off", cfg.TokenLinkLogin)
	}
	if cfg.RRControl != "no" {
		t.Errorf("RRControl = %q, want default no", cfg.RRControl)
	}
	if cfg.SessionTimeoutHours != 24 {
		t.Errorf("SessionTimeoutHours = %d, want default 24", cfg.SessionTimeoutHours)
	}
}

func TestParseSessionTimeoutHours(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x","session_timeout_hours":48}`))
	if err != nil {
		t.Fatalf("parse session timeout: %v", err)
	}
	if cfg == nil {
		t.Fatal("parse returned nil config")
	}
	if cfg.SessionTimeoutHours != 48 || cfg.SessionTimeout() != 48*time.Hour {
		t.Fatalf("session timeout = %d hours / %s, want 48 hours", cfg.SessionTimeoutHours, cfg.SessionTimeout())
	}
	if cfg, err := parse([]byte(`{"password":"x","session_timeout_hours":0}`)); err != nil || cfg.SessionTimeoutHours != 24 {
		t.Fatalf("zero session timeout should use default 24 hours; config=%+v err=%v", cfg, err)
	}
	if _, err := parse([]byte(`{"password":"x","session_timeout_hours":-1}`)); err == nil {
		t.Fatal("expected negative session timeout to be rejected")
	}
}

func TestParseTokenLinkLoginModes(t *testing.T) {
	for _, mode := range []string{"off", "keep", "remove"} {
		t.Run(mode, func(t *testing.T) {
			cfg, err := parse([]byte(`{"password":"x","token_link_login":"` + mode + `"}`))
			if err != nil {
				t.Fatalf("parse token_link_login %q: %v", mode, err)
			}
			if cfg.TokenLinkLogin != mode {
				t.Errorf("TokenLinkLogin = %q, want %q", cfg.TokenLinkLogin, mode)
			}
		})
	}
	if _, err := parse([]byte(`{"password":"x","token_link_login":"yes"}`)); err == nil {
		t.Fatal("expected invalid token_link_login mode to be rejected")
	}
}

func TestParseRRControlModes(t *testing.T) {
	for _, mode := range []string{"off", "ask", "no", "yes"} {
		t.Run(mode, func(t *testing.T) {
			cfg, err := parse([]byte(`{"password":"x","rrcontrol":"` + mode + `"}`))
			if err != nil {
				t.Fatalf("parse rrcontrol %q: %v", mode, err)
			}
			if cfg.RRControl != mode {
				t.Errorf("RRControl = %q, want %q", cfg.RRControl, mode)
			}
		})
	}
	if _, err := parse([]byte(`{"password":"x","rrcontrol":"maybe"}`)); err == nil {
		t.Fatal("expected invalid rrcontrol mode to be rejected")
	}
}

func TestWorkspaceLockModesAndLegacyOpenToAnybody(t *testing.T) {
	cases := []struct {
		name           string
		workspace      string
		wantLock       string
		wantLegacyOpen bool
	}{
		{name: "default closed", workspace: `{}`, wantLock: "closed"},
		{name: "users inferred", workspace: `{"visible_to":["marc"]}`, wantLock: "users"},
		{name: "read only", workspace: `{"lock":"anon-ro"}`, wantLock: "anon-ro"},
		{name: "read write", workspace: `{"lock":"anon-rw"}`, wantLock: "anon-rw"},
		{name: "legacy open", workspace: `{"open_to_anybody":true}`, wantLock: "users", wantLegacyOpen: true},
		{name: "legacy closed", workspace: `{"open_to_anybody":false}`, wantLock: "closed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := parse([]byte(`{"password":"x","workspaces":{"project":` + tc.workspace + `}}`))
			if err != nil {
				t.Fatalf("parse workspace lock: %v", err)
			}
			workspace := cfg.Workspaces["project"]
			if workspace.Lock != tc.wantLock || workspace.LegacyOpenToAnybody != tc.wantLegacyOpen {
				t.Fatalf("workspace policy = lock %q, legacy-open %v; want %q, %v", workspace.Lock, workspace.LegacyOpenToAnybody, tc.wantLock, tc.wantLegacyOpen)
			}
		})
	}
	if _, err := parse([]byte(`{"password":"x","workspaces":{"project":{"lock":"anon"}}}`)); err == nil {
		t.Fatal("expected unsupported workspace lock to be rejected")
	}
	if _, err := parse([]byte(`{"password":"x","workspaces":{"project":{"lock":"anon-rw","open_to_anybody":true}}}`)); err == nil {
		t.Fatal("expected mixing lock and legacy open_to_anybody to be rejected")
	}
}

func TestParseTunnelEnabled(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x","tunnel_enabled":true}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !cfg.TunnelEnabled {
		t.Error("tunnel_enabled:true should set TunnelEnabled")
	}
}

func TestParseServeLanding(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x","serve_landing":true}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !cfg.ServeLanding {
		t.Error("serve_landing:true should set ServeLanding")
	}
}

func TestParseRequiresPassword(t *testing.T) {
	if _, err := parse([]byte(`{"port":"1234"}`)); err == nil {
		t.Fatal("expected error when password is missing")
	}
}

func TestParseRejectsUnknownFields(t *testing.T) {
	if _, err := parse([]byte(`{"password":"x","bogus":1}`)); err == nil {
		t.Fatal("expected error for unknown config key")
	}
}

func TestParseRejectsMalformedJSON(t *testing.T) {
	if _, err := parse([]byte(`{not json`)); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

func TestParseOverridesDefaults(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x","port":"3000","host":"0.0.0.0"}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cfg.Port != "3000" || cfg.Host != "0.0.0.0" {
		t.Errorf("overrides not applied: port=%q host=%q", cfg.Port, cfg.Host)
	}
}

func TestParseLayerSpec(t *testing.T) {
	l, err := ParseLayerSpec("users,teachers:hot:foo.yaml")
	if err != nil {
		t.Fatalf("ParseLayerSpec: %v", err)
	}
	if !l.Hot || l.Source != "foo.yaml" || len(l.Keys) != 2 {
		t.Fatalf("layer = %+v", l)
	}
	if _, err := ParseLayerSpec("users:fast:foo"); err == nil {
		t.Fatal("expected invalid mode error")
	}
	if _, err := ParseLayerSpec("bogus:hot:foo"); err == nil {
		t.Fatal("expected invalid key error")
	}
}

func TestParseLayerSpecsSpaces(t *testing.T) {
	layers, err := ParseLayerSpecs([]string{"users:hot:a.yaml teachers:hot:b.yaml"})
	if err != nil {
		t.Fatalf("ParseLayerSpecs: %v", err)
	}
	if len(layers) != 2 || layers[0].Source != "a.yaml" || layers[1].Source != "b.yaml" {
		t.Fatalf("layers = %+v", layers)
	}
	layers, err = ParseLayerSpecs([]string{"users:hot:/tmp/my config.yaml"})
	if err != nil {
		t.Fatalf("ParseLayerSpecs spaces in path: %v", err)
	}
	if len(layers) != 1 || layers[0].Source != "/tmp/my config.yaml" {
		t.Fatalf("layers = %+v", layers)
	}
}

func TestLayeredConfigMergeYAML(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "base.json")
	over := filepath.Join(dir, "over.yaml")
	del := filepath.Join(dir, "del.json")
	if err := os.WriteFile(base, []byte(`{
		"password":"legacy",
		"min_password_chars":0,
		"token_link_login":"keep",
		"port":"9090",
		"users":{"alice":"a","bob":"b"},
		"teachers":["alice"],
		"defaults":{"workspace_timeout_secs":300},
		"workspaces":{"main":{"path":".","timeout":60}}
	}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(over, []byte(`
port: "8080"
token_link_login: remove
users:
  bob: b2
  carol: c
teachers: "carol, bob"
defaults:
  workspace_timeout_secs: 600
workspaces:
  lab:
    path: ./lab
    lsp: [go, python]
`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(del, []byte(`{"users":{"bob":null}}`), 0600); err != nil {
		t.Fatal(err)
	}
	st, err := LoadLayers([]Layer{
		{Keys: []string{"all"}, Source: base},
		{Keys: []string{"all"}, Source: over},
		{Keys: []string{"users"}, Source: del},
	})
	if err != nil {
		t.Fatalf("LoadLayers: %v", err)
	}
	cfg := st.Current()
	if cfg.Port != "8080" {
		t.Errorf("port = %q, want 8080", cfg.Port)
	}
	if cfg.TokenLinkLogin != "remove" {
		t.Errorf("TokenLinkLogin = %q, want remove", cfg.TokenLinkLogin)
	}
	if _, ok := cfg.Users["bob"]; ok {
		t.Error("bob should be deleted")
	}
	if cfg.Users["alice"] != "a" || cfg.Users["carol"] != "c" {
		t.Errorf("users = %+v", cfg.Users)
	}
	if len(cfg.Teachers) != 2 || cfg.Teachers[0] != "carol" || cfg.Teachers[1] != "bob" {
		t.Errorf("teachers = %+v", cfg.Teachers)
	}
	if cfg.Defaults.Timeout() != 600 {
		t.Errorf("timeout = %d", cfg.Defaults.Timeout())
	}
	main := cfg.Workspaces["main"]
	if main.Timeout == nil || *main.Timeout != 60 {
		t.Errorf("main timeout = %+v", main)
	}
	lab := cfg.Workspaces["lab"]
	if lab.Path != "./lab" || len(lab.LSP) != 2 {
		t.Errorf("lab = %+v", lab)
	}
}

func TestPasswordMatches(t *testing.T) {
	if !PasswordMatches("secret", "secret") || PasswordMatches("secret", "no") {
		t.Fatal("plain password comparison failed")
	}
	sum := sha256.Sum256([]byte("secret"))
	hashed := "sha256:" + hex.EncodeToString(sum[:])
	if !PasswordMatches(hashed, "secret") || PasswordMatches(hashed, "no") {
		t.Fatal("sha256 password comparison failed")
	}
}

func TestReloadKeepsLastGoodConfig(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "hot.yaml")
	if err := os.WriteFile(src, []byte("password: x\nmin_password_chars: 0\nport: \"7000\"\nteachers: [a]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	st, err := LoadLayers([]Layer{{Keys: []string{"all"}, Hot: true, Source: src}})
	if err != nil {
		t.Fatal(err)
	}
	if st.Current().Port != "7000" {
		t.Fatalf("initial port = %q", st.Current().Port)
	}
	if err := os.WriteFile(src, []byte("password: x\nmin_password_chars: 0\nport: \"7001\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := st.Reload(); err != nil {
		t.Fatal(err)
	}
	if st.Current().Port != "7001" {
		t.Fatalf("reloaded port = %q", st.Current().Port)
	}
	if err := os.WriteFile(src, []byte("password: x\nmin_password_chars: 0\nport: [not,a,string]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := st.Reload(); err == nil {
		t.Fatal("expected invalid config error")
	}
	if st.Current().Port != "7001" {
		t.Fatalf("bad reload replaced last-good config: %q", st.Current().Port)
	}
}

func TestExplicitZeroGlobalTimeout(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "zero.yaml")
	if err := os.WriteFile(src, []byte("password: x\nmin_password_chars: 0\ndefaults:\n  workspace_timeout_secs: 0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	st, err := LoadLayers([]Layer{{Keys: []string{"all"}, Source: src}})
	if err != nil {
		t.Fatal(err)
	}
	if got := st.Current().Defaults.Timeout(); got != 0 {
		t.Fatalf("explicit zero timeout = %d, want 0", got)
	}
}

func TestBrandingDefaultAndOverride(t *testing.T) {
	dir := t.TempDir()
	def := filepath.Join(dir, "def.yaml")
	if err := os.WriteFile(def, []byte("password: x\nmin_password_chars: 0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	st, err := LoadLayers([]Layer{{Keys: []string{"all"}, Source: def}})
	if err != nil {
		t.Fatal(err)
	}
	if got := st.Current().Branding; got != "wede" {
		t.Fatalf("default branding = %q", got)
	}

	named := filepath.Join(dir, "named.yaml")
	if err := os.WriteFile(named, []byte("password: x\nmin_password_chars: 0\nbranding: \"Acme IDE\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	st, err = LoadLayers([]Layer{{Keys: []string{"all"}, Source: named}})
	if err != nil {
		t.Fatal(err)
	}
	if got := st.Current().Branding; got != "Acme IDE" {
		t.Fatalf("branding = %q", got)
	}
}

func TestPasswordPolicy(t *testing.T) {
	dir := t.TempDir()
	load := func(body string) error {
		p := filepath.Join(dir, "c.yaml")
		if err := os.WriteFile(p, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := LoadLayers([]Layer{{Keys: []string{"all"}, Source: p}})
		return err
	}

	if err := load("password: short\n"); err == nil {
		t.Error("expected short password to be rejected (default min 12)")
	}
	if err := load("users:\n  bob: short\n"); err == nil {
		t.Error("expected short user password to be rejected")
	}
	if err := load("password: 123456789012\n"); err == nil {
		t.Error("expected commonly used password to be rejected")
	}
	if err := load("password: 12345678901234\n"); err == nil {
		t.Error("expected long password sharing a common 12-char prefix to be rejected")
	}
	if err := load("password: wede-local-2026\n"); err != nil {
		t.Errorf("unexpected error for long uncommon password: %v", err)
	}
	if err := load("password: short\nmin_password_chars: 0\n"); err != nil {
		t.Errorf("min_password_chars:0 should disable the policy: %v", err)
	}
	sum := sha256.Sum256([]byte("short"))
	if err := load("users:\n  alice: sha256:" + hex.EncodeToString(sum[:]) + "\n"); err != nil {
		t.Errorf("sha256 user entry should be skipped: %v", err)
	}
}

func TestViewModeDefaultsAndValidation(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ViewImage != "tab-viewer" {
		t.Errorf("default view_image = %q, want tab-viewer", cfg.ViewImage)
	}
	if cfg.ViewPdf != "tab-pdf-js" {
		t.Errorf("default view_pdf = %q, want tab-pdf-js", cfg.ViewPdf)
	}

	cfg, err = parse([]byte(`{"password":"x","view_image":"external","view_pdf":"tab-choose"}`))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ViewImage != "external" || cfg.ViewPdf != "tab-choose" {
		t.Errorf("view modes = %q/%q, want external/tab-choose", cfg.ViewImage, cfg.ViewPdf)
	}

	if _, err := parse([]byte(`{"password":"x","view_image":"bogus"}`)); err == nil {
		t.Error("expected invalid view_image to be rejected")
	}
	if _, err := parse([]byte(`{"password":"x","view_pdf":"bogus"}`)); err == nil {
		t.Error("expected invalid view_pdf to be rejected")
	}
}

func TestWorkspaceAllowCustomDirectoryDefaultAndOptIn(t *testing.T) {
	cfg, err := parse([]byte(`{"password":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WorkspaceAllowCustomDirectory {
		t.Error("workspace_allow_custom_directory should default to false")
	}
	cfg, err = parse([]byte(`{"password":"x","workspace_allow_custom_directory":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.WorkspaceAllowCustomDirectory {
		t.Error("workspace_allow_custom_directory:true was not parsed")
	}
}
