package presence

import (
	"encoding/json"
	"strings"
	"testing"
)

// lastRoster drains a channel non-blockingly and returns the members from the
// most recent roster event (nil if none pending).
func lastRoster(t *testing.T, ch <-chan []byte) []Member {
	t.Helper()
	var members []Member
	got := false
	for {
		select {
		case data, ok := <-ch:
			if !ok {
				return members
			}
			var ev rosterEvent
			if err := json.Unmarshal(data, &ev); err != nil {
				t.Fatalf("bad roster json: %v", err)
			}
			members = ev.Members
			got = true
		default:
			if !got {
				return nil
			}
			return members
		}
	}
}

func find(members []Member, id string) *Member {
	for i := range members {
		if members[i].ID == id {
			return &members[i]
		}
	}
	return nil
}

func TestJoinAssignsDistinctIDAndColor(t *testing.T) {
	h := NewHub()
	id1, ch1 := h.Join("alice")
	id2, _ := h.Join("bob")

	if id1 == id2 {
		t.Fatal("expected distinct ids")
	}
	roster := h.Roster()
	if len(roster) != 2 {
		t.Fatalf("roster len = %d, want 2", len(roster))
	}
	a, b := find(roster, id1), find(roster, id2)
	if a == nil || b == nil {
		t.Fatal("members missing from roster")
	}
	if a.Color == b.Color {
		t.Errorf("expected distinct colors, both %s", a.Color)
	}
	if a.Username != "alice" {
		t.Errorf("username = %q, want alice", a.Username)
	}

	// alice's channel should have received roster broadcasts (her join, then bob's).
	got := lastRoster(t, ch1)
	if len(got) != 2 {
		t.Fatalf("alice last roster len = %d, want 2", len(got))
	}
}

func TestUpdateReflectsInRoster(t *testing.T) {
	h := NewHub()
	id, ch := h.Join("alice")

	h.Update(id, "src/main.go", 42, 10, 5, 42, 20)

	got := lastRoster(t, ch)
	m := find(got, id)
	if m == nil {
		t.Fatal("member missing")
	}
	if m.File != "src/main.go" || m.Line != 42 {
		t.Errorf("update not reflected: file=%q line=%d", m.File, m.Line)
	}
	if m.AnchorLine != 10 || m.AnchorCol != 5 || m.HeadLine != 42 || m.HeadCol != 20 {
		t.Errorf("selection not reflected: anchorLine=%d anchorCol=%d headLine=%d headCol=%d",
			m.AnchorLine, m.AnchorCol, m.HeadLine, m.HeadCol)
	}
}

func TestUpdateTabsReflectedAndSanitized(t *testing.T) {
	h := NewHub()
	id, ch := h.Join("alice")

	long := make([]byte, 1025)
	for i := range long {
		long[i] = 'a'
	}
	h.UpdateTabs(id, []string{"a.go", "", "a.go", string(long), "b.go"})

	got := lastRoster(t, ch)
	m := find(got, id)
	if m == nil {
		t.Fatal("member missing")
	}
	want := []string{"a.go", "b.go"}
	if len(m.Tabs) != len(want) {
		t.Fatalf("tabs = %v, want %v", m.Tabs, want)
	}
	for i := range want {
		if m.Tabs[i] != want[i] {
			t.Fatalf("tabs = %v, want %v", m.Tabs, want)
		}
	}
}

func TestLeaveRemovesAndClosesChannel(t *testing.T) {
	h := NewHub()
	id1, ch1 := h.Join("alice")
	id2, _ := h.Join("bob")

	h.Leave(id2)
	if len(h.Roster()) != 1 {
		t.Fatalf("roster len = %d, want 1 after leave", len(h.Roster()))
	}

	// alice still present; her channel still open and shows only her.
	got := lastRoster(t, ch1)
	if len(got) != 1 || find(got, id1) == nil {
		t.Fatalf("alice roster wrong after bob left: %+v", got)
	}

	// Leaving id2 again is a no-op (does not panic).
	h.Leave(id2)
}

func TestCloseClosesAllChannels(t *testing.T) {
	h := NewHub()
	_, ch1 := h.Join("alice")
	_, ch2 := h.Join("bob")

	h.Close()

	// Drain; both channels must be closed.
	drain := func(ch <-chan []byte) bool {
		for {
			_, ok := <-ch
			if !ok {
				return true
			}
		}
	}
	if !drain(ch1) || !drain(ch2) {
		t.Fatal("channels not closed after Close")
	}
	if len(h.Roster()) != 0 {
		t.Errorf("roster not empty after Close: %d", len(h.Roster()))
	}

	// Join after Close returns a closed channel and empty id.
	id, ch := h.Join("late")
	if id != "" {
		t.Errorf("expected empty id after Close, got %q", id)
	}
	if _, ok := <-ch; ok {
		t.Error("expected closed channel from Join after Close")
	}
}

func TestPresenterIsSingleAndClearedOnLeave(t *testing.T) {
	h := NewHub()
	id1, ch1 := h.Join("alice")
	id2, _ := h.Join("bob")

	if !h.SetPresenter(id1) {
		t.Fatal("alice should become presenter")
	}
	if h.SetPresenter(id2) {
		t.Fatal("bob must not replace an existing presenter")
	}
	p := h.Presenter()
	if p == nil || p.ID != id1 || p.Username != "alice" {
		t.Fatalf("presenter = %+v, want alice", p)
	}

	// The roster broadcast carries the presenter so every client can force-follow.
	var ev rosterEvent
	for {
		select {
		case data := <-ch1:
			if err := json.Unmarshal(data, &ev); err != nil {
				t.Fatalf("bad roster json: %v", err)
			}
			if ev.Presenter != nil {
				goto found
			}
		default:
			t.Fatal("no presenter in broadcast")
		}
	}
found:
	if ev.Presenter.ID != id1 {
		t.Fatalf("broadcast presenter = %+v, want %s", ev.Presenter, id1)
	}

	// Only the presenter can stop it.
	if h.ClearPresenter(id2) {
		t.Fatal("non-presenter must not clear the lead")
	}
	h.Leave(id1)
	if h.Presenter() != nil {
		t.Fatal("presenter should clear when the leader leaves")
	}
}

func TestJoinContextTakesOverTabViewState(t *testing.T) {
	h := NewHub()
	id1, ch1 := h.JoinContext("alice", "user:sess1", "team")
	id2, _ := h.JoinContext("bob", "user:sess1", "team")

	if id1 == id2 {
		t.Fatal("expected distinct ids")
	}
	if len(h.Roster()) != 1 {
		t.Fatalf("roster len = %d, want 1 after takeover", len(h.Roster()))
	}
	if find(h.Roster(), id2) == nil {
		t.Fatal("new owner missing from roster")
	}

	// The old socket gets a kicked notice before its channel closes.
	kicked := false
	for data := range ch1 {
		if strings.Contains(string(data), `"kicked"`) {
			kicked = true
		}
	}
	if !kicked {
		t.Fatal("old owner did not receive a kicked notice")
	}
}

func TestTabViewStateIsScopedByCollabContext(t *testing.T) {
	h := NewHub()
	h.JoinContext("alice", "user:sess1", "team-a")
	h.JoinContext("bob", "user:sess1", "team-b")
	if len(h.Roster()) != 2 {
		t.Fatalf("roster len = %d, want 2 for different contexts", len(h.Roster()))
	}

	if n := h.KickTabViewState("team-a", "user:sess1"); n != 1 {
		t.Fatalf("kick count = %d, want 1", n)
	}
	if len(h.Roster()) != 1 {
		t.Fatalf("roster len = %d, want 1 after kick", len(h.Roster()))
	}
}
