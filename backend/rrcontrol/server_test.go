package rrcontrol

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestSupportSocketRequiresTeacher(t *testing.T) {
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer valid" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	server, err := New(Options{
		ControlMode:  "no",
		Authenticate: authenticate,
		IsTeacher:    func(r *http.Request) bool { return r.Header.Get("X-Teacher") == "yes" },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	for _, tc := range []struct {
		name       string
		authority  string
		teacher    string
		wantStatus int
	}{
		{name: "unauthenticated", wantStatus: http.StatusUnauthorized},
		{name: "non-teacher", authority: "Bearer valid", wantStatus: http.StatusForbidden},
		{name: "teacher", authority: "Bearer valid", teacher: "yes", wantStatus: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodGet, httpServer.URL+"/ws?role=support", nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.authority != "" {
				req.Header.Set("Authorization", tc.authority)
			}
			if tc.teacher != "" {
				req.Header.Set("X-Teacher", tc.teacher)
			}
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.StatusCode != tc.wantStatus {
				t.Errorf("status = %d, want %d", res.StatusCode, tc.wantStatus)
			}
		})
	}
}

func TestSupportSocketNegotiatesAuthenticationSubprotocolThroughProxyPrefix(t *testing.T) {
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Sec-WebSocket-Protocol") != "auth.valid" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	server, err := New(Options{
		ControlMode:  "no",
		Authenticate: authenticate,
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	wedeMux := http.NewServeMux()
	wedeMux.Handle("/rrcontrol/", http.StripPrefix("/rrcontrol", server.Handler()))
	httpServer := httptest.NewServer(http.StripPrefix("/foo", wedeMux))
	defer httpServer.Close()

	wsURL := "ws" + httpServer.URL[len("http"):] + "/foo/rrcontrol/ws?role=support"
	conn, _, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{
		Subprotocols: []string{"auth.valid"},
	})
	if err != nil {
		t.Fatalf("websocket.Dial: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "test complete")
	if got := conn.Subprotocol(); got != "auth.valid" {
		t.Fatalf("negotiated subprotocol = %q, want %q", got, "auth.valid")
	}
}

func TestConcurrentClientSocketsWithCopiedTabIDGetDistinctIdentities(t *testing.T) {
	server, err := New(Options{
		ControlMode:  "yes",
		Authenticate: func(next http.Handler) http.Handler { return next },
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	baseURL := "ws" + httpServer.URL[len("http"):]

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dial := func() (*websocket.Conn, string) {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, baseURL+"/ws?role=client&tab_id=copied-tab-id", nil)
		if err != nil {
			t.Fatalf("dial client: %v", err)
		}
		readCtx, readCancel := context.WithTimeout(ctx, 3*time.Second)
		defer readCancel()
		_, data, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("read client identity: %v", err)
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode client identity: %v", err)
		}
		if message["type"] != "identity" {
			t.Fatalf("first client message = %v, want identity", message["type"])
		}
		id, ok := message["id"].(string)
		if !ok || id == "" {
			t.Fatalf("client identity id = %v, want non-empty string", message["id"])
		}
		return conn, id
	}

	first, firstID := dial()
	defer first.Close(websocket.StatusNormalClosure, "test complete")
	second, secondID := dial()
	defer second.Close(websocket.StatusNormalClosure, "test complete")

	if firstID != "copied-tab-id" {
		t.Fatalf("first identity = %q, want original tab id", firstID)
	}
	if secondID == firstID {
		t.Fatalf("concurrent client received duplicate identity %q", secondID)
	}

	server.hub.mu.Lock()
	defer server.hub.mu.Unlock()
	if len(server.hub.clients) != 2 {
		t.Fatalf("registered clients = %d, want 2", len(server.hub.clients))
	}
}

func TestWebSocketKeepaliveSendsPing(t *testing.T) {
	pingReceived := make(chan struct{}, 1)
	server, err := New(Options{
		ControlMode:  "no",
		Authenticate: func(next http.Handler) http.Handler { return next },
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	server.hub.keepaliveInterval = 10 * time.Millisecond
	server.hub.keepaliveTimeout = time.Second
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()

	wsURL := "ws" + httpServer.URL[len("http"):] + "/ws?role=client"
	client, _, err := websocket.Dial(context.Background(), wsURL, &websocket.DialOptions{
		OnPingReceived: func(context.Context, []byte) bool {
			pingReceived <- struct{}{}
			return true
		},
	})
	if err != nil {
		t.Fatalf("websocket.Dial: %v", err)
	}
	readDone := make(chan struct{})
	defer func() {
		_ = client.Close(websocket.StatusNormalClosure, "test complete")
		<-readDone
	}()
	go func() {
		defer close(readDone)
		for {
			if _, _, err := client.Read(context.Background()); err != nil {
				return
			}
		}
	}()

	select {
	case <-pingReceived:
	case <-time.After(time.Second):
		t.Fatal("server did not send a WebSocket ping")
	}
}

func TestSecondViewerDoesNotDisconnectWatchedClient(t *testing.T) {
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Sec-WebSocket-Protocol") != "auth.valid" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	server, err := New(Options{
		ControlMode:  "yes",
		Authenticate: authenticate,
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	baseURL := "ws" + httpServer.URL[len("http"):]

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	client, _, err := websocket.Dial(ctx, baseURL+"/ws?role=client&tab_id=student-tab", nil)
	if err != nil {
		t.Fatalf("dial client: %v", err)
	}
	defer client.Close(websocket.StatusNormalClosure, "test complete")
	if err := client.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","who":"student"}`)); err != nil {
		t.Fatalf("client hello: %v", err)
	}

	readMessage := func(conn *websocket.Conn) map[string]any {
		t.Helper()
		readCtx, readCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer readCancel()
		_, data, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("read WebSocket message: %v", err)
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode WebSocket message: %v", err)
		}
		return message
	}
	if got := readMessage(client)["type"]; got != "identity" {
		t.Fatalf("initial client message = %v, want identity", got)
	}
	connectSupport := func() *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, baseURL+"/ws?role=support", &websocket.DialOptions{
			Subprotocols: []string{"auth.valid"},
		})
		if err != nil {
			t.Fatalf("dial support: %v", err)
		}
		return conn
	}
	watch := func(conn *websocket.Conn) {
		t.Helper()
		if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"watch","target":"student-tab"}`)); err != nil {
			t.Fatalf("send watch: %v", err)
		}
		if got := readMessage(conn)["type"]; got != "watch-started" {
			t.Fatalf("watch response type = %v, want watch-started", got)
		}
	}

	firstViewer := connectSupport()
	defer firstViewer.Close(websocket.StatusNormalClosure, "test complete")
	if got := readMessage(firstViewer)["type"]; got != "list" {
		t.Fatalf("initial first-viewer message = %v, want list", got)
	}
	watch(firstViewer)
	if got := readMessage(client)["type"]; got != "watch-start" {
		t.Fatalf("client message = %v, want watch-start", got)
	}
	readMessage(firstViewer) // list update for the first active viewer

	secondViewer := connectSupport()
	defer secondViewer.Close(websocket.StatusNormalClosure, "test complete")
	if got := readMessage(secondViewer)["type"]; got != "list" {
		t.Fatalf("initial second-viewer message = %v, want list", got)
	}
	watch(secondViewer)
	updatedList := readMessage(firstViewer)
	clients, ok := updatedList["clients"].([]any)
	if updatedList["type"] != "list" || !ok || len(clients) != 1 {
		t.Fatalf("unexpected client list after second viewer connected: %#v", updatedList)
	}
	clientInfo, ok := clients[0].(map[string]any)
	if !ok || clientInfo["id"] != "student-tab" || clientInfo["watchers"] != float64(2) {
		t.Fatalf("watched client missing or watcher count wrong: %#v", clients[0])
	}

	if err := client.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","who":"student-still-connected"}`)); err != nil {
		t.Fatalf("update client hello: %v", err)
	}
	updatedList = readMessage(firstViewer)
	clients, ok = updatedList["clients"].([]any)
	if updatedList["type"] != "list" || !ok || len(clients) != 1 || clients[0].(map[string]any)["who"] != "student-still-connected" {
		t.Fatalf("client did not remain connected after second viewer attached: %#v", updatedList)
	}
}

func TestRRControlOffHidesDashboard(t *testing.T) {
	server, err := New(Options{ControlMode: "off"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	res := httptest.NewRecorder()
	for _, path := range []string{"/remote-control", "/test-page", "/script.js", "/rc/main.js", "/ws?role=client"} {
		res = httptest.NewRecorder()
		server.Handler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, path, nil))
		if res.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want 404", path, res.Code)
		}
	}
}

func TestTestPageIsServedAndLoadsMountedRecorder(t *testing.T) {
	server, err := New(Options{
		ControlMode:  "no",
		Authenticate: func(next http.Handler) http.Handler { return next },
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/test-page", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("test page status = %d, want %d", rec.Code, http.StatusOK)
	}
	for _, want := range []string{"rrweb remote access — test page", "script.js?who=visitor-1", `href="remote-control"`} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("test page missing %q", want)
		}
	}
}

func TestDashboardLinksToStandaloneTestPage(t *testing.T) {
	server, err := New(Options{
		ControlMode:  "no",
		Authenticate: func(next http.Handler) http.Handler { return next },
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/remote-control", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), `href="test-page" target="_blank"`) || !strings.Contains(rec.Body.String(), "Open the test page") {
		t.Fatal("dashboard empty state is missing the standalone test-page link")
	}
}

func TestClientReloadWithinGraceKeepsViewerAttached(t *testing.T) {
	server, err := New(Options{
		ControlMode:  "yes",
		Authenticate: func(next http.Handler) http.Handler { return next },
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	baseURL := "ws" + httpServer.URL[len("http"):]

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	readMessage := func(conn *websocket.Conn) map[string]any {
		t.Helper()
		readCtx, readCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer readCancel()
		_, data, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("read WebSocket message: %v", err)
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode WebSocket message: %v", err)
		}
		return message
	}

	dialClient := func() *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, baseURL+"/ws?role=client&tab_id=stable-tab", nil)
		if err != nil {
			t.Fatalf("dial client: %v", err)
		}
		if got := readMessage(conn)["type"]; got != "identity" {
			t.Fatalf("client first message = %v, want identity", got)
		}
		return conn
	}

	firstClient := dialClient()
	if err := firstClient.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","who":"student"}`)); err != nil {
		t.Fatalf("client hello: %v", err)
	}

	support, _, err := websocket.Dial(ctx, baseURL+"/ws?role=support", nil)
	if err != nil {
		t.Fatalf("dial support: %v", err)
	}
	defer support.Close(websocket.StatusNormalClosure, "test complete")
	if got := readMessage(support)["type"]; got != "list" {
		t.Fatalf("support first message = %v, want list", got)
	}
	if err := support.Write(ctx, websocket.MessageText, []byte(`{"type":"watch","target":"stable-tab"}`)); err != nil {
		t.Fatalf("send watch: %v", err)
	}
	if got := readMessage(support)["type"]; got != "watch-started" {
		t.Fatalf("support watch response = %v, want watch-started", got)
	}
	if got := readMessage(firstClient)["type"]; got != "watch-start" {
		t.Fatalf("client watch message = %v, want watch-start", got)
	}
	readMessage(support) // list update after attach

	// Simulate a reload: drop the socket and reconnect with the same tab id.
	if err := firstClient.Close(websocket.StatusNormalClosure, "reload"); err != nil {
		t.Fatalf("close first client: %v", err)
	}
	reloaded := dialClient()
	defer reloaded.Close(websocket.StatusNormalClosure, "test complete")
	if got := readMessage(reloaded)["type"]; got != "watch-start" {
		t.Fatalf("reloaded client message = %v, want watch-start", got)
	}

	list := readMessage(support)
	if list["type"] == "client-gone" {
		t.Fatal("viewer was told the page disconnected despite reconnecting within the grace period")
	}
	clients, ok := list["clients"].([]any)
	if list["type"] != "list" || !ok || len(clients) != 1 {
		t.Fatalf("unexpected client list after reload: %#v", list)
	}
	info, ok := clients[0].(map[string]any)
	if !ok || info["id"] != "stable-tab" || info["watchers"] != float64(1) {
		t.Fatalf("reloaded client did not keep its viewer: %#v", clients[0])
	}

	if err := reloaded.Write(ctx, websocket.MessageText, []byte(`{"type":"rrweb","event":{"type":4,"data":{}}}`)); err != nil {
		t.Fatalf("send rrweb: %v", err)
	}
	if got := readMessage(support)["type"]; got != "rrweb" {
		t.Fatalf("support message after reload = %v, want rrweb", got)
	}
}

// rrweb wraps a full DOM snapshot in a single message. Those are routinely
// larger than coder/websocket's 32 KiB default read limit, and the resulting
// StatusMessageTooBig close used to send the client into a reconnect loop.
func TestLargeRRWebFrameKeepsClientConnected(t *testing.T) {
	server, err := New(Options{
		ControlMode:  "yes",
		Authenticate: func(next http.Handler) http.Handler { return next },
		IsTeacher:    func(*http.Request) bool { return true },
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	baseURL := "ws" + httpServer.URL[len("http"):]

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	readMessage := func(conn *websocket.Conn) map[string]any {
		t.Helper()
		readCtx, readCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer readCancel()
		_, data, err := conn.Read(readCtx)
		if err != nil {
			t.Fatalf("read WebSocket message: %v", err)
		}
		var message map[string]any
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatalf("decode WebSocket message: %v", err)
		}
		return message
	}

	client, _, err := websocket.Dial(ctx, baseURL+"/ws?role=client&tab_id=snapshot-tab", nil)
	if err != nil {
		t.Fatalf("dial client: %v", err)
	}
	defer client.Close(websocket.StatusNormalClosure, "test complete")
	client.SetReadLimit(websocketReadLimit)
	if got := readMessage(client)["type"]; got != "identity" {
		t.Fatalf("client first message = %v, want identity", got)
	}
	if err := client.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","who":"student"}`)); err != nil {
		t.Fatalf("client hello: %v", err)
	}

	support, _, err := websocket.Dial(ctx, baseURL+"/ws?role=support", nil)
	if err != nil {
		t.Fatalf("dial support: %v", err)
	}
	defer support.Close(websocket.StatusNormalClosure, "test complete")
	support.SetReadLimit(websocketReadLimit)
	if got := readMessage(support)["type"]; got != "list" {
		t.Fatalf("support first message = %v, want list", got)
	}
	if err := support.Write(ctx, websocket.MessageText, []byte(`{"type":"watch","target":"snapshot-tab"}`)); err != nil {
		t.Fatalf("send watch: %v", err)
	}
	if got := readMessage(support)["type"]; got != "watch-started" {
		t.Fatalf("support watch response = %v, want watch-started", got)
	}
	if got := readMessage(client)["type"]; got != "watch-start" {
		t.Fatalf("client watch message = %v, want watch-start", got)
	}
	readMessage(support) // list update after attach

	payload, err := json.Marshal(map[string]any{
		"type":  "rrweb",
		"event": map[string]any{"type": 4, "data": strings.Repeat("x", 256<<10)},
	})
	if err != nil {
		t.Fatalf("marshal rrweb: %v", err)
	}
	if len(payload) <= 32768 {
		t.Fatalf("test payload is %d bytes, want more than the 32 KiB default limit", len(payload))
	}
	if err := client.Write(ctx, websocket.MessageText, payload); err != nil {
		t.Fatalf("send large rrweb: %v", err)
	}
	if got := readMessage(support)["type"]; got != "rrweb" {
		t.Fatalf("support message after large frame = %v, want rrweb", got)
	}

	if err := client.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","who":"still-connected"}`)); err != nil {
		t.Fatalf("client hello after large frame: %v", err)
	}
	list := readMessage(support)
	if list["type"] == "client-gone" {
		t.Fatal("client was disconnected after sending an rrweb frame larger than 32 KiB")
	}
	clients, ok := list["clients"].([]any)
	if list["type"] != "list" || !ok || len(clients) != 1 {
		t.Fatalf("unexpected client list after large frame: %#v", list)
	}
	if info, ok := clients[0].(map[string]any); !ok || info["who"] != "still-connected" {
		t.Fatalf("client did not stay connected after large frame: %#v", clients[0])
	}
}
