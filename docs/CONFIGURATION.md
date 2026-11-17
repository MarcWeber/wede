# wede Configuration

wede is configured by a JSON file (`wede.config.json`) or by layered JSON/YAML
files passed with `--configs`. This document covers the config keys, users,
workspace templates and session timeouts, layered/hot loading, CLI flags, and
override precedence.

The legacy single-file form remains supported and is still what the Docker
compose setup mounts. Layered files let an operator split secrets, users, and
templates, and hot-reload only the non-secret parts.

---

## Config file location

wede searches for `wede.config.json` in this order, using the **first file
found**:

1. The current working directory, then each parent directory up to `/`
2. `~/.config/wede/wede.config.json`
3. The directory containing the `wede` binary

If no file is found in any of these locations, wede logs an error naming all
four searched locations and exits (`log.Fatal`) — there is no built-in
zero-config default. This means you can place the config in your project root
and run `wede` from any subdirectory of it, and it will still be found.

---

## Complete key reference

| Key | Type | Default | Env override | Description |
|-----|------|---------|---------------|-------------|
| `password` | `string` | *(none)* | — | Legacy shared login password. Required only when `users` is empty. |
| `users` | `map[string]string` | `{}` | — | Per-user passwords. When non-empty, each user signs in with their own entry; the legacy `password` is ignored. |
| `min_password_chars` | `int` | `12` | — | Minimum length for plaintext `password`/`users` values. `0` disables the check. `sha256:` entries are skipped. |
| `teachers` | `string[]` | `[]` | — | Usernames allowed to start a forced-follow “Lead the rest” session. |
| `workspaces` | `map[string]template` | `{}` | — | Named workspace templates offered in the login workspace picker. |
| `defaults.workspace_timeout_secs` | `int` | `600` | — | Idle timeout after the last user leaves a session. `0` never expires. |
| `port` | `string` | `"9090"` | — | TCP port to listen on. Overridable at the CLI with `--port`/`-p`. |
| `host` | `string` | `"127.0.0.1"` | — | Interface to bind to. |
| `frame_ancestors` | `string` | `""` | — | Space-separated origins allowed to embed wede in an `<iframe>`. |
| `workspace_root` | `string` | `$HOME` | `WEDE_WORKSPACE_ROOT` | Base directory that confines which paths can be opened as a workspace. |
| `serve_landing` | `bool` | `false` | — | Whether the marketing landing page and `/site/*` docs viewer are mounted at all. |
| `tunnel_enabled` | `bool` | `false` | — | Mount the owner-only public tunnel (`/api/tunnel/*`) and its Settings panel. Disabled by default. |

`port` has a CLI override and `workspace_root` has an environment override.
Layered `--configs` files can additionally override users, teachers, templates,
and defaults. New sessions inherit their template's timeout; a session with any
connected user never expires.

---

## `password`

Required when `users` is empty. There is no default — a config with neither
`password` nor `users` fails to start with `password or users required in
config`. Used for the legacy single owner login; 3 failed attempts trigger a
lockout that persists across restarts (see [ARCHITECTURE.md](ARCHITECTURE.md)
for the auth model). Choose a strong, unique value — see
[Security: change the default password](#security-change-the-default-password)
below.

## `users`

Optional map of `username -> password`. When non-empty, the shared `password` is
ignored: every login must name a configured user and supply that user's
password. Sessions belonging to a user removed by a config reload are revoked.
When `users` is configured, clients cannot rename themselves, so a student
cannot claim a teacher's username. Values are plain text or
`sha256:<hex>` (hex SHA-256 of the password).

```json
{
  "users": {
    "alice": "alice-plain-password",
    "bob": "sha256:2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b"
  },
  "teachers": ["alice"]
}
```

The password is compared after the username is resolved from config; unknown
users and wrong passwords get the same error. This is authentication, not full
OS-level multi-user isolation: editors and terminals still run as the same
container user and can read server-side config.

## `min_password_chars`

Default `12`. Minimum length enforced for plaintext password values in both
the legacy `password` field and per-user `users` entries. When a password is
shorter than this threshold, wede refuses to start (or rejects the hot-reload)
with a clear error naming the offending key.

Set to `0` to disable the length check entirely (not recommended for
production). Passwords stored as `sha256:<hex>` are skipped — the server
cannot inspect their length, so the check applies only to plaintext values.

On login, passwords are also checked against a common-password blacklist
(≥12-character well-known passwords) and a Bloom filter that rejects passwords
starting or ending with common 6-character chunks (e.g. `qwerty`, `123456`).
A rejected login returns `"Password might be correct, still rejecting because
it is too simple."` — this prevents operators from accidentally choosing
weak passwords even when they satisfy the minimum length.

```json
{
  "password": "my-strong-password-here",
  "min_password_chars": 12
}
```

## `workspaces`

Named templates shown in the login workspace picker after authentication.
A template is not a running session; selecting it asks the user for a session
name and creates an isolated active session rooted at the template path.

```json
{
  "defaults": { "workspace_timeout_secs": 600 },
  "workspaces": {
    "cs101": { "path": "/srv/classes/cs101", "timeout_secs": 1800, "lsp": ["go", "python"] },
    "scratch": { "path": "/srv/scratch", "timeout_secs": 0 }
  }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `path` | `string` | Directory opened for the session. Defaults to `.`. |
| `timeout_secs` | `int` | Idle timeout after the last user leaves. `0` never expires. Falls back to `defaults.workspace_timeout_secs`. `timeout` is accepted as an alias. |
| `lsp` | `string[]` | Optional language-server names reserved for per-session LSP wiring. |

If `workspaces` is empty, wede exposes a single `default` template pointing at
the boot path (the positional CLI argument / container work dir), so solo use
still starts with one click. Switching between active sessions from the
workspace switcher does not ask for the password again: the client is already
authenticated, it just picks another session or template. An active session
closes after its idle timeout (default 600 seconds) once it has no connected
users. Sessions with users never
expire, and sessions are currently in-memory (restarting wede drops them).

## `defaults`

```json
{ "defaults": { "workspace_timeout_secs": 600 } }
```

`workspace_timeout_secs` is the fallback idle timeout for templates that omit
their own. `0` disables automatic expiry. The historical misspelling
`workspcae_timeout_secs` is also accepted.

## Layered config (`--configs`)

Pass one or more layers as `keys:mode:source`:

```
wede --configs all:cached:/etc/wede/base.yaml \
     --configs users:hot:/etc/wede/users.yaml \
     --configs workspaces,defaults:hot:/etc/wede/workspaces.yaml
```

- `keys` is a comma/space list of `all`, `users`, `teachers`, `workspaces`,
  `defaults`.
- `mode` is `cached` (read once) or `hot` (polled every second).
- `source` is a JSON/YAML path; `-` reads stdin. Only the first two colons are
  separators, so colons in a path are fine. A path containing spaces works when
  it is the entire `--configs` value.
- Later layers win. Maps (`users`, `workspaces`) deep-merge; `teachers`
  replaces the previous list; JSON/YAML `null` deletes a map entry.
- `hot` layers are re-read atomically. A malformed reload is rejected and the
  last good config stays active; auth/templates/timeouts are re-applied, while
  listen address, port, frame-ancestors, and workspace root require a restart.
- Config is admin/root-equivalent. Keep secrets readable only by the wede
  process.

## `teachers`

Default `[]` (nobody can lead). A JSON array of usernames that may start a
forced-follow lead from the hamburger menu (“Lead the rest”). While a teacher
is leading, every other connected client follows that teacher live; clients
cannot opt out until the lead ends. This list only grants permission — being
listed does not automatically lead a session.

```json
{
  "password": "your-password",
  "teachers": ["alice", "bob"]
}
```

The username is the display name chosen at login. It is not an account
boundary: the current auth model still uses a single owner password, so this
is a classroom/coordination control, not a security boundary between users.
Use a real reverse-proxy auth layer or separate deployments if students must
not be able to choose a teacher's name.

## `port`

Default `"9090"`. TCP port the HTTP server listens on. A JSON string, not a
number (e.g. `"8080"`, not `8080`). Overridable at runtime with the CLI flags
`--port <port>` or `-p <port>` (see [CLI flags](#cli-flags)) — the flag wins
over whatever is in the config file.

## `host`

Default `"127.0.0.1"` — binds to loopback only, reachable solely from the
machine wede runs on. Set to `"0.0.0.0"` to listen on all interfaces, which is
required when wede is accessed from another machine, a container, or a Docker
host.

> **Note on empty string:** although the field comment in the source
> describes `""` as equivalent to `"0.0.0.0"`, the running server does not
> treat it that way: `main.go` falls back to `"127.0.0.1"` whenever the
> resolved `host` value is empty (whether that's because the key was omitted
> or explicitly set to `"host": ""`). In practice, use `"0.0.0.0"` explicitly
> to bind to all interfaces — an empty string binds to loopback, same as the
> default.

## `frame_ancestors`

Default `""`. Controls which origins may embed wede in an iframe, emitted as
`Content-Security-Policy: frame-ancestors <value>`.

- **Empty (default):** wede sends `X-Frame-Options: DENY` and
  `Content-Security-Policy: frame-ancestors 'self'` — all cross-origin
  framing is blocked.
- **Non-empty:** a space-separated list of origins, e.g.
  `"https://vulos.org https://app.vulos.org"`. `X-Frame-Options` is omitted
  (it can't express multiple origins) so the CSP directive takes sole effect,
  and WebSocket origin checks are widened to allow connections from the
  listed origins.

The standalone experience (direct browser access, not embedded) is unaffected
either way. See [Embedding in an iframe](#embedding-in-an-iframe) below.

## `workspace_root`

Default (when omitted): the user's home directory (`$HOME`), resolved to an
absolute path. Can also be set via the `WEDE_WORKSPACE_ROOT` environment
variable, which takes priority over the config-file value (see
[Precedence](#precedence)).

This is a **security control**, not just a convenience default: it confines
which directories can be adopted as a workspace at runtime. Any path passed
to `POST /api/folder/open` or `POST /api/workspaces` must, after `~`
expansion and symlink resolution:

- resolve to a location **inside** `workspace_root` (or be `workspace_root`
  itself),
- not be the filesystem root (`/`),
- not be the user's **home directory itself** — rejected outright regardless
  of what `workspace_root` is set to,
- not contain a dotfile path component below the allowed base (e.g. `.ssh`,
  `.config`, `.gnupg`) or a `..` traversal segment.

A request that fails any of these checks gets `400 Bad Request` with a JSON
`{"error": "..."}` body describing which rule was violated (e.g. `"path
outside the allowed workspace root (...)"`, `"dotfile directories are not
allowed in a workspace path (.ssh)"`, `"refusing to open the home directory
itself as a workspace"`). This stops an authenticated editor from adopting a
sensitive directory (`$HOME`, `/`, `~/.ssh`) as a workspace root and reading
its contents through the IDE.

**Exception — the boot path.** The directory you pass on the command line at
launch (`wede /path/to/project`) is the owner's explicit, one-time launch
choice and is **exempt** from this restriction: it only needs to exist and be
a directory. `workspace_root` governs paths opened *after* startup, through
the UI or API, not the initial boot workspace.

**Separately:** the folder-picker's browse endpoint (`GET
/api/folder/browse`, used to list subdirectories in the UI) is always
confined to the user's home-directory tree, independent of `workspace_root`.
Setting `workspace_root` to a directory outside `$HOME` does not widen what
the picker can browse.

If you never set `workspace_root`, the default (`$HOME`) is a broad but safe
base: it blocks `/`, `$HOME` itself, and dotfiles, but still lets an editor
open any non-dotfile subdirectory of your home folder. Set it explicitly to a
narrower directory (e.g. `/srv/projects`) to restrict wede to only that tree.

## `serve_landing`

Default `false`. Gates whether the marketing landing page and the `/site/*`
docs viewer are mounted at all. These are assets built for the public cloud
deployment (`wede.vulos.org`) — a local, self-hosted instance normally has no
use for them.

When `false` (the default for every self-hosted install):
- `/site/*` is **not mounted** — visiting `/site/` returns a plain 404. This
  is expected behavior for a self-hosted instance, **not a bug**.
- Unauthenticated visits to `/` are served the IDE's own login form (the SPA)
  instead of a marketing landing page.

When `true`:
- `/site/*` serves the bundled landing page + docs viewer, and `/site`
  redirects to `/site/`.
- Unauthenticated visits to `/` are served the landing page instead of the
  bare login form (authenticated visits always get the IDE regardless).

Set this to `true` only if you are deliberately hosting the public marketing
site alongside the IDE (as the Vulos cloud deployment does). A normal
self-host does not need it.

> **Note:** `GET /licenses.txt` (third-party notices) is **not** gated by
> `serve_landing` — it is mounted unconditionally whenever the binary was
> built with notices embedded, on every deployment, self-hosted or not.

## `tunnel_enabled`

Default `false`. Enables the owner-only **Settings → Public access** panel and
the `/api/tunnel/*` routes that expose a loopback-bound wede through the
owner's own Ephor relay. This is inbound public access, so it is off unless the
operator explicitly opts in.

When `false` (the default):
- `/api/tunnel` and `/api/tunnel/*` are **not mounted** (404).
- The **Public access** panel is hidden.
- wede does not construct or start the tunnel manager.

When `true`, the owner can configure the relay URL, bearer token, and public
name, then start the tunnel. The agent still dials outbound only and proxies
exclusively to wede's own loopback port. See
[PUBLIC-ACCESS.md](PUBLIC-ACCESS.md) and
[SECURITY-HARDENING.md § 11](SECURITY-HARDENING.md#11-understand-what-the-tunnel-does-and-doesnt-expose).

---

## Strict parsing: unknown keys are rejected

wede decodes `wede.config.json` with `json.Decoder.DisallowUnknownFields()`.
Any key not in the table above causes an immediate startup error of the form
`invalid wede.config.json: json: unknown field "..."`, rather than silently
ignoring it. A typo like `"frame_ancestor"` (missing `s`) is caught at
launch, not swallowed.

---

## Security: change the default password

> **Always set a strong, unique password before exposing wede over a
> network.**

The `install.sh` installer auto-generates a random 16-character password. If
you created the config manually, choose a strong password yourself:

```json
{
  "password": "correct-horse-battery-staple-42",
  "port": "9090"
}
```

Do not commit `wede.config.json` — it is gitignored by default.

---

## Embedding in an iframe

By default wede sets `X-Frame-Options: DENY` and `Content-Security-Policy:
frame-ancestors 'self'`, blocking all cross-origin embedding.

To allow the Vulos OS app shell (or any other trusted origin) to embed wede
in an iframe, set `frame_ancestors`:

```json
{
  "password": "your-password",
  "port": "9090",
  "frame_ancestors": "https://vulos.org https://app.vulos.org"
}
```

When `frame_ancestors` is non-empty:
- `Content-Security-Policy: frame-ancestors <value>` is emitted (modern
  browsers honour this)
- `X-Frame-Options` is omitted (it cannot express multiple origins)
- WebSocket origin checks allow connections from the listed origins

The standalone experience (direct browser access) is unaffected.

---

## Exposing over a network

By default wede binds to `127.0.0.1` — only accessible from the local
machine. To access from another machine or through a reverse proxy:

```json
{
  "password": "your-strong-password-here",
  "port": "9090",
  "host": "0.0.0.0"
}
```

> **Warning:** Binding to `0.0.0.0` exposes wede on all network interfaces.
> Always use a strong password and consider TLS via a reverse proxy (nginx,
> Caddy, etc.) when accessible over the internet. See
> [GETTING-STARTED.md](GETTING-STARTED.md#exposing-wede-over-a-network) and
> [PUBLIC-ACCESS.md](PUBLIC-ACCESS.md) for full options.

---

## CLI flags

```
wede [flags] [path]
```

| Flag | Description |
|------|-------------|
| `--port <port>` | Override the port from config |
| `-p <port>` | Shorthand for `--port` |
| `--configs <keys:mode:source>` | Add a config layer. Repeatable; comma/space-separated layers in one value are also accepted. |
| `--version` | Print version and exit |
| `path` | Directory to open as the initial workspace on startup (optional; exempt from the `workspace_root` restriction — see [`workspace_root`](#workspace_root)) |

Example:

```bash
wede --port 8080 /home/user/myproject
```

---

## Precedence

From highest to lowest priority:

1. **CLI flags** — `--port`/`-p` overrides `port`; `--configs` adds layers. The
   positional `path` argument sets the boot/default workspace directly and
   isn't a config value at all.
2. **Environment variable** — `WEDE_WORKSPACE_ROOT` overrides `workspace_root`
   from the config file.
3. **Layered config** — layers in `--configs` order, later winning; see above.
4. **Legacy config file** (`wede.config.json`) — searched as described above
   and used as the base when no layers are given.
5. **Built-in defaults** — `port: "9090"`, `host: "127.0.0.1"`,
   `frame_ancestors: ""`, `workspace_root: $HOME`, `serve_landing: false`,
   `tunnel_enabled: false`, workspace timeout `600`; `password` has no default
   and is required only when `users` is empty.

Only `port` and `workspace_root` have an override layer above the config
files. Cached layers/`wede.config.json` require a restart; hot layers reload
users, teachers, templates, and defaults at runtime.

---

## Example configs

All three examples below pass strict parsing: each uses only real key names,
and every field except `password` is optional (defaults apply for anything
omitted).

### Minimal (local use)

```json
{
  "password": "my-secret-password"
}
```

Uses every default: port `9090`, loopback-only `host`, no iframe embedding,
`workspace_root` = `$HOME`, and `serve_landing` off.

### NAS / home server

```json
{
  "password": "my-secret-password",
  "port": "9090",
  "host": "0.0.0.0"
}
```

### Embedded in Vulos OS

```json
{
  "password": "my-secret-password",
  "port": "9090",
  "frame_ancestors": "https://vulos.org"
}
```

### Users with per-user passwords

```json
{
  "users": {
    "alice": "alice-password",
    "bob": "sha256:<hex-sha256-of-password>"
  },
  "teachers": ["alice"],
  "workspaces": {
    "class": { "path": "/srv/class", "timeout_secs": 1800 }
  }
}
```

### Restricting the workspace root

```json
{
  "password": "my-secret-password",
  "workspace_root": "/srv/projects"
}
```

Confines every workspace opened after startup to `/srv/projects` (instead of
the `$HOME`-wide default), rejecting anything outside that tree, dotfile
paths within it, and traversal attempts.
