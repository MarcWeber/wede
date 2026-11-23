// Package presence tracks who is connected to a room and what each person is
// looking at (file + cursor line), for multiplayer awareness.
//
// The Hub is transport-agnostic: each member has an outbound channel of JSON
// event bytes. The collab WebSocket handler pumps that channel to the socket and
// feeds incoming cursor/file updates back via Update. Keeping the hub free of any
// net/http or websocket dependency makes it directly unit-testable.
//
// On any membership or cursor change the hub broadcasts the full roster. For a
// small team sharing one host this is simpler and plenty efficient versus deltas.
package presence

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// Debug callback for verbose logging — set from collab package.
var debugFn func(format string, args ...any)

// SetDebugFn installs a debug logging callback (e.g. log.Printf).
func SetDebugFn(fn func(format string, args ...any)) {
	debugFn = fn
}

func debug(format string, args ...any) {
	if debugFn != nil {
		debugFn(format, args...)
	}
}

// Member is one connected participant in a room.
type Member struct {
	ID            string   `json:"id"`
	Username      string   `json:"username"`
	Color         string   `json:"color"`
	File          string   `json:"file,omitempty"`          // path currently viewed (relative to room root)
	TabID         int      `json:"tabId,omitempty"`         // unique tab ID from layout tree
	Line          int      `json:"line,omitempty"`          // cursor line in that file
	AnchorLine    int      `json:"anchorLine,omitempty"`    // selection start line (0 = no selection)
	AnchorCol     int      `json:"anchorCol,omitempty"`     // selection start column (1-based, 0 = no selection)
	HeadLine      int      `json:"headLine,omitempty"`      // selection end line (0 = no selection)
	HeadCol       int      `json:"headCol,omitempty"`       // selection end column (1-based, 0 = no selection)
	Tabs          []string `json:"tabs,omitempty"`          // open file tabs (relative paths)
	TabViewState  string   `json:"tabViewState,omitempty"`  // user:<name> view state using this socket
	CollabContext string   `json:"collabContext,omitempty"` // session/context that owns TabViewState
	PushTabs      bool     `json:"pushTabs,omitempty"`      // when true, this member's tab list is broadcast to peers
}

// Presenter is the single participant currently leading the room. While set,
// every other client follows this member live. The state is server-authoritative
// and intentionally has no mode field: leading always means force follow-live.
type Presenter struct {
	ID       string    `json:"id"`
	Username string    `json:"username"`
	Since    time.Time `json:"since"`
}

// rosterEvent is the message broadcast to every member's outbound channel.
type rosterEvent struct {
	Type      string     `json:"type"` // always "presence"
	Members   []Member   `json:"members"`
	Presenter *Presenter `json:"presenter,omitempty"`
}

// palette gives each member a stable, distinct color by join order.
var palette = []string{
	"#f87171", "#fb923c", "#fbbf24", "#34d399",
	"#22d3ee", "#60a5fa", "#a78bfa", "#f472b6",
}

type client struct {
	member Member
	out    chan []byte
}

// Hub is a room's presence registry. Safe for concurrent use.
type Hub struct {
	mu        sync.RWMutex
	clients   map[string]*client
	counter   uint64
	presenter *Presenter
	closed    bool
}

// NewHub returns an empty presence hub.
func NewHub() *Hub {
	return &Hub{clients: make(map[string]*client)}
}

// Join registers a participant and returns its assigned id plus an outbound
// channel that will receive roster events (including the one triggered by this
// join). The channel is buffered; if a consumer falls behind, events are dropped
// rather than blocking the hub.
func (h *Hub) Join(username string, tabViewState ...string) (string, <-chan []byte) {
	var state string
	if len(tabViewState) > 0 {
		state = tabViewState[0]
	}
	return h.JoinContext(username, state, "")
}

// JoinContext registers a participant and takes over its tab view state if
// another socket in the same collaboration context already holds it. The older
// socket receives a "kicked" event and is closed so only one device owns a
// state at a time.
func (h *Hub) JoinContext(username, tabViewState, collabContext string) (string, <-chan []byte) {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		ch := make(chan []byte)
		close(ch)
		return "", ch
	}
	evicted := false
	if tabViewState != "" {
		for oid, oc := range h.clients {
			if oc.member.TabViewState != tabViewState || oc.member.CollabContext != collabContext {
				continue
			}
			h.kickLocked(oc)
			delete(h.clients, oid)
			if h.presenter != nil && h.presenter.ID == oid {
				h.presenter = nil
			}
			evicted = true
		}
	}
	h.counter++
	id := fmt.Sprintf("m%d", h.counter)
	if username == "" {
		username = "anon"
	}
	member := Member{
		ID:            id,
		Username:      username,
		Color:         palette[(h.counter-1)%uint64(len(palette))],
		TabViewState:  tabViewState,
		CollabContext: collabContext,
	}
	c := &client{member: member, out: make(chan []byte, 16)}
	h.clients[id] = c
	h.mu.Unlock()

	h.broadcast()
	if evicted {
		debug("[presence-debug] tab view state %q taken over in context %q", tabViewState, collabContext)
	}
	return id, c.out
}

// KickTabViewState force-closes every socket using a state in a context so its
// client falls back to the tab view state selector. Used when a state is
// removed or taken over.
func (h *Hub) KickTabViewState(collabContext, tabViewState string) int {
	if tabViewState == "" {
		return 0
	}
	h.mu.Lock()
	n := 0
	for oid, oc := range h.clients {
		if oc.member.TabViewState != tabViewState || oc.member.CollabContext != collabContext {
			continue
		}
		h.kickLocked(oc)
		delete(h.clients, oid)
		if h.presenter != nil && h.presenter.ID == oid {
			h.presenter = nil
		}
		n++
	}
	h.mu.Unlock()
	if n > 0 {
		h.broadcast()
	}
	return n
}

// kickLocked sends the kicked notice and closes the outbound channel. The write
// pump sees the buffered notice first, then closes the socket.
func (h *Hub) kickLocked(c *client) {
	select {
	case c.out <- []byte(`{"type":"kicked","reason":"tab_view_state"}`):
	default:
	}
	close(c.out)
}

// Leave removes a participant and notifies the rest.
func (h *Hub) Leave(id string) {
	h.mu.Lock()
	c, ok := h.clients[id]
	cleared := false
	if ok {
		delete(h.clients, id)
		close(c.out)
		if h.presenter != nil && h.presenter.ID == id {
			h.presenter = nil
			cleared = true
		}
	}
	h.mu.Unlock()
	if ok || cleared {
		h.broadcast()
	}
}

// SetPresenter makes id the room's single presenter. It returns false when
// another member is already presenting (at most one presenter per room). The
// caller is responsible for checking teacher permission.
func (h *Hub) SetPresenter(id string) bool {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return false
	}
	c, ok := h.clients[id]
	if !ok {
		h.mu.Unlock()
		return false
	}
	if h.presenter != nil && h.presenter.ID != id {
		h.mu.Unlock()
		return false
	}
	h.presenter = &Presenter{ID: id, Username: c.member.Username, Since: time.Now().UTC()}
	h.mu.Unlock()
	h.broadcast()
	return true
}

// ClearPresenter stops id from presenting. It is a no-op if id is not the
// current presenter, so a client cannot stop somebody else's lead.
func (h *Hub) ClearPresenter(id string) bool {
	h.mu.Lock()
	if h.presenter == nil || h.presenter.ID != id {
		h.mu.Unlock()
		return false
	}
	h.presenter = nil
	h.mu.Unlock()
	h.broadcast()
	return true
}

// Presenter returns a copy of the current presenter, or nil.
func (h *Hub) Presenter() *Presenter {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.presenter == nil {
		return nil
	}
	p := *h.presenter
	return &p
}

// Update sets the file + tab ID + cursor line a member is viewing and rebroadcasts.
// tabID is the unique tab ID from the layout tree (0 = not set).
// anchorLine/anchorCol and headLine/headCol describe the selection range
// (1-based lines and columns); pass 0 for all four when there is no selection
// (cursor only).
func (h *Hub) Update(id, file string, tabID, line, anchorLine, anchorCol, headLine, headCol int) {
	h.mu.Lock()
	c, ok := h.clients[id]
	if ok {
		c.member.File = file
		c.member.TabID = tabID
		c.member.Line = line
		c.member.AnchorLine = anchorLine
		c.member.AnchorCol = anchorCol
		c.member.HeadLine = headLine
		c.member.HeadCol = headCol
	}
	h.mu.Unlock()
	if ok {
		debug("[presence-debug] Update id=%s file=%q tabId=%d line=%d sel=[%d:%d–%d:%d]", id, file, tabID, line, anchorLine, anchorCol, headLine, headCol)
		h.broadcast()
	}
}

// UpdateTabs sets the list of file tabs a member has open and rebroadcasts
// the full roster to all peers. The list is capped so a hostile client cannot
// grow every roster broadcast without bound. Peers always receive the update
// so the SessionTabs panel stays in sync across all connected users.
func (h *Hub) UpdateTabs(id string, tabs []string) {
	h.mu.Lock()
	c, ok := h.clients[id]
	if ok {
		c.member.Tabs = sanitizeTabs(tabs)
	}
	h.mu.Unlock()
	if ok {
		h.broadcast()
	}
}

// SetPushTabs is deprecated — UpdateTabs now always broadcasts. Kept for
// API compatibility with the WebSocket handler.
func (h *Hub) SetPushTabs(id string, enabled bool) {
	// no-op: broadcasts always happen
}

func sanitizeTabs(tabs []string) []string {
	if len(tabs) == 0 {
		return nil
	}
	out := make([]string, 0, len(tabs))
	seen := make(map[string]bool, len(tabs))
	for _, t := range tabs {
		if t == "" || len(t) > 1024 || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
		if len(out) >= 200 {
			break
		}
	}
	return out
}

// RelayExcept forwards a pre-built message to every member except the sender.
// Used for ephemeral peer-to-peer signals (live mouse position, shared window
// geometry) that change too often to ride the full-roster broadcast.
func (h *Hub) RelayExcept(senderID string, data []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for id, c := range h.clients {
		if id == senderID {
			continue
		}
		select {
		case c.out <- data:
		default: // drop for a slow consumer rather than block the hub
		}
	}
}

// Roster returns a snapshot of current members (unordered).
func (h *Hub) Roster() []Member {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.snapshot()
}

// snapshot builds a member slice; caller must hold at least a read lock.
func (h *Hub) snapshot() []Member {
	out := make([]Member, 0, len(h.clients))
	for _, c := range h.clients {
		out = append(out, c.member)
	}
	return out
}

// broadcast sends the current roster to every member's channel (non-blocking).
func (h *Hub) broadcast() {
	h.mu.RLock()
	defer h.mu.RUnlock()
	data, err := json.Marshal(rosterEvent{Type: "presence", Members: h.snapshot(), Presenter: h.presenter})
	if err != nil {
		return
	}
	// Debug: log each member's selection data in the broadcast.
	if debugFn != nil {
		var ev rosterEvent
		if json.Unmarshal(data, &ev) == nil {
			for _, m := range ev.Members {
				debug("[presence-debug] broadcast member %s (%s): file=%q line=%d sel=[%d:%d–%d:%d]",
					m.ID, m.Username, m.File, m.Line, m.AnchorLine, m.AnchorCol, m.HeadLine, m.HeadCol)
			}
		}
	}
	for _, c := range h.clients {
		select {
		case c.out <- data:
		default: // drop for a slow consumer rather than block the hub
		}
	}
}

// Close shuts the hub down, closing all outbound channels. Idempotent.
// Before closing, it sends a "kicked" notice to every connected client so the
// frontend knows the workspace was closed (rather than a network error) and can
// show the session picker modal.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	h.presenter = nil
	for id, c := range h.clients {
		// Queue the kicked notice before closing so the write pump delivers it.
		select {
		case c.out <- []byte(`{"type":"kicked","reason":"workspace_closed"}`):
		default:
		}
		close(c.out)
		delete(h.clients, id)
	}
}
