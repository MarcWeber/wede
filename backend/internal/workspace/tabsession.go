package workspace

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// TabViewState is the server-side record of one user's window layout inside a
// session (workspace:context). Clients re-send the container tree on
// open/close/reorder/dock so a lost client view is recoverable from here.
//
// Data is an opaque JSON payload owned by the client (container tree, tab
// order, scroll positions, per-tab prevent_hide). The server stores it verbatim
// and never inspects its contents.
type TabViewState struct {
	Name      string          `json:"name"` // user:name or device:<id>
	UpdatedAt int64           `json:"updated_at"`
	Data      json.RawMessage `json:"data"` // client-owned layout dump
}

// tabSessionStore holds per-session tab_view_states. Keys are session keys
// ("workspace:context" or "workspace:context:dir"); values are maps of
// "user:name" -> state. Order is preserved for stable listing.
type tabSessionStore struct {
	mu       sync.Mutex
	sessions map[string]map[string]*TabViewState
	order    map[string][]string
}

func newTabSessionStore() *tabSessionStore {
	return &tabSessionStore{
		sessions: make(map[string]map[string]*TabViewState),
		order:    make(map[string][]string),
	}
}

// Get returns the stored state for a user inside a session, or nil.
func (s *tabSessionStore) Get(sessionKey, user string) *TabViewState {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.sessions[sessionKey]
	if !ok {
		return nil
	}
	st, ok := m[user]
	if !ok {
		return nil
	}
	cp := *st
	return &cp
}

// Put stores (or replaces) a user's state inside a session.
func (s *tabSessionStore) Put(sessionKey, user string, data json.RawMessage) *TabViewState {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.sessions[sessionKey]
	if !ok {
		m = make(map[string]*TabViewState)
		s.sessions[sessionKey] = m
	}
	st := &TabViewState{Name: user, Data: data, UpdatedAt: time.Now().Unix()}
	m[user] = st
	if !tabStateContains(s.order[sessionKey], user) {
		s.order[sessionKey] = append(s.order[sessionKey], user)
	}
	cp := *st
	return &cp
}

// List returns the users with stored states in a session, in insertion order.
func (s *tabSessionStore) List(sessionKey string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.order[sessionKey]...)
}

// Delete removes a user's state from a session.
func (s *tabSessionStore) Delete(sessionKey, user string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.sessions[sessionKey]
	if !ok {
		return false
	}
	if _, ok := m[user]; !ok {
		return false
	}
	delete(m, user)
	s.order[sessionKey] = tabStateRemove(s.order[sessionKey], user)
	if len(m) == 0 {
		delete(s.sessions, sessionKey)
		delete(s.order, sessionKey)
	}
	return true
}

func tabStateContains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func tabStateRemove(list []string, v string) []string {
	out := make([]string, 0, len(list))
	for _, x := range list {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

// tabStateKey builds the session key "workspace:context[:dir]" from request
// parts. context defaults to the workspace id; dir is an optional relative path.
func tabStateKey(workspace, context, dir string) string {
	if strings.TrimSpace(context) == "" {
		context = workspace
	}
	key := workspace + ":" + context
	if dir = strings.Trim(strings.TrimSpace(dir), "/"); dir != "" {
		key += ":" + dir
	}
	return key
}
