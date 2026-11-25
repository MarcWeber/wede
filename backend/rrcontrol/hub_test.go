package rrcontrol

import "testing"

func TestWhoUpdateKeepsTabIdentity(t *testing.T) {
	hub := NewHub(&Config{Control: "no"})
	client := &Conn{}
	hub.addClient(client, "tab-123", "before-login")

	hub.handleClient(client, &inMsg{Type: "who-update", Who: "  alice  "})

	info := hub.clients[client.clientID].info
	if info.TabID != "tab-123" || info.ID != "tab-123" {
		t.Fatalf("tab identity changed after who update: %+v", info)
	}
	if info.Who != "alice" {
		t.Fatalf("Who = %q, want trimmed login name", info.Who)
	}
}

func TestOffModeRejectsNewConnections(t *testing.T) {
	hub := NewHub(&Config{Control: "off"})
	if hub.addClient(&Conn{}, "tab-123", "student") {
		t.Fatal("off mode accepted a client connection")
	}
	if hub.addSupport(&Conn{}) {
		t.Fatal("off mode accepted a support connection")
	}
	if len(hub.clients) != 0 || len(hub.supports) != 0 {
		t.Fatal("off mode retained a rejected connection")
	}
}
