package files

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Tail returns the last n lines of a file so the UI log_view can watch a file
// (UI.txt T8). The path may be workspace-relative or absolute inside the
// workspace; anything outside is rejected by the same guards as Read.
func (h *Handler) Tail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	reqPath := r.URL.Query().Get("path")
	full, ok := h.safeLogPath(reqPath)
	if !ok {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	info, err := os.Stat(full)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "file not found"})
		return
	}
	if info.IsDir() {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "path is a directory"})
		return
	}

	n := 400
	if v := r.URL.Query().Get("n"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 5000 {
			n = parsed
		}
	}

	lines, err := tailLines(full, n)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"path":  reqPath,
		"lines": lines,
		"size":  info.Size(),
	})
}

// safeLogPath accepts a workspace-relative path (like safePath) or an absolute
// path that resolves inside the workspace.
func (h *Handler) safeLogPath(reqPath string) (string, bool) {
	if reqPath == "" {
		return "", false
	}
	if filepath.IsAbs(reqPath) {
		ws := h.workspace()
		if ws == "" || !withinWorkspaceReal(ws, reqPath) {
			return "", false
		}
		return reqPath, true
	}
	return h.safePath(reqPath)
}

// tailLines reads the last n lines without loading the whole file. It starts
// with the last 256 KiB and doubles until it has enough lines (cap 4 MiB).
func tailLines(path string, n int) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := info.Size()
	if size == 0 {
		return []string{}, nil
	}

	const chunk = int64(256 * 1024)
	const maxRead = int64(4 * 1024 * 1024)
	readSize := chunk
	if readSize > size {
		readSize = size
	}

	for {
		start := size - readSize
		buf := make([]byte, readSize)
		nRead, err := f.ReadAt(buf, start)
		if err != nil && err != io.EOF {
			return nil, err
		}
		buf = buf[:nRead]

		parts := strings.Split(string(buf), "\n")
		// The first line is partial unless we started at byte 0.
		if start > 0 && len(parts) > 0 {
			parts = parts[1:]
		}
		// Drop the empty tail produced by a final newline.
		if len(parts) > 0 && parts[len(parts)-1] == "" {
			parts = parts[:len(parts)-1]
		}
		for i := range parts {
			parts[i] = strings.TrimSuffix(parts[i], "\r")
		}

		if len(parts) >= n || start == 0 || readSize >= maxRead {
			if len(parts) > n {
				parts = parts[len(parts)-n:]
			}
			return parts, nil
		}

		readSize *= 2
		if readSize > size {
			readSize = size
		}
		if readSize > maxRead {
			readSize = maxRead
		}
	}
}
