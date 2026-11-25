// Package rrcontrol embeds the rrweb remote-access dashboard and its client
// protocol as an HTTP handler that can be mounted in another Go application.
package rrcontrol

import (
	"fmt"
	"net/http"
)

// Options configures the rrcontrol handler.
type Options struct {
	// ControlMode accepts off, ask, no, or yes. ask prompts the observed page
	// before starting a recording; no permits viewing but not remote control.
	ControlMode string
	// Compress controls permessage-deflate. Nil enables compression.
	Compress *bool
	// Authenticate wraps only support WebSocket connections. Client sockets
	// remain unauthenticated so external pages can embed the client script.
	Authenticate func(next http.Handler) http.Handler
	// IsTeacher authorizes support connections after Authenticate has run.
	IsTeacher func(r *http.Request) bool
}

type Config struct {
	Control  string
	Compress *bool
}

func normalizeControlMode(mode string) (string, error) {
	if mode == "" {
		mode = "off"
	}
	switch mode {
	case "ask":
		return "invite", nil
	case "off", "no", "yes":
		return mode, nil
	default:
		return "", fmt.Errorf("rrcontrol must be one of: off, ask, no, yes")
	}
}
