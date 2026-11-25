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
