package rrcontrol

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type ClientInfo struct {
	ID       string `json:"id"`
	TabID    string `json:"tab_id"`
	Who      string `json:"who"`
	URL      string `json:"url"`
	Title    string `json:"title"`
	Watching bool   `json:"watching"`
	Watchers int    `json:"watchers"`
}

// clientGrace keeps a client entry alive briefly after its socket drops so a
// reload or short network blip can reconnect under the same tab id without
// tearing down the viewer.
const clientGrace = 20 * time.Second

const (
	websocketKeepaliveInterval = 20 * time.Second
	websocketKeepaliveTimeout  = 10 * time.Second
)

type client struct {
	info       ClientInfo
	conn       *Conn
	goneTimer  *time.Timer
	watchers   int
	inviteSent bool
	events     int64
	payload    int64
}

type Conn struct {
	ws               *websocket.Conn
	writeMu          sync.Mutex
	role             string
	clientID         string
	target           string
	wire             *countingConn
	compressed       bool
	awaitingSnapshot bool
}

func (c *Conn) wireIn() int64 {
	if c.wire == nil {
		return 0
	}
	return c.wire.readBytes.Load()
}

func (c *Conn) wireOut() int64 {
	if c.wire == nil {
		return 0
	}
	return c.wire.writeBytes.Load()
}

func newConn(ws *websocket.Conn, role string) *Conn {
	return &Conn{ws: ws, role: role}
}

func (c *Conn) send(v any) {
	if c.ws == nil {
		return
	}
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("ws marshal (%s): %v", c.role, err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.ws.Write(ctx, websocket.MessageText, data); err != nil {
		log.Printf("ws write (%s): %v", c.role, err)
	}
}

type inMsg struct {
	Type     string          `json:"type"`
	Who      string          `json:"who"`
	URL      string          `json:"url"`
	Title    string          `json:"title"`
	Target   string          `json:"target"`
	Event    json.RawMessage `json:"event"`
	Control  json.RawMessage `json:"control"`
	Accepted bool            `json:"accepted"`
}

type Hub struct {
	cfg               *Config
	mu                sync.Mutex
	clients           map[string]*client
	supports          map[*Conn]struct{}
	pending           map[string][]*Conn
	keepaliveInterval time.Duration
	keepaliveTimeout  time.Duration
}

func NewHub(cfg *Config) *Hub {
	return &Hub{
		cfg:               cfg,
		clients:           make(map[string]*client),
		supports:          make(map[*Conn]struct{}),
		pending:           make(map[string][]*Conn),
		keepaliveInterval: websocketKeepaliveInterval,
		keepaliveTimeout:  websocketKeepaliveTimeout,
	}
}

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (h *Hub) addClient(c *Conn, id, who string) bool {
	who = sanitizeWho(who)
	h.mu.Lock()
	if h.cfg.Control == "off" {
		h.mu.Unlock()
		return false
	}
	if existing := h.clients[id]; existing != nil && existing.conn != nil && existing.conn != c {
		// sessionStorage can be copied when a browser duplicates or opens a tab.
		// Keep both live pages addressable rather than replacing the first socket.
		for {
			id = randomID(8)
			if h.clients[id] == nil {
				break
			}
		}
	}
	c.clientID = id
	// A page that reconnects (e.g. after a reload) keeps its id. Carry active
	// watchers over to the new connection so the viewer continues without
	// asking again, and cancel any pending grace timer.
	watchers := 0
	needInvite := false
	cl := h.clients[id]
	if cl != nil {
		if cl.goneTimer != nil {
			cl.goneTimer.Stop()
			cl.goneTimer = nil
		}
		watchers = cl.watchers
		if who != "" {
			cl.info.Who = who
		}
		cl.info.Watching = watchers > 0
		cl.info.Watchers = watchers
		cl.events = 0
		cl.payload = 0
		needInvite = len(h.pending[id]) > 0
		cl.inviteSent = needInvite
	} else {
		cl = &client{
			info: ClientInfo{
				ID:       id,
				TabID:    id,
				Who:      who,
				Watching: false,
				Watchers: 0,
			},
		}
		h.clients[id] = cl
	}
	cl.conn = c
	cl.info.URL = ""
	cl.info.Title = ""
	canControl := h.cfg.Control != "no"
	h.mu.Unlock()

	c.send(map[string]any{"type": "identity", "id": id})
	if watchers > 0 {
		c.send(map[string]any{"type": "watch-start", "id": id, "canControl": canControl})
	}
	if needInvite {
		c.send(map[string]any{"type": "watch-request"})
	}
	h.broadcastList()
	log.Printf("client connected: id=%s who=%q watchers=%d", id, who, watchers)
	return true
}

func sanitizeWho(who string) string {
	who = strings.TrimSpace(who)
	name := []rune(who)
	if len(name) > 80 {
		who = string(name[:80])
	}
	return who
}

func (h *Hub) addSupport(c *Conn) bool {
	h.mu.Lock()
	if h.cfg.Control == "off" {
		h.mu.Unlock()
		return false
	}
	h.supports[c] = struct{}{}
	h.mu.Unlock()
	c.send(h.listPayload())
	log.Printf("support connected")
	return true
}

func (h *Hub) closeAll() {
	h.mu.Lock()
	connections := make(map[*Conn]struct{}, len(h.clients)+len(h.supports))
	for _, cl := range h.clients {
		connections[cl.conn] = struct{}{}
	}
	for c := range h.supports {
		connections[c] = struct{}{}
	}
	h.mu.Unlock()

	for c := range connections {
		if c != nil && c.ws != nil {
			c.ws.CloseNow()
		}
	}
}

func (h *Hub) removeConn(c *Conn) {
	if c.role == "client" {
		id := c.clientID
		h.mu.Lock()
		cl := h.clients[id]
		// Ignore the old socket if this page already reconnected under the same id.
		if cl == nil || cl.conn != c {
			h.mu.Unlock()
			return
		}
		if cl.watchers == 0 && len(h.pending[id]) == 0 {
			delete(h.clients, id)
			h.mu.Unlock()
			h.broadcastList()
			log.Printf("client disconnected: id=%s", id)
			return
		}
		// Keep the entry alive for a short grace period so a reload can
		// reconnect and keep the viewer attached.
		cl.conn = nil
		watchers := cl.watchers
		pending := len(h.pending[id])
		cl.goneTimer = time.AfterFunc(clientGrace, func() { h.expireClient(id, cl) })
		h.mu.Unlock()
		log.Printf("client disconnected (grace %s): id=%s watchers=%d pending=%d", clientGrace, id, watchers, pending)
		return
	}

	h.unwatch(c)
	h.mu.Lock()
	delete(h.supports, c)
	h.mu.Unlock()
	log.Printf("support disconnected")
}

func (h *Hub) expireClient(id string, cl *client) {
	h.mu.Lock()
	if h.clients[id] != cl || cl.conn != nil {
		h.mu.Unlock()
		return
	}
	delete(h.clients, id)
	pending := h.pending[id]
	delete(h.pending, id)
	var watchers []*Conn
	for s := range h.supports {
		if s.target == id {
			s.target = ""
			watchers = append(watchers, s)
		}
	}
	h.mu.Unlock()

	gone := map[string]any{"type": "client-gone", "target": id}
	for _, s := range pending {
		s.send(gone)
	}
	for _, s := range watchers {
		s.send(gone)
	}
	h.broadcastList()
	log.Printf("client expired: id=%s", id)
}

func (h *Hub) readLoop(c *Conn) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go websocketKeepalive(ctx, c, h.keepaliveInterval, h.keepaliveTimeout)
	for {
		_, data, err := c.ws.Read(ctx)
		if err != nil {
			if status := websocket.CloseStatus(err); status != -1 && status != websocket.StatusNormalClosure && ctx.Err() == nil {
				log.Printf("ws read (%s): %v (status %d %s)", c.role, err, status, status)
			}
			return
		}
		h.handle(c, data)
	}
}

func websocketKeepalive(ctx context.Context, c *Conn, interval, timeout time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, timeout)
			err := c.ws.Ping(pingCtx)
			cancel()
			if err != nil {
				if ctx.Err() == nil {
					log.Printf("ws keepalive (%s): %v", c.role, err)
				}
				c.ws.CloseNow()
				return
			}
		}
	}
}

func (h *Hub) handle(c *Conn, data []byte) {
	var m inMsg
	if err := json.Unmarshal(data, &m); err != nil {
		log.Printf("ws bad message (%s): %v", c.role, err)
		return
	}
	if c.role == "client" {
		h.handleClient(c, &m)
	} else {
		h.handleSupport(c, &m)
	}
}

func (h *Hub) handleClient(c *Conn, m *inMsg) {
	switch m.Type {
	case "hello":
		h.mu.Lock()
		if cl := h.clients[c.clientID]; cl != nil && cl.conn == c {
			if m.Who != "" {
				cl.info.Who = sanitizeWho(m.Who)
			}
			cl.info.URL = m.URL
			cl.info.Title = m.Title
		}
		h.mu.Unlock()
		h.broadcastList()
	case "who-update":
		h.mu.Lock()
		if cl := h.clients[c.clientID]; cl != nil && cl.conn == c {
			cl.info.Who = sanitizeWho(m.Who)
		}
		h.mu.Unlock()
		h.broadcastList()
	case "rrweb":
		if len(m.Event) == 0 {
			return
		}
		kind := eventType(m.Event)
		h.mu.Lock()
		if h.cfg.Control == "off" {
			h.mu.Unlock()
			return
		}
		cl := h.clients[c.clientID]
		if cl == nil || cl.conn != c {
			// A reloaded page already owns this id; ignore the stale socket.
			h.mu.Unlock()
			return
		}
		cl.events++
		cl.payload += int64(len(m.Event))
		var targets []*Conn
		for s := range h.supports {
			if s.target != c.clientID {
				continue
			}
			if s.awaitingSnapshot {
				if kind == 4 {
					// Meta is useful before the full snapshot.
				} else if kind == 2 {
					s.awaitingSnapshot = false
				} else {
					continue
				}
			}
			targets = append(targets, s)
		}
		h.mu.Unlock()
		if len(targets) == 0 {
			return
		}
		payload := map[string]any{"type": "rrweb", "event": json.RawMessage(m.Event)}
		for _, s := range targets {
			s.send(payload)
		}
	case "invite-response":
		h.inviteResponse(c.clientID, m.Accepted)
	}
}

func eventType(raw json.RawMessage) int {
	var ev struct {
		Type int `json:"type"`
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		return -1
	}
	return ev.Type
}

func (h *Hub) handleSupport(c *Conn, m *inMsg) {
	switch m.Type {
	case "list-request":
		c.send(h.listPayload())
	case "watch":
		h.watch(c, m.Target)
	case "unwatch":
		h.unwatch(c)
	case "control":
		h.forwardControl(c, m.Control)
	case "stats-request":
		h.sendStats(c)
	}
}

func (h *Hub) sendStats(c *Conn) {
	h.mu.Lock()
	target := c.target
	var cl *client
	if target != "" {
		cl = h.clients[target]
	}
	if cl == nil {
		h.mu.Unlock()
		return
	}
	events, payload := cl.events, cl.payload
	var pageUp, pageDown int64
	compressed := false
	if cl.conn != nil {
		pageUp, pageDown = cl.conn.wireIn(), cl.conn.wireOut()
		compressed = cl.conn.compressed && c.compressed
	}
	h.mu.Unlock()

	c.send(map[string]any{
		"type":       "stats",
		"target":     target,
		"events":     events,
		"payload":    payload,
		"pageUp":     pageUp,
		"pageDown":   pageDown,
		"viewerUp":   c.wireIn(),
		"viewerDown": c.wireOut(),
		"compressed": compressed,
	})
}

func (h *Hub) listPayload() map[string]any {
	h.mu.Lock()
	infos := make([]ClientInfo, 0, len(h.clients))
	for _, cl := range h.clients {
		infos = append(infos, cl.info)
	}
	h.mu.Unlock()

	sort.Slice(infos, func(i, j int) bool {
		if infos[i].Who != infos[j].Who {
			return infos[i].Who < infos[j].Who
		}
		return infos[i].ID < infos[j].ID
	})
	return map[string]any{"type": "list", "clients": infos}
}

func (h *Hub) broadcastList() {
	payload := h.listPayload()
	h.mu.Lock()
	targets := make([]*Conn, 0, len(h.supports))
	for s := range h.supports {
		targets = append(targets, s)
	}
	h.mu.Unlock()
	for _, s := range targets {
		s.send(payload)
	}
}

func (h *Hub) watch(c *Conn, target string) {
	if target == "" {
		c.send(map[string]any{"type": "watch-denied", "reason": "missing target"})
		return
	}

	h.unwatch(c)

	h.mu.Lock()
	if h.cfg.Control == "off" {
		h.mu.Unlock()
		c.send(map[string]any{"type": "watch-denied", "reason": "rrcontrol is disabled"})
		return
	}
	cl := h.clients[target]
	if cl == nil {
		h.mu.Unlock()
		c.send(map[string]any{"type": "watch-denied", "reason": "page is gone"})
		return
	}
	if h.cfg.Control == "invite" {
		h.pending[target] = append(h.pending[target], c)
		needNotify := !cl.inviteSent
		cl.inviteSent = true
		conn := cl.conn
		h.mu.Unlock()

		c.send(map[string]any{"type": "watch-pending"})
		if needNotify && conn != nil {
			conn.send(map[string]any{"type": "watch-request"})
		}
		return
	}
	h.mu.Unlock()

	h.attach(c, target)
}

func (h *Hub) attach(c *Conn, target string) {
	h.mu.Lock()
	if h.cfg.Control == "off" {
		h.mu.Unlock()
		c.send(map[string]any{"type": "watch-denied", "reason": "rrcontrol is disabled"})
		return
	}
	cl := h.clients[target]
	if cl == nil {
		h.mu.Unlock()
		c.send(map[string]any{"type": "watch-denied", "reason": "page is gone"})
		return
	}
	c.target = target
	cl.watchers++
	cl.info.Watchers = cl.watchers
	cl.info.Watching = true
	first := cl.watchers == 1
	c.awaitingSnapshot = !first
	info := cl.info
	conn := cl.conn
	canControl := h.cfg.Control != "no"
	needSnapshot := !first && conn != nil
	h.mu.Unlock()

	if first && conn != nil {
		conn.send(map[string]any{"type": "watch-start", "id": target, "canControl": canControl})
	}
	if needSnapshot {
		conn.send(map[string]any{"type": "full-snapshot"})
	}
	c.send(map[string]any{
		"type":       "watch-started",
		"target":     target,
		"canControl": canControl,
		"who":        info.Who,
		"url":        info.URL,
		"title":      info.Title,
	})
	h.broadcastList()
}

func (h *Hub) unwatch(c *Conn) {
	h.mu.Lock()

	affected := make(map[string]bool)
	for id, list := range h.pending {
		kept := list[:0]
		for _, p := range list {
			if p != c {
				kept = append(kept, p)
			}
		}
		if len(kept) == 0 {
			delete(h.pending, id)
			affected[id] = true
		} else {
			h.pending[id] = kept
		}
	}
	for id := range affected {
		if cl := h.clients[id]; cl != nil {
			cl.inviteSent = false
		}
	}

	target := c.target
	if target == "" {
		h.mu.Unlock()
		return
	}
	c.target = ""

	var stopConn *Conn
	var summary string
	if cl := h.clients[target]; cl != nil {
		if cl.watchers > 0 {
			cl.watchers--
		}
		cl.info.Watchers = cl.watchers
		cl.info.Watching = cl.watchers > 0
		if cl.watchers == 0 {
			stopConn = cl.conn
			var pageUp int64
			if cl.conn != nil {
				pageUp = cl.conn.wireIn()
			}
			summary = fmt.Sprintf(
				"watch ended: client=%s events=%d rrweb_payload=%dB page_wire_up=%dB",
				target, cl.events, cl.payload, pageUp,
			)
		}
	}
	h.mu.Unlock()

	if stopConn != nil {
		stopConn.send(map[string]any{"type": "watch-stop"})
	}
	if summary != "" {
		log.Print(summary)
	}
	h.broadcastList()
}

func (h *Hub) inviteResponse(clientID string, accepted bool) {
	h.mu.Lock()
	cl := h.clients[clientID]
	pending := h.pending[clientID]
	delete(h.pending, clientID)
	if cl != nil {
		cl.inviteSent = false
	}
	h.mu.Unlock()

	if !accepted {
		for _, c := range pending {
			c.send(map[string]any{"type": "watch-denied", "reason": "declined by visitor"})
		}
		h.broadcastList()
		return
	}
	for _, c := range pending {
		h.attach(c, clientID)
	}
}

func (h *Hub) forwardControl(c *Conn, raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}

	h.mu.Lock()
	target := c.target
	policy := h.cfg.Control
	var targetConn *Conn
	if cl := h.clients[target]; cl != nil {
		targetConn = cl.conn
	}
	h.mu.Unlock()

	if target == "" {
		return
	}
	if policy == "off" || policy == "no" {
		c.send(map[string]any{"type": "control-denied", "reason": "control disabled by policy"})
		return
	}
	if targetConn == nil {
		c.send(map[string]any{"type": "watch-denied", "reason": "page is gone"})
		return
	}
	targetConn.send(map[string]any{"type": "control", "control": json.RawMessage(raw)})
}
