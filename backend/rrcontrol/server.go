package rrcontrol

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"
)

//go:embed all:dist web/remote-control.html web/test-page.html
var assets embed.FS

// Server owns the rrweb client registry and serves the bundled dashboard.
type Server struct {
	cfg          *Config
	hub          *Hub
	authenticate func(http.Handler) http.Handler
	isTeacher    func(*http.Request) bool
}

// New creates a reusable rrcontrol server. Support connections are always
// authenticated and must pass IsTeacher; client connections may originate
// from external pages that load the embeddable script.
func New(options Options) (*Server, error) {
	control, err := normalizeControlMode(options.ControlMode)
	if err != nil {
		return nil, err
	}
	if control != "off" && (options.Authenticate == nil || options.IsTeacher == nil) {
		return nil, errSupportAuthRequired
	}
	compress := options.Compress
	if compress == nil {
		enabled := true
		compress = &enabled
	}
	cfg := &Config{Control: control, Compress: compress}
	return &Server{
		cfg:          cfg,
		hub:          NewHub(cfg),
		authenticate: options.Authenticate,
		isTeacher:    options.IsTeacher,
	}, nil
}

var errSupportAuthRequired = &configurationError{"enabled rrcontrol requires support authentication and teacher authorization"}

type configurationError struct{ message string }

func (e *configurationError) Error() string { return e.message }

// SetControlMode changes the runtime policy, suitable for a config hot reload.
func (s *Server) SetControlMode(mode string) error {
	control, err := normalizeControlMode(mode)
	if err != nil {
		return err
	}
	s.hub.mu.Lock()
	wasEnabled := s.cfg.Control != "off"
	s.cfg.Control = control
	s.hub.mu.Unlock()
	if wasEnabled && control == "off" {
		s.hub.closeAll()
	}
	return nil
}

func (s *Server) enabled() bool {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	return s.cfg.Control != "off"
}

// Handler serves the dashboard and client endpoints relative to a mount point.
// Example: mux.Handle("/rrcontrol/", http.StripPrefix("/rrcontrol", h.Handler())).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	dist, err := fs.Sub(assets, "dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))
	mux.Handle("/embed/", fileServer)
	mux.Handle("/rc/", fileServer)
	mux.Handle("/chunks/", fileServer)
	mux.HandleFunc("/remote-control", s.page("web/remote-control.html"))
	mux.HandleFunc("/test-page", s.page("web/test-page.html"))
	mux.HandleFunc("/script.js", s.serveLoader)
	mux.HandleFunc("/ws", s.handleWS)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.Redirect(w, r, "remote-control", http.StatusFound)
	})
	return logRequests(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.enabled() {
			http.NotFound(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	}))
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/ws" {
			log.Printf("rrcontrol %s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func (s *Server) page(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.enabled() {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		data, err := assets.ReadFile(name)
		if err != nil {
			log.Printf("rrcontrol page %s: %v", name, err)
			http.Error(w, "page not found", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(data)
	}
}

const loaderJS = `(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var here = new URL(script.src, location.href);
  var base = here.pathname.replace(/script\.js$/, '');
  var mod = new URL(base + 'embed/main.js', here.origin);
  var params = new URLSearchParams(here.search);
  for (var key of ['who', 'tab_id']) {
    var value = params.get(key);
    if (value) mod.searchParams.set(key, value);
  }
  var tag = document.createElement('script');
  tag.type = 'module';
  tag.src = mod.href;
  (document.head || document.documentElement).appendChild(tag);
})();
`

func (s *Server) serveLoader(w http.ResponseWriter, r *http.Request) {
	if !s.enabled() {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write([]byte(loaderJS))
}

func (s *Server) supportHandler(next http.Handler) http.Handler {
	if s.authenticate == nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "support authentication unavailable", http.StatusUnauthorized)
		})
	}
	return s.authenticate(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.isTeacher == nil || !s.isTeacher(r) {
			http.Error(w, "teacher access required", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	if !s.enabled() {
		http.NotFound(w, r)
		return
	}
	if r.URL.Query().Get("role") == "support" {
		s.supportHandler(http.HandlerFunc(s.serveWS)).ServeHTTP(w, r)
		return
	}
	s.serveWS(w, r)
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		s.handleWebSocket(w, r)
		return
	}
	http.Error(w, "websocket upgrade required", http.StatusBadRequest)
}
