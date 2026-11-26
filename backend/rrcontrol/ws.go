package rrcontrol

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/coder/websocket"
)

// rrweb sends a whole DOM snapshot as one message. Those routinely exceed the
// 32 KiB default read limit of coder/websocket, which would close the client
// socket right after recording starts (StatusMessageTooBig / reconnect loop).
const websocketReadLimit = 64 << 20

// countingConn counts real bytes on the wire (after permessage-deflate).
type countingConn struct {
	net.Conn
	readBytes  atomic.Int64
	writeBytes atomic.Int64
}

func (c *countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.readBytes.Add(int64(n))
	return n, err
}

func (c *countingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.writeBytes.Add(int64(n))
	return n, err
}

// hijackCounter wraps the ResponseWriter so the hijacked net.Conn can be
// wrapped for byte counting.
type hijackCounter struct {
	http.ResponseWriter
	conn *countingConn
}

func (h *hijackCounter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := h.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not implement http.Hijacker")
	}
	nc, brw, err := hj.Hijack()
	if err != nil {
		return nil, nil, err
	}
	cc := &countingConn{Conn: nc}
	h.conn = cc
	return cc, brw, nil
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	switch role {
	case "client":
		// foreign pages connect from arbitrary origins
	case "support":
	default:
		http.Error(w, "unknown role", http.StatusBadRequest)
		return
	}

	compression := websocket.CompressionDisabled
	if *s.cfg.Compress {
		compression = websocket.CompressionContextTakeover
	}
	var subprotocols []string
	for _, value := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, protocol := range strings.Split(value, ",") {
			protocol = strings.TrimSpace(protocol)
			if strings.HasPrefix(protocol, "auth.") {
				subprotocols = []string{protocol}
				break
			}
		}
		if len(subprotocols) > 0 {
			break
		}
	}

	hc := &hijackCounter{ResponseWriter: w}
	ws, err := websocket.Accept(hc, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		CompressionMode:    compression,
		Subprotocols:       subprotocols,
	})
	if err != nil {
		log.Printf("ws accept (%s): %v", role, err)
		return
	}
	defer ws.CloseNow()
	ws.SetReadLimit(websocketReadLimit)

	conn := newConn(ws, role)
	conn.wire = hc.conn
	conn.compressed = hc.Header().Get("Sec-WebSocket-Extensions") != ""

	switch role {
	case "client":
		id := r.URL.Query().Get("tab_id")
		if id == "" {
			id = r.URL.Query().Get("id")
		}
		if id == "" {
			id = r.URL.Query().Get("rrweb-remote-access")
		}
		if id == "" {
			id = randomID(8)
		}
		if !s.hub.addClient(conn, id, r.URL.Query().Get("who")) {
			return
		}
		defer s.hub.removeConn(conn)
	case "support":
		if !s.hub.addSupport(conn) {
			return
		}
		defer s.hub.removeConn(conn)
	}

	s.hub.readLoop(conn)
}
