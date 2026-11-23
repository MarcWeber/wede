package files

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type WorkspaceProvider interface {
	Current() string
}

type Handler struct {
	ws            WorkspaceProvider
	hidePatterns  []string // glob patterns for hidden files/dirs
}

func New(ws WorkspaceProvider, hidePatterns []string) *Handler {
	return &Handler{ws: ws, hidePatterns: hidePatterns}
}

// treeSkipDirs are directories excluded from the Quick Open file index.
var treeSkipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true,
	".next": true, "vendor": true, ".cache": true, "target": true,
}

// imageMimes maps extensions to the MIME type used for inline image previews.
var imageMimes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".jfif": "image/jpeg",
	".gif":  "image/gif",
	".svg":  "image/svg+xml",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".ico":  "image/x-icon",
}

// videoMimes maps extensions to the MIME type used for inline playback.
var videoMimes = map[string]string{
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".webm": "video/webm",
	".ogv":  "video/ogg",
	".ogg":  "video/ogg",
	".mov":  "video/quicktime",
}

// isNoiseFile reports whether name is OS/tooling noise that should never appear
// in the explorer, Quick Open, or search. In particular, NFS "silly-rename"
// artifacts (.nfs.<hex>.<pid> / .nfs<hex>) are created when a file is deleted
// while still open; they hold the old contents and are not real project files.
func isNoiseFile(name string) bool {
	if name == ".DS_Store" {
		return true
	}
	if !strings.HasPrefix(name, ".nfs") {
		return false
	}
	rest := name[len(".nfs"):]
	if strings.HasPrefix(rest, ".") {
		rest = rest[1:]
	}
	if rest == "" {
		return false
	}
	c := rest[0]
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// matchesHidePattern reports whether name matches any of the configured hide
// patterns (glob-style: * matches anything, ? matches one char, [abc] matches
// a set). Returns false if no patterns are configured.
func matchesHidePattern(name string, patterns []string) bool {
	for _, p := range patterns {
		matched, _ := filepath.Match(p, name)
		if matched {
			return true
		}
	}
	return false
}

const treeMaxFiles = 10000

// Tree returns flat, sorted lists of file and directory paths (relative to the
// workspace root, slash-separated). Files feed the Quick Open finder; directories
// let the explorer select folders too. Directory noise (.git, node_modules,
// hidden dirs, …) is skipped and the file count is capped to stay responsive on
// large repos.
func (h *Handler) Tree(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}
	root := h.workspace()

	files := make([]string, 0, 256)
	dirs := make([]string, 0, 64)
	truncated := false
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if p != root && (treeSkipDirs[name] || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			if p != root {
				if rel, relErr := filepath.Rel(root, p); relErr == nil {
					dirs = append(dirs, filepath.ToSlash(rel))
				}
			}
			return nil
		}
		if isNoiseFile(d.Name()) {
			return nil
		}
		rel, relErr := filepath.Rel(root, p)
		if relErr != nil {
			return nil
		}
		files = append(files, filepath.ToSlash(rel))
		if len(files) >= treeMaxFiles {
			truncated = true
			return filepath.SkipAll
		}
		return nil
	})

	sort.Strings(files)
	sort.Strings(dirs)
	json.NewEncoder(w).Encode(map[string]any{"files": files, "dirs": dirs, "truncated": truncated})
}

type FileEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size,omitempty"`
}

func (h *Handler) workspace() string {
	return h.ws.Current()
}

func (h *Handler) checkWorkspace(w http.ResponseWriter) bool {
	if h.workspace() == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "no workspace open"})
		return false
	}
	return true
}

func (h *Handler) safePath(reqPath string) (string, bool) {
	ws := h.workspace()
	if ws == "" {
		return "", false
	}
	if reqPath == "" || reqPath == "/" || reqPath == "." {
		return ws, true
	}
	// filepath.Join calls filepath.Clean internally, which resolves all ".."
	// sequences. We must NOT call Clean separately before Join because
	// Clean("../../etc/passwd") == "../../etc/passwd" (still has ".."), and
	// Join correctly collapses it: Join("/ws", "../../etc/passwd") == "/etc/passwd".
	full := filepath.Join(ws, reqPath)
	// Guard against prefix-collision attacks: if the workspace is "/tmp/ws",
	// a plain HasPrefix check would permit "/tmp/ws2/evil" because "/tmp/ws2"
	// starts with "/tmp/ws". Enforce the separator so we only allow exact
	// workspace root or files strictly inside it.
	wsWithSep := ws + string(filepath.Separator)
	if full != ws && !strings.HasPrefix(full, wsWithSep) {
		return "", false
	}
	// Symlink guard: the lexical check above can be defeated by a symlink that
	// lives inside the workspace but points outside it. Resolve symlinks and
	// confirm the real target still falls within the workspace, so a viewer/editor
	// can't read or overwrite files outside the project via a planted symlink.
	if !withinWorkspaceReal(ws, full) {
		return "", false
	}
	return full, true
}

// withinWorkspaceReal reports whether full, after symlink resolution, stays inside
// ws. Because the target may not exist yet (create/write), it walks up to the
// deepest existing ancestor, resolves that, and re-appends the remaining segments.
func withinWorkspaceReal(ws, full string) bool {
	wsReal, err := filepath.EvalSymlinks(ws)
	if err != nil {
		wsReal = filepath.Clean(ws)
	}
	cur := full
	tail := ""
	for {
		if resolved, err := filepath.EvalSymlinks(cur); err == nil {
			target := resolved
			if tail != "" {
				target = filepath.Join(resolved, tail)
			}
			return target == wsReal || strings.HasPrefix(target, wsReal+string(filepath.Separator))
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			// Reached the filesystem root without resolving; the lexical check stands.
			return true
		}
		tail = filepath.Join(filepath.Base(cur), tail)
		cur = parent
	}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	reqPath := r.URL.Query().Get("path")
	full, ok := h.safePath(reqPath)
	if !ok {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	// showHidden controls whether dotfiles (names starting with ".") are included.
	// Default is false — hidden files are excluded unless explicitly requested.
	showHidden := r.URL.Query().Get("showHidden") == "true"

	entries, err := os.ReadDir(full)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	result := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if isNoiseFile(name) {
			continue
		}
		if !showHidden && matchesHidePattern(name, h.hidePatterns) {
			continue
		}
		info, _ := e.Info()
		relPath := filepath.Join(reqPath, name)
		fe := FileEntry{
			Name:  name,
			Path:  relPath,
			IsDir: e.IsDir(),
		}
		if info != nil && !e.IsDir() {
			fe.Size = info.Size()
		}
		result = append(result, fe)
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].IsDir != result[j].IsDir {
			return result[i].IsDir
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})

	json.NewEncoder(w).Encode(result)
}

func (h *Handler) Read(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	reqPath := r.URL.Query().Get("path")
	full, ok := h.safePath(reqPath)
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

	// Determine file type by extension. PDFs are served as metadata only and
	// streamed through Raw, so they are not subject to the JSON/base64 10 MB cap.
	ext := strings.ToLower(filepath.Ext(info.Name()))
	if ext == ".pdf" {
		json.NewEncoder(w).Encode(map[string]any{
			"path":     reqPath,
			"content":  "",
			"fileType": "pdf",
			"size":     info.Size(),
		})
		return
	}
	if _, isVideo := videoMimes[ext]; isVideo {
		json.NewEncoder(w).Encode(map[string]any{
			"path":     reqPath,
			"content":  "",
			"fileType": "video",
			"size":     info.Size(),
		})
		return
	}

	if info.Size() > 10*1024*1024 {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		json.NewEncoder(w).Encode(map[string]string{"error": "file too large (>10MB)"})
		return
	}

	if mime, isImage := imageMimes[ext]; isImage {
		data, err := os.ReadFile(full)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		encoded := base64.StdEncoding.EncodeToString(data)
		dataURL := "data:" + mime + ";base64," + encoded
		json.NewEncoder(w).Encode(map[string]any{
			"path":     reqPath,
			"content":  "",
			"fileType": "image",
			"dataUrl":  dataURL,
		})
		return
	}

	data, err := os.ReadFile(full)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Binary probe: if > 0.5% of first 512 bytes are null, treat as binary.
	probe := data
	if len(probe) > 512 {
		probe = probe[:512]
	}
	nullCount := 0
	for _, b := range probe {
		if b == 0 {
			nullCount++
		}
	}
	if len(probe) > 0 && nullCount*200 > len(probe) {
		json.NewEncoder(w).Encode(map[string]any{
			"path":     reqPath,
			"content":  "",
			"fileType": "binary",
			"size":     info.Size(),
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"path":    reqPath,
		"content": string(data),
	})
}

// Raw streams a workspace file to the browser. It is workspace-scoped: the
// route already selects the workspace root, so a path is allowed only when it
// resolves inside that root (including symlink checks). PDFs and images can be
// opened inline with ?inline=1; everything else is sent as a download.
func (h *Handler) Raw(w http.ResponseWriter, r *http.Request) {
	if !h.checkWorkspace(w) {
		return
	}

	reqPath := r.URL.Query().Get("path")
	full, ok := h.safePath(reqPath)
	if !ok {
		http.Error(w, "path outside workspace", http.StatusForbidden)
		return
	}

	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}

	f, err := os.Open(full)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()

	ext := strings.ToLower(filepath.Ext(info.Name()))
	contentType := "application/octet-stream"
	inlineOK := false
	if ext == ".pdf" {
		contentType = "application/pdf"
		inlineOK = true
	} else if m, isImage := imageMimes[ext]; isImage {
		contentType = m
		inlineOK = true
	} else if m, isVideo := videoMimes[ext]; isVideo {
		contentType = m
		inlineOK = true
	}
	w.Header().Set("Content-Type", contentType)

	disposition := "attachment"
	if r.URL.Query().Get("inline") == "1" && inlineOK {
		disposition = "inline"
	}
	if cd := mime.FormatMediaType(disposition, map[string]string{"filename": info.Name()}); cd != "" {
		w.Header().Set("Content-Disposition", cd)
	}

	w.Header().Set("ETag", fmt.Sprintf("\"%x-%x\"", info.Size(), info.ModTime().UnixNano()))
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func (h *Handler) Write(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 10*1024*1024)).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
		return
	}

	full, ok := h.safePath(body.Path)
	if !ok {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	dir := filepath.Dir(full)
	os.MkdirAll(dir, 0755)

	if err := os.WriteFile(full, []byte(body.Content), 0644); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	var body struct {
		Path  string `json:"path"`
		IsDir bool   `json:"isDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
		return
	}

	full, ok := h.safePath(body.Path)
	if !ok {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	var err error
	if body.IsDir {
		err = os.MkdirAll(full, 0755)
	} else {
		dir := filepath.Dir(full)
		os.MkdirAll(dir, 0755)
		err = os.WriteFile(full, []byte{}, 0644)
	}

	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	reqPath := r.URL.Query().Get("path")
	full, ok := h.safePath(reqPath)
	if !ok {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	if full == h.workspace() {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "cannot delete workspace root"})
		return
	}

	if err := os.RemoveAll(full); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Copy recursively copies src to dst (both are workspace-relative paths).
// For files, it copies the file contents. For directories it walks the tree
// and recreates the structure under dst.
func (h *Handler) Copy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	var body struct {
		Src string `json:"src"`
		Dst string `json:"dst"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
		return
	}

	srcFull, ok1 := h.safePath(body.Src)
	dstFull, ok2 := h.safePath(body.Dst)
	if !ok1 || !ok2 {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	srcInfo, err := os.Stat(srcFull)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "source not found"})
		return
	}

	if err := copyRecursive(srcFull, dstFull, srcInfo); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// copyRecursive copies src to dst. srcInfo is the result of os.Stat(src).
func copyRecursive(src, dst string, srcInfo os.FileInfo) error {
	if srcInfo.IsDir() {
		if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, e := range entries {
			childSrc := filepath.Join(src, e.Name())
			childDst := filepath.Join(dst, e.Name())
			info, err := e.Info()
			if err != nil {
				return err
			}
			if err := copyRecursive(childSrc, childDst, info); err != nil {
				return err
			}
		}
		return nil
	}
	// Regular file
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	return os.WriteFile(dst, data, srcInfo.Mode())
}

func (h *Handler) Rename(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !h.checkWorkspace(w) {
		return
	}

	var body struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request"})
		return
	}

	oldFull, ok1 := h.safePath(body.OldPath)
	newFull, ok2 := h.safePath(body.NewPath)
	if !ok1 || !ok2 {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "path outside workspace"})
		return
	}

	dir := filepath.Dir(newFull)
	os.MkdirAll(dir, 0755)

	if err := os.Rename(oldFull, newFull); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
