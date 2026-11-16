# WORKSPACES.md

Status: **design only / not implemented.** This describes where wede is going,
not what the code does today. Current behaviour is documented in
`docs/CONFIGURATION.md` and `docs/ARCHITECTURE.md`.

## 1. Terms

- **Workspace root** — the directory a session is opened on. It is the file
  boundary: every file/git/search/terminal/LSP path is confined to it.
- **Session** — a running workspace instance: `template` + `name` + `root` +
  idle `timeout`. Several sessions may point at the same root.
- **LSP root** — the project directory a language server treats as its
  workspace (`rootUri`). It is *not* necessarily the workspace root.
- **Custom workspace** — a URL/config-driven session opened on an arbitrary
  allowed path, without going through the login password again.
- **Catalog** — `.wede-workspaces.json`, the file that lists openable folders
  and their default actions.

## 2. Workspace root vs LSP root (separate concepts)

Today wede starts **one language server per (workspace, language)**, rooted at
the workspace root. That is wrong for monorepos and nested projects.

Target: resolve the LSP root **per file**, independently of the workspace root:

1. Walk up from the opened file to the nearest **language marker**:
   - Go: `go.mod`, `go.work`
   - JS/TS: `tsconfig.json`, `jsconfig.json`, `package.json`
   - Python: `pyrightconfig.json`, `pyproject.toml`, `setup.cfg`, `setup.py`
   - Rust: `Cargo.toml`
   - (extendable per server; configurable via `.wede/lsp.json`)
2. Clamp the found directory to the workspace root. It must be **inside** the
   workspace; never accept a root outside it.
3. If no marker exists, use **single-file mode**: the server still opens the
   document (diagnostics, hover, goto-definition within the file) but indexes no
   project.
4. Start/dedupe servers by **`(language, lspRoot)`**, not `(workspace,
   language)`. A workspace may therefore have several servers per language
   (e.g. `services/api` and `services/worker` both Go).
5. Two refs may be equal, nested, or many. That is expected; do not assume
   `lspRoot == workspaceRoot`.

Acceptance bar for now: **goto-definition works** in nested Go / Python / TS /
Rust files without switching workspace. Full index-quality diagnostics are
secondary.

Nested sessions (below) are an alternative to multi-root LSP. Both can coexist:
switch session when you want hard isolation; rely on root detection for
convenience inside one session.

## 3. Custom workspaces / nested sessions

Goal: open another project in a tab, container, iframe, or new browser window
while reusing the existing authenticated session.

### Deep link

```
/?workspace=<path>            # or /s/<session-id>
```

Opening is allowed only when one of these holds:

- `allow_any_workspace: true` in the **owner's global config** (default
  `false`), or
- the canonical path is one of the configured `workspaces` entries, or
- a `.wede-workspaces.json` catalog entry resolves to it **and** it still
  passes the normal allowed-root checks.

A catalog/project file can never grant access on its own. The existing rules
still apply: reject `/`, `$HOME`, dotfile paths below the base, `..`
traversal, and anything outside `workspace_root`.

### UI

- File-browser context menu: **Open as new session → Nested (iframe tab)** or
  **→ Browser tab**.
  - *Nested* — a normal tab whose content is an iframe of the same wede app,
    showing another session. It lives in a container like any other tab.
  - *Browser tab* — `window.open(...)` of the same app with the target session
    preselected.
- Tab label shows the **last N characters** of the workspace name (e.g. last 8),
  plus the session name when different; tooltip shows the full path.
- Switching sessions/templates never asks for the password again — the client
  is already authenticated (already true today).

### Auth reuse

- Same-origin iframe and `window.open` reuse the existing login token. For
  `window.open`, prefer a short-lived, single-use handoff token over putting the
  bearer token in the URL.
- Cross-origin embedding still requires `frame_ancestors`; same-origin is the
  default.

## 4. `.wede-workspaces.json` (catalog)

A wede-specific catalog, loosely shaped after VS Code `.code-workspace`
(`folders`, `settings`, tasks). It answers: *which folders does this repo want
to expose, under what names, with which default actions.*

```json
{
  "version": 1,
  "folders": [
    { "name": "api",  "path": "./services/api", "tasks": ["dev", "test"] },
    { "name": "web",  "path": "./web" },
    { "name": "docs", "path": "./docs", "openIn": "tab" }
  ],
  "tasksFile": ".wede/tasks.json",
  "defaults": { "openIn": "tab", "timeoutSecs": 600 }
}
```

Rules:

- Owner-global: `~/.wede/workspaces.json` (always trusted).
- Project: `<workspace>/.wede-workspaces.json` or `.wede/workspaces.json`,
  honoured **only for trusted workspaces**.
- Catalog entries are **descriptive, not authorization**. Each path is still
  canonicalised (`Abs` + `EvalSymlinks`) and re-checked against `workspace_root`
  and the `allow_any_workspace`/configured-workspaces rules.
- `version` is mandatory; unknown fields are rejected (same strictness as the
  main config).

## 5. Actions / default actions — do not reinvent

wede already has `.wede/tasks.json` (global `~/.wede/tasks.json`, project one
trust-gated). Extend that file instead of adding an `actions` block to the
workspace catalog.

Adopt a **VS Code `tasks.json`-compatible subset** (de-facto standard):

```json
{
  "tasks": [
    {
      "label": "build",
      "command": "go",
      "args": ["build", "./..."],
      "cwd": ".",
      "env": { "CGO_ENABLED": "0" },
      "group": { "kind": "build", "isDefault": true }
    },
    {
      "label": "test",
      "command": "go",
      "args": ["test", "./..."],
      "group": { "kind": "test", "isDefault": true },
      "dependsOn": ["build"]
    }
  ]
}
```

- `group.kind` = `build` | `test` | `none`; `group.isDefault` marks the default
  action for that kind. This is the "default actions" mechanism.
- Keep `label`/`command`/`args`/`cwd`/`env`/`group`/`dependsOn`; ignore VS Code
  fields wede does not support rather than silently mis-running them.
- Default lookup order: workspace `.wede/tasks.json` (if trusted) →
  `~/.wede/tasks.json` → optional `.vscode/tasks.json` import (trusted, opt-in).
- A task is an arbitrary host command: require trust and an explicit user
  action; never auto-run on open.
- The workspace catalog's `tasks: ["dev", "test"]` only *references* labels;
  it does not define commands.

Why not use `.code-workspace` verbatim: it mixes editor settings, launch
configs and extension semantics. Adopt its shape and the `tasks.json` action
schema, but keep wede's trust and path rules explicit.

## 6. Security summary

- `allow_any_workspace` lives only in the owner's global config; default
  `false`. A project-committed file can never enable it.
- Catalog entries never widen the allowed root set.
- Every resolved path is canonicalised and containment-checked at open time,
  not just at parse time.
- Task commands run only for trusted workspaces and only after explicit
  invocation.
- Same-origin iframe/window is the default; cross-origin needs
  `frame_ancestors`; avoid leaking the bearer token in URLs.
- Session creation/switching is logged like any other authenticated action.

## 7. Non-goals for now

- Multi-root single session (many roots in one file tree).
- Automatic task discovery beyond the task files above.
- Cross-origin workspace embedding without `frame_ancestors`.
- Per-project `.wede/lsp.json` (global registry only; project tooling stays
  behind the trust gate).
