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

type client struct {
	info       ClientInfo
	conn       *Conn
	watchers   int
	inviteSent bool
	events     int64
	payload    int64
}

type Conn struct {
	ws         *websocket.Conn
	writeMu    sync.Mutex
	role       string
	clientID   string
	target     string
	wire       *countingConn
	compressed bool
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
	cfg      *Config
	mu       sync.Mutex
	clients  map[string]*client
	supports map[*Conn]struct{}
	pending  map[string][]*Conn
}

func NewHub(cfg *Config) *Hub {
	return &Hub{
		cfg:      cfg,
		clients:  make(map[string]*client),
		supports: make(map[*Conn]struct{}),
		pending:  make(map[string][]*Conn),
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
	c.clientID = id
	who = sanitizeWho(who)
	h.mu.Lock()
	if h.cfg.Control == "off" {
		h.mu.Unlock()
		return false
	}
	// A page that reconnects keeps its id. Carry active watchers over to the
	// new connection so the viewer can continue without clicking again.
	watchers := 0
	if old := h.clients[id]; old != nil {
		watchers = old.watchers
	}
	h.clients[id] = &client{
		info: ClientInfo{
			ID:       id,
			TabID:    id,
			Who:      who,
			Watching: watchers > 0,
			Watchers: watchers,
		},
		conn:     c,
		watchers: watchers,
	}
	canControl := h.cfg.Control != "no"
	h.mu.Unlock()

	if watchers > 0 {
		c.send(map[string]any{"type": "watch-start", "canControl": canControl})
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
		// Ignore the old socket if this page already reconnected under the same id.
		if cl := h.clients[id]; cl != nil && cl.conn != c {
			h.mu.Unlock()
			return
		}
		delete(h.clients, id)
		delete(h.pending, id)
		var watchers []*Conn
		for s := range h.supports {
			if s.target == id {
				s.target = ""
				watchers = append(watchers, s)
			}
		}
		h.mu.Unlock()
		for _, s := range watchers {
			s.send(map[string]any{"type": "client-gone", "target": id})
		}
		h.broadcastList()
		log.Printf("client disconnected: id=%s", id)
		return
	}

	h.unwatch(c)
	h.mu.Lock()
	delete(h.supports, c)
	h.mu.Unlock()
	log.Printf("support disconnected")
}

func (h *Hub) readLoop(c *Conn) {
	ctx := context.Background()
	for {
		_, data, err := c.ws.Read(ctx)
		if err != nil {
			return
		}
		h.handle(c, data)
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
		if cl := h.clients[c.clientID]; cl != nil {
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
		if cl := h.clients[c.clientID]; cl != nil {
			cl.info.Who = sanitizeWho(m.Who)
		}
		h.mu.Unlock()
		h.broadcastList()
	case "rrweb":
		if len(m.Event) == 0 {
			return
		}
		h.mu.Lock()
		if h.cfg.Control == "off" {
			h.mu.Unlock()
			return
		}
		if cl := h.clients[c.clientID]; cl != nil {
			cl.events++
			cl.payload += int64(len(m.Event))
		}
		var targets []*Conn
		for s := range h.supports {
			if s.target == c.clientID {
				targets = append(targets, s)
			}
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
	pageUp, pageDown := cl.conn.wireIn(), cl.conn.wireOut()
	compressed := cl.conn.compressed && c.compressed
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
		if needNotify {
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
	info := cl.info
	conn := cl.conn
	canControl := h.cfg.Control != "no"
	h.mu.Unlock()

	if first {
		conn.send(map[string]any{"type": "watch-start", "canControl": canControl})
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
			summary = fmt.Sprintf(
				"watch ended: client=%s events=%d rrweb_payload=%dB page_wire_up=%dB",
				target, cl.events, cl.payload, cl.conn.wireIn(),
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
