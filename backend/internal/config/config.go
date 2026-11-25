package config

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"wede/backend/internal/weakpass"
)

// ── Config schema ────────────────────────────────────────────────────────────

// Config is the merged runtime configuration. It intentionally keeps the
// legacy single-password fields for backwards compatibility; when Users is
// non-empty each configured user signs in with their own entry.
type Config struct {
	Branding       string                     `json:"branding,omitempty"`
	Password       string                     `json:"password,omitempty"`
	Users          map[string]string          `json:"users,omitempty"`
	Teachers       StringList                 `json:"teachers,omitempty"`
	Port           string                     `json:"port,omitempty"`
	Host           string                     `json:"host,omitempty"`
	Workspaces     map[string]WorkspaceConfig `json:"workspaces,omitempty"`
	Defaults       Defaults                   `json:"defaults,omitempty"`
	TokenLinkLogin string                     `json:"token_link_login,omitempty"`

	// MinPasswordChars is the minimum length for a plaintext password or user
	// entry. 0 disables the check. Defaults to 12.
	MinPasswordChars int `json:"min_password_chars,omitempty"`

	// Host is the interface address wede binds to. Defaults to "127.0.0.1"
	// (localhost only). Set to "0.0.0.0" to listen on all interfaces, which is
	// required when wede is accessed from another machine or a Docker host.
	// Keeping the default protects users running wede on a shared machine.

	// FrameAncestors controls which origins may embed wede in an iframe.
	// Emitted as: Content-Security-Policy: frame-ancestors <value>
	// Leave empty (default) for 'self' — blocks all cross-origin framing.
	FrameAncestors string `json:"frame_ancestors,omitempty"`

	// WorkspaceRoot is the base directory under which dynamic workspaces may be
	// opened. Default (empty): the user's home directory. Override with the
	// WEDE_WORKSPACE_ROOT environment variable or this config key.
	WorkspaceRoot string `json:"workspace_root,omitempty"`

	// WorkspaceAllowCustomDirectory enables creating a workspace from an
	// arbitrary directory path (WorkspaceSwitcher / ?workspace=directory:...).
	// Disabled by default so deployments stay limited to configured templates.
	WorkspaceAllowCustomDirectory bool `json:"workspace_allow_custom_directory,omitempty"`

	// ServeLanding controls whether the marketing landing page and /site/*
	// docs viewer are hosted. Cloud-only; local wede serves only the IDE.
	ServeLanding bool `json:"serve_landing,omitempty"`

	TunnelEnabled bool `json:"tunnel_enabled,omitempty"`

	// Debug enables verbose debug logging (collab cursor messages, presence
	// broadcasts, etc.). Defaults to false.
	Debug bool `json:"debug,omitempty"`

	// VisibleTabTypes controls which tab types are shown in the hamburger menu.
	// Keys are tab type names (files, search, code, terminals, web, git, api,
	// log, help, chat, settings). Values are booleans. Only tabs listed as true
	// are usable. If omitted, all tabs default to true.
	VisibleTabTypes map[string]bool `json:"visible_tab_types,omitempty"`

	// ViewImage controls how image files are opened by default:
	//   "tab-viewer" — embed the image viewer in a tab (default)
	//   "external"   — offer an external-tab link instead
	// Users can override this in Settings; the config value is only the default.
	ViewImage string `json:"view_image,omitempty"`

	// ViewPdf controls how PDF files are opened by default:
	//   "tab-pdf-js"  — embed the pdf.js viewer in a tab (default)
	//   "tab-choose"  — show [open here] / [open in external tab] buttons
	//   "external"    — offer an external-tab link instead
	// Users can override this in Settings; the config value is only the default.
	ViewPdf string `json:"view_pdf,omitempty"`

	// FileHidePatterns is a list of glob patterns for files and directories
	// that should be hidden in the FileExplorer. Matching entries are excluded
	// from the file tree, Quick Open, and search. Supports shell-style wildcards
	// (*, ?, [abc]). Default hides common noise: .wede-collab-*, .DS_Store,
	// .nfs*, node_modules, dist, build, .next, vendor, .cache, target.
	FileHidePatterns StringList `json:"file_hide_patterns,omitempty"`
}

// WorkspaceConfig is one workspace template. A template is not a running
// session: joining/creating a session instantiates it.
type WorkspaceConfig struct {
	Path string `json:"path,omitempty"`
	// TimeoutSecs is the idle timeout after the last user leaves. nil uses
	// defaults.workspace_timeout_secs. 0 means never expire.
	TimeoutSecs *int `json:"timeout_secs,omitempty"`
	// Timeout is accepted as a shorter alias for timeout_secs.
	Timeout *int `json:"timeout,omitempty"`
	// LSP optionally names the language servers enabled for this template.
	LSP StringList `json:"lsp,omitempty"`
	// VisibleTo restricts which users can see this workspace in the session
	// picker. Empty means visible to everyone. Accepts a list of usernames.
	VisibleTo StringList `json:"visible_to,omitempty"`
	// OpenToAnybody controls whether any authenticated user can join this
	// workspace. When false (default), only users listed in VisibleTo can see
	// and join it. When true, the workspace is open to all authenticated users
	// regardless of VisibleTo.
	OpenToAnybody bool `json:"open_to_anybody,omitempty"`
	// VisibleTabTypes overrides which tab types are shown for this workspace.
	// Merged with global config: workspace-level values override global values.
	VisibleTabTypes map[string]bool `json:"visible_tab_types,omitempty"`
}

// EffectiveTimeout returns the template timeout, falling back to def.
func (w WorkspaceConfig) EffectiveTimeout(def int) int {
	if w.TimeoutSecs != nil {
		return *w.TimeoutSecs
	}
	if w.Timeout != nil {
		return *w.Timeout
	}
	return def
}

// EffectiveVisibleTabTypes merges global visible_tab_types with workspace-level
// overrides. If global is nil, all tabs default to true. Workspace-level entries
// override the global values. Returns nil if both are nil (meaning all tabs visible).
func (w WorkspaceConfig) EffectiveVisibleTabTypes(global map[string]bool) map[string]bool {
	if global == nil && w.VisibleTabTypes == nil {
		return nil
	}
	merged := make(map[string]bool)
	if global != nil {
		for k, v := range global {
			merged[k] = v
		}
	}
	for k, v := range w.VisibleTabTypes {
		merged[k] = v
	}
	return merged
}

// Defaults holds cross-template defaults.
type Defaults struct {
	WorkspaceTimeoutSecs int `json:"workspace_timeout_secs,omitempty"`
	// WorkspcaeTimeoutSecs tolerates the original draft's spelling.
	WorkspcaeTimeoutSecs int `json:"workspcae_timeout_secs,omitempty"`
}

func (d Defaults) Timeout() int {
	if d.WorkspaceTimeoutSecs > 0 || d.WorkspcaeTimeoutSecs == 0 {
		return d.WorkspaceTimeoutSecs
	}
	return d.WorkspcaeTimeoutSecs
}

// StringList accepts either a JSON/YAML list or a comma/space-separated string
// (the design draft used `teachers: name1, name2`).
type StringList []string

func (s *StringList) UnmarshalJSON(data []byte) error {
	var list []string
	if err := json.Unmarshal(data, &list); err == nil {
		*s = list
		return nil
	}
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		return err
	}
	*s = splitList(str)
	return nil
}

func splitList(s string) []string {
	fields := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' })
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

// ── Layered loading ─────────────────────────────────────────────────────────

const configName = "wede.config.yaml"

// Layer is one entry from --configs: keys:mode:source.
type Layer struct {
	Keys   []string
	Hot    bool
	Source string
}

var validKeys = map[string]bool{
	"all": true, "users": true, "teachers": true, "workspaces": true, "defaults": true,
}

// ParseLayerSpec parses "users,teachers:hot:foo.yaml". The source may itself
// contain colons (only the first two colons are separators).
func ParseLayerSpec(spec string) (Layer, error) {
	parts := strings.SplitN(strings.TrimSpace(spec), ":", 3)
	if len(parts) != 3 {
		return Layer{}, fmt.Errorf("invalid config layer %q (want keys:mode:source)", spec)
	}
	keys := splitList(parts[0])
	if len(keys) == 0 {
		return Layer{}, fmt.Errorf("invalid config layer %q (no keys)", spec)
	}
	for _, k := range keys {
		if !validKeys[k] {
			return Layer{}, fmt.Errorf("invalid config key %q (want all|users|teachers|workspaces|defaults)", k)
		}
	}
	mode := strings.ToLower(strings.TrimSpace(parts[1]))
	if mode != "cached" && mode != "hot" {
		return Layer{}, fmt.Errorf("invalid config mode %q (want cached|hot)", parts[1])
	}
	source := strings.TrimSpace(parts[2])
	if source == "" {
		return Layer{}, fmt.Errorf("invalid config layer %q (empty source)", spec)
	}
	return Layer{Keys: keys, Hot: mode == "hot", Source: source}, nil
}

// ParseLayerSpecs accepts repeated/comma/space-separated --configs values.
func ParseLayerSpecs(specs []string) ([]Layer, error) {
	var out []Layer
	for _, raw := range specs {
		for _, spec := range splitLayerSpecs(raw) {
			l, err := ParseLayerSpec(spec)
			if err != nil {
				return nil, err
			}
			out = append(out, l)
		}
	}
	return out, nil
}

func splitLayerSpecs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	if strings.Contains(raw, ",") {
		return splitList(raw)
	}
	fields := strings.Fields(raw)
	if len(fields) == 0 {
		return nil
	}
	// Treat whitespace as a separator only when every token looks like a
	// layer (keys:mode:source). Otherwise a source path containing spaces is
	// kept intact.
	for _, f := range fields {
		if strings.Count(f, ":") < 2 {
			return []string{raw}
		}
	}
	return fields
}

// Store holds the merged config and can rebuild it for hot layers.
type Store struct {
	mu      sync.RWMutex
	cfg     *Config
	layers  []Layer
	cached  map[int][]byte
	sources []string

	watchMu sync.Mutex
	mods    map[int]fileStamp
}

type fileStamp struct {
	mod  time.Time
	size int64
}

// Load loads the legacy single config (used by tests and old callers).
func Load() *Config {
	st, err := LoadLayers(nil)
	if err != nil {
		log.Fatal(err)
	}
	return st.Current()
}

// LoadLayers merges the given layers. With no layers it searches for the
// legacy wede.config.yaml exactly like the original single-file loader.
func LoadLayers(layers []Layer) (*Store, error) {
	st := &Store{
		layers: layers,
		cached: make(map[int][]byte),
		mods:   make(map[int]fileStamp),
	}
	if len(layers) == 0 {
		path, data, err := findLegacy()
		if err != nil {
			return nil, err
		}
		st.layers = []Layer{{Keys: []string{"all"}, Source: path}}
		st.cached[0] = data
		st.sources = []string{path}
	}
	for i, l := range st.layers {
		if _, ok := st.cached[i]; ok {
			continue
		}
		if l.Source == "-" {
			data, err := os.ReadFile("/dev/stdin")
			if err != nil {
				return nil, fmt.Errorf("read config stdin: %w", err)
			}
			st.cached[i] = data
			continue
		}
		if !l.Hot {
			data, err := os.ReadFile(l.Source)
			if err != nil {
				return nil, fmt.Errorf("read config %s: %w", l.Source, err)
			}
			st.cached[i] = data
		}
	}
	cfg, err := st.build()
	if err != nil {
		return nil, err
	}
	st.cfg = cfg
	if len(st.sources) == 0 {
		for _, l := range st.layers {
			st.sources = append(st.sources, l.Source)
		}
	}
	// Record hot-layer stamps now so the first change after startup triggers a
	// reload (the initial stamp is not itself treated as a change).
	st.hotChanged()
	return st, nil
}

// Current returns the current merged config. Callers must treat it as read-only.
func (s *Store) Current() *Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// Sources returns the layer sources (for startup logging).
func (s *Store) Sources() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]string(nil), s.sources...)
}

// Reload rebuilds the config atomically. On any error the previous snapshot is
// kept and the error returned.
func (s *Store) Reload() error {
	cfg, err := s.build()
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.cfg = cfg
	s.mu.Unlock()
	return nil
}

// StartHotReload polls hot layers and calls onChange with a new snapshot after a
// successful rebuild. Cached layers never trigger reloads.
func (s *Store) StartHotReload(interval time.Duration, onChange func(*Config)) {
	hot := false
	for _, l := range s.layers {
		if l.Hot && l.Source != "-" {
			hot = true
			break
		}
	}
	if !hot {
		return
	}
	if interval <= 0 {
		interval = time.Second
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			if !s.hotChanged() {
				continue
			}
			if err := s.Reload(); err != nil {
				log.Printf("config reload: %v (keeping last good config)", err)
				continue
			}
			log.Printf("config reloaded")
			if onChange != nil {
				onChange(s.Current())
			}
		}
	}()
}

func (s *Store) hotChanged() bool {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	changed := false
	for i, l := range s.layers {
		if !l.Hot || l.Source == "-" {
			continue
		}
		info, err := os.Stat(l.Source)
		if err != nil {
			if _, had := s.mods[i]; had {
				delete(s.mods, i)
				changed = true
			}
			continue
		}
		st := fileStamp{mod: info.ModTime(), size: info.Size()}
		prev, had := s.mods[i]
		if !had || prev != st {
			s.mods[i] = st
			if had { // first observation only records the stamp
				changed = true
			}
		}
	}
	return changed
}

func (s *Store) build() (*Config, error) {
	merged := map[string]any{}
	for i, l := range s.layers {
		data, err := s.layerData(i, l)
		if err != nil {
			return nil, err
		}
		m, err := decodeMap(data, l.Source)
		if err != nil {
			return nil, err
		}
		selected := selectKeys(m, l.Keys)
		mergeInto(merged, selected)
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		Branding:         "wede",
		Port:             "9090",
		Host:             "127.0.0.1",
		Defaults:         Defaults{WorkspaceTimeoutSecs: 600},
		MinPasswordChars: 12,
		TokenLinkLogin:   "off",
		ViewImage:        "tab-viewer",
		ViewPdf:          "tab-pdf-js",
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(cfg); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	if len(cfg.Users) == 0 && cfg.Password == "" {
		return nil, fmt.Errorf("password or users required in config")
	}
	if err := validatePasswords(cfg); err != nil {
		return nil, err
	}
	cfg.Branding = strings.TrimSpace(cfg.Branding)
	if cfg.Branding == "" {
		cfg.Branding = "wede"
	}
	if len(cfg.Branding) > 64 {
		return nil, fmt.Errorf("branding must be at most 64 characters")
	}
	if err := normalizeTokenLinkLogin(cfg); err != nil {
		return nil, err
	}
	if cfg.Defaults.Timeout() < 0 {
		return nil, fmt.Errorf("defaults.workspace_timeout_secs must be >= 0")
	}
	if err := normalizeViewModes(cfg); err != nil {
		return nil, err
	}
	resolveWorkspaceRoot(cfg)
	return cfg, nil
}

func (s *Store) layerData(i int, l Layer) ([]byte, error) {
	if data, ok := s.cached[i]; ok {
		return data, nil
	}
	data, err := os.ReadFile(l.Source)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", l.Source, err)
	}
	return data, nil
}

func findLegacy() (string, []byte, error) {
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for {
			p := filepath.Join(dir, configName)
			if d, err := os.ReadFile(p); err == nil {
				return p, d, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, ".config", "wede", configName)
		if d, err := os.ReadFile(p); err == nil {
			return p, d, nil
		}
	}
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), configName)
		if d, err := os.ReadFile(p); err == nil {
			return p, d, nil
		}
	}
	return "", nil, fmt.Errorf("wede.config.yaml not found (searched cwd, parent dirs, ~/.config/wede/, and next to executable)")
}

func decodeMap(data []byte, source string) (map[string]any, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return map[string]any{}, nil
	}
	lower := strings.ToLower(source)
	jsonFirst := strings.HasSuffix(lower, ".json") || trimmed[0] == '{'
	if jsonFirst {
		var m map[string]any
		if err := json.Unmarshal(trimmed, &m); err == nil {
			return normalizeMap(m), nil
		}
	}
	var m map[string]any
	if err := yaml.Unmarshal(trimmed, &m); err != nil {
		if jsonFirst {
			var jm map[string]any
			if jerr := json.Unmarshal(trimmed, &jm); jerr == nil {
				return normalizeMap(jm), nil
			}
		}
		return nil, fmt.Errorf("parse config %s: %w", source, err)
	}
	return normalizeMap(m), nil
}

func normalizeMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = normalizeValue(v)
	}
	return out
}

func normalizeValue(v any) any {
	switch x := v.(type) {
	case map[string]any:
		return normalizeMap(x)
	case map[any]any:
		m := make(map[string]any, len(x))
		for k, v := range x {
			m[fmt.Sprint(k)] = normalizeValue(v)
		}
		return m
	case []any:
		for i := range x {
			x[i] = normalizeValue(x[i])
		}
		return x
	default:
		return v
	}
}

func selectKeys(m map[string]any, keys []string) map[string]any {
	for _, k := range keys {
		if k == "all" {
			return m
		}
	}
	out := make(map[string]any, len(keys))
	for _, k := range keys {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}

func mergeInto(dst, src map[string]any) {
	for k, v := range src {
		if v == nil {
			delete(dst, k)
			continue
		}
		if sm, ok := v.(map[string]any); ok {
			dm, ok := dst[k].(map[string]any)
			if !ok {
				dm = map[string]any{}
				dst[k] = dm
			}
			mergeInto(dm, sm)
			continue
		}
		dst[k] = v
	}
}

func resolveWorkspaceRoot(cfg *Config) {
	if env := os.Getenv("WEDE_WORKSPACE_ROOT"); env != "" {
		cfg.WorkspaceRoot = env
	}
	if cfg.WorkspaceRoot == "" {
		if home, err := os.UserHomeDir(); err == nil {
			cfg.WorkspaceRoot = home
		}
	}
	if abs, err := filepath.Abs(cfg.WorkspaceRoot); err == nil {
		cfg.WorkspaceRoot = abs
	}
}

// parse keeps the original single-buffer parsing contract for tests. YAML is
// accepted too.
func parse(data []byte) (*Config, error) {
	m, err := decodeMap(data, "config")
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	cfg := &Config{
		Branding:       "wede",
		Port:           "9090",
		Host:           "127.0.0.1",
		Defaults:       Defaults{WorkspaceTimeoutSecs: 600},
		TokenLinkLogin: "off",
		ViewImage:      "tab-viewer",
		ViewPdf:        "tab-pdf-js",
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(cfg); err != nil {
		return nil, fmt.Errorf("invalid wede.config.yaml: %w", err)
	}
	if err := normalizeTokenLinkLogin(cfg); err != nil {
		return nil, err
	}
	if len(cfg.Users) == 0 && cfg.Password == "" {
		return nil, fmt.Errorf("password is required in wede.config.yaml")
	}
	if err := normalizeViewModes(cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func normalizeTokenLinkLogin(cfg *Config) error {
	if cfg.TokenLinkLogin == "" {
		cfg.TokenLinkLogin = "off"
	}
	switch cfg.TokenLinkLogin {
	case "off", "keep", "remove":
		return nil
	default:
		return fmt.Errorf("token_link_login must be one of: off, keep, remove")
	}
}

// normalizeViewModes applies defaults and validates the media view preferences.
// These are defaults only: the UI lets each user override them locally.
func normalizeViewModes(cfg *Config) error {
	if cfg.ViewImage == "" {
		cfg.ViewImage = "tab-viewer"
	}
	switch cfg.ViewImage {
	case "tab-viewer", "external":
	default:
		return fmt.Errorf("view_image must be one of: tab-viewer, external")
	}

	if cfg.ViewPdf == "" {
		cfg.ViewPdf = "tab-pdf-js"
	}
	switch cfg.ViewPdf {
	case "tab-pdf-js", "tab-choose", "external":
	default:
		return fmt.Errorf("view_pdf must be one of: tab-pdf-js, tab-choose, external")
	}
	return nil
}

// validatePasswords enforces the password policy on plaintext passwords and
// user entries. `sha256:` entries are opaque digests and are skipped.
func validatePasswords(cfg *Config) error {
	if cfg.MinPasswordChars <= 0 {
		return nil
	}
	if pw := cfg.Password; pw != "" && !strings.HasPrefix(pw, "sha256:") {
		if err := checkPassword(pw, cfg.MinPasswordChars); err != nil {
			return fmt.Errorf("password: %w", err)
		}
	}
	for name, pw := range cfg.Users {
		if pw == "" || strings.HasPrefix(pw, "sha256:") {
			continue
		}
		if err := checkPassword(pw, cfg.MinPasswordChars); err != nil {
			return fmt.Errorf("user %q: %w", name, err)
		}
	}
	return nil
}

func checkPassword(pw string, min int) error {
	if len(pw) < min {
		return fmt.Errorf("min %d chars required for password. Your password might be right, we still reject it for security concerns.", min)
	}
	if weakpass.IsCommon(pw) {
		return fmt.Errorf("password is too common. Your password might be right, we still reject it for security concerns.")
	}
	return nil
}

// PasswordMatches reports whether password matches a configured value. Plain
// values are supported for backwards compatibility; values with a `sha256:`
// prefix are compared as SHA-256 hex digests.
func PasswordMatches(expected, given string) bool {
	if strings.HasPrefix(expected, "sha256:") {
		sum := sha256.Sum256([]byte(given))
		return subtleEqual(strings.TrimPrefix(expected, "sha256:"), hex.EncodeToString(sum[:]))
	}
	return subtleEqual(expected, given)
}

func subtleEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}
