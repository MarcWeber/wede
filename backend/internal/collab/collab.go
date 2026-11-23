// Package collab provides the per-room collaboration WebSocket. For now it
// carries presence (who is connected, what file/line each person is viewing);
// the CRDT document channel is layered on the same socket in a later wave.
//
// The handler is a thin pump over the already-tested presence.Hub: a write loop
// drains the member's outbound roster channel to the socket, and a read loop
// turns inbound {"type":"cursor", "file", "line"} messages into hub.Update.
package collab

import (
	"bytes"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"wede/backend/internal/auth"
	"wede/backend/internal/presence"
)

// Debug logging toggle — set from main.go based on config.Debug.
var (
	debugEnabled bool
	debugMu      sync.RWMutex
)

// SetDebug enables or disables verbose debug logging for collab events.
func SetDebug(on bool) {
	debugMu.Lock()
	debugEnabled = on
	debugMu.Unlock()
}

func isDebug() bool {
	debugMu.RLock()
	defer debugMu.RUnlock()
	return debugEnabled
}

const (
	pingInterval = 30 * time.Second
	readLimit    = 8 << 10 // 8 KiB — cursor messages are tiny
)

// Handler upgrades collaboration WebSockets for a single room's presence hub.
type Handler struct {
	hub      *presence.Hub
	canLead  func(username string) bool
	upgrader websocket.Upgrader
	// visibleTabTypes controls which tab types are shown in the hamburger menu.
	// nil means all tabs are visible.
	visibleTabTypes map[string]bool
}

// New builds a collab handler bound to a room's presence hub. frameAncestors
// mirrors the terminal/lsp origin-check behaviour (space-separated origins).
// canLead validates the teacher permission for starting a forced-follow lead.
// visibleTabTypes controls which tab types are shown (nil = all visible).
func New(frameAncestors string, hub *presence.Hub, canLead func(username string) bool, visibleTabTypes map[string]bool) *Handler {
	allowed := parseOrigins(frameAncestors)
	return &Handler{
		hub:     hub,
		canLead: canLead,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return checkOrigin(r, allowed) },
		},
		visibleTabTypes: visibleTabTypes,
	}
}

// HandleWS serves GET /api/rooms/{id}/collab. Auth is validated by the protected
// mux before this point; the "auth.<token>" subprotocol is echoed so the browser
// handshake succeeds (token never appears in the URL).
func (h *Handler) HandleWS(w http.ResponseWriter, r *http.Request) {
	var chosen string
	for _, p := range websocket.Subprotocols(r) {
		if strings.HasPrefix(p, "auth.") {
			chosen = p
			break
		}
	}
	var hdr http.Header
	if chosen != "" {
		hdr = http.Header{"Sec-Websocket-Protocol": {chosen}}
	}

	conn, err := h.upgrader.Upgrade(w, r, hdr)
	if err != nil {
		log.Println("[collab] websocket upgrade error:", err)
		return
	}

	// Identity comes from the authenticated session (attached by auth.Middleware),
	// not a client-supplied query param, so presence can't be spoofed.
	username := auth.GetUsername(r)
	tabViewState := strings.TrimSpace(r.URL.Query().Get("tab_view_state"))
	id, out := h.hub.Join(username, tabViewState)
	if id == "" { // hub already closed (room shutting down)
		conn.Close()
		return
	}

	// Tell this client which roster id belongs to it. Roster broadcasts are
	// shared, so identity cannot be inferred reliably from the member list.
	selfMsg := map[string]any{"type": "self", "id": id}
	if h.visibleTabTypes != nil {
		selfMsg["visibleTabTypes"] = h.visibleTabTypes
	}
	if self, err := json.Marshal(selfMsg); err == nil {
		_ = conn.WriteMessage(websocket.TextMessage, self)
	}

	stop := make(chan struct{})
	go writePump(conn, out, stop)

	// Read loop: parse cursor/lead updates until the socket closes.
	conn.SetReadLimit(readLimit)
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if file, line, anchorLine, anchorCol, headLine, headCol, ok := parseCursor(msg); ok {
			h.hub.Update(id, file, line, anchorLine, anchorCol, headLine, headCol)
			if isDebug() {
				log.Printf("[collab-debug] cursor from %s (%s): file=%q line=%d anchorLine=%d anchorCol=%d headLine=%d headCol=%d",
					username, id, file, line, anchorLine, anchorCol, headLine, headCol)
			}
			continue
		}
		if on, ok := parseLead(msg); ok {
			if on {
				if h.canLead != nil && h.canLead(username) {
					h.hub.SetPresenter(id)
				}
			} else {
				h.hub.ClearPresenter(id)
			}
			continue
		}
		if tabs, ok := parseTabs(msg); ok {
			h.hub.UpdateTabs(id, tabs)
			continue
		}
		// Ephemeral peer signals (mouse / window) are relayed to everyone else,
		// tagged with the sender id so the client can attribute them via the roster.
		if relayed, ok := tagRelay(id, msg); ok {
			h.hub.RelayExcept(id, relayed)
		}
	}

	close(stop)     // stop the write pump promptly
	h.hub.Leave(id) // remove from roster (closes out)
	conn.Close()
}

// writePump forwards roster events to the socket and keeps it alive with pings.
func writePump(conn *websocket.Conn, out <-chan []byte, stop <-chan struct{}) {
	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		select {
		case <-stop:
			return
		case data, ok := <-out:
			if !ok {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ping.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// inbound is the client→server message shape on the collab socket.
type inbound struct {
	Type       string   `json:"type"`
	File       string   `json:"file"`
	Line       int      `json:"line"`
	AnchorLine int      `json:"anchorLine"`
	AnchorCol  int      `json:"anchorCol"`
	HeadLine   int      `json:"headLine"`
	HeadCol    int      `json:"headCol"`
	On         bool     `json:"on"`
	List       []string `json:"list"`
}

// parseCursor extracts a cursor update from a raw message. Returns ok=false for
// malformed JSON or any non-cursor message type.
func parseCursor(msg []byte) (file string, line, anchorLine, anchorCol, headLine, headCol int, ok bool) {
	var in inbound
	if err := json.Unmarshal(msg, &in); err != nil {
		return "", 0, 0, 0, 0, 0, false
	}
	if in.Type != "cursor" {
		return "", 0, 0, 0, 0, 0, false
	}
	return in.File, in.Line, in.AnchorLine, in.AnchorCol, in.HeadLine, in.HeadCol, true
}

// parseLead extracts a lead start/stop request. Returns ok=false for any other
// message type.
func parseLead(msg []byte) (on bool, ok bool) {
	var in inbound
	if err := json.Unmarshal(msg, &in); err != nil {
		return false, false
	}
	if in.Type != "lead" {
		return false, false
	}
	return in.On, true
}

// parseTabs extracts a member's open-tab list. Returns ok=false for any other
// message type.
func parseTabs(msg []byte) ([]string, bool) {
	var in inbound
	if err := json.Unmarshal(msg, &in); err != nil {
		return nil, false
	}
	if in.Type != "tabs" {
		return nil, false
	}
	return in.List, true
}

// tagRelay re-tags an ephemeral message (pointer/mouse/window/terminals) with
// the sender id so it can be fanned out to peers. Returns ok=false for any
// other message type.
func tagRelay(senderID string, msg []byte) ([]byte, bool) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(msg, &m); err != nil {
		return nil, false
	}
	raw, ok := m["type"]
	if !ok {
		return nil, false
	}
	var t string
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, false
	}
	if t != "pointer" && t != "mouse" && t != "window" && t != "terminals" {
		return nil, false
	}
	if t == "pointer" && !validPointerRelay(m) {
		return nil, false
	}
	idBytes, err := json.Marshal(senderID)
	if err != nil {
		return nil, false
	}
	m["id"] = idBytes
	out, err := json.Marshal(m)
	if err != nil {
		return nil, false
	}
	return out, true
}

// pointerTarget mirrors the client-side CollabPointer union. Only the fields
// relevant to a kind are used, but they share one struct so validation is simple.
type pointerTarget struct {
	Kind string  `json:"kind"`
	Tab  string  `json:"tab"`
	Line int     `json:"line"`
	Col  int     `json:"col"`
	Page int     `json:"page"`
	Row  int     `json:"row"`
	U    float64 `json:"u"`
	V    float64 `json:"v"`
	URL  string  `json:"url"`
}

func unitFloat(n float64) bool {
	return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 1
}

// validPointerRelay rejects malformed semantic cursor frames before they are
// fanned out. The payload is small and peer-generated, so a strict whitelist is
// cheaper than letting every client defend against arbitrary shapes.
func validPointerRelay(m map[string]json.RawMessage) bool {
	raw, ok := m["target"]
	if !ok {
		return false
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return true
	}
	var p pointerTarget
	if err := json.Unmarshal(raw, &p); err != nil {
		return false
	}
	if p.Tab == "" || len(p.Tab) > 1024 {
		return false
	}
	switch p.Kind {
	case "code":
		return p.Line > 0 && p.Col > 0
	case "image", "panel":
		return unitFloat(p.U) && unitFloat(p.V)
	case "pdf":
		return p.Page > 0 && unitFloat(p.U) && unitFloat(p.V)
	case "terminal":
		return p.Row > 0 && p.Col > 0
	case "browser":
		return len(p.URL) <= 2048 && unitFloat(p.U) && unitFloat(p.V)
	default:
		return false
	}
}
