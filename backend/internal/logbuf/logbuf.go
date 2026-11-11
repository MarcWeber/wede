// Package logbuf keeps the last N log lines in memory so the UI can show a
// live server log (UI.txt T8: log_view). It is an io.Writer that tees to the
// real log destination (usually stderr), so normal logging is unaffected.
package logbuf

import (
	"io"
	"sync"
)

// Buffer is a fixed-size ring of complete log lines plus a tee writer.
type Buffer struct {
	mu      sync.Mutex
	lines   []string
	max     int
	partial string
	tee     io.Writer
}

// New returns a Buffer holding at most max complete lines. Every write is also
// forwarded to tee (may be nil).
func New(tee io.Writer, max int) *Buffer {
	if max < 1 {
		max = 1
	}
	return &Buffer{max: max, tee: tee}
}

func (b *Buffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	b.partial += string(p)
	for {
		i := indexByte(b.partial, '\n')
		if i < 0 {
			break
		}
		line := b.partial[:i]
		b.partial = b.partial[i+1:]
		b.lines = append(b.lines, line)
	}
	if len(b.lines) > b.max {
		b.lines = append([]string(nil), b.lines[len(b.lines)-b.max:]...)
	}
	// Cap an unbounded partial line (e.g. a progress bar without newlines).
	if len(b.partial) > 64*1024 {
		b.partial = b.partial[len(b.partial)-64*1024:]
	}
	b.mu.Unlock()

	if b.tee != nil {
		_, _ = b.tee.Write(p)
	}
	return len(p), nil
}

// Snapshot returns the last n complete lines (newest last). n <= 0 returns all
// retained lines.
func (b *Buffer) Snapshot(n int) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	lines := b.lines
	if n > 0 && n < len(lines) {
		lines = lines[len(lines)-n:]
	}
	out := make([]string, len(lines))
	copy(out, lines)
	return out
}

func indexByte(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}
