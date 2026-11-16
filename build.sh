#!/usr/bin/env bash
# build.sh — Build and run wede.
#
# Commands:
#   ./build.sh dev-build     — Fast build only (~5s): esbuild + Go parallel, no embed, don't start
#   ./build.sh dev-restart   — Kill, build, and start wede (dev mode)
#   ./build.sh prod-build    — Production build: npm run build:all (embedded frontend), don't start
#   ./build.sh dev-kill      — Stop running wede instances
#
# Aliases (backward compatible):
#   ./build.sh dev  → dev-restart
#   ./build.sh prod → prod-build
#
# Dev mode serves web/dist/ from disk (no embed_frontend tag).
# Prod mode embeds web/dist/ into the Go binary for a single portable binary.

set -euo pipefail
cd "$(dirname "$0")"

CMD="${1:-dev-restart}"

# --- Aliases ---
if [ "$CMD" = "dev" ]; then CMD="dev-restart"; fi
if [ "$CMD" = "prod" ]; then CMD="prod-build"; fi

# --- Functions ---

kill_wede() {
  pkill wede 2>/dev/null || true
  pkill -f "vite" 2>/dev/null || true
  sleep 0.5
  echo "wede stopped."
}

build_dev() {
  echo "=== Dev build: esbuild + Go (parallel, no embed) ==="

  # Frontend build in background
  (
    rm -rf web/dist && mkdir -p web/dist

    npx --yes esbuild@0.28.2 web/src/main.tsx \
      --bundle \
      --minify \
      --format=esm \
      --target=es2020 \
      --outfile=web/dist/index.js \
      --loader:.tsx=tsx \
      --loader:.ts=ts \
      --loader:.css=text \
      --external:../site \
      2>&1

    npx @tailwindcss/cli -i web/src/index.css -o web/dist/styles.css --minify 2>/dev/null || \
      cp web/src/index.css web/dist/styles.css

    cat web/index.html | sed \
      -e 's|<script type="module" src="/src/main.tsx"></script>|<link rel="stylesheet" href="/styles.css" />\n    <script type="module" src="/index.js"></script>|' \
      > web/dist/index.html

    cp -r web/public/. web/dist/ 2>/dev/null || true
  ) &
  FRONTEND_PID=$!

  # Go build in background (no embed — serves from web/dist/ on disk)
  (cd backend && go build -o ../wede ./cmd/wede 2>&1) &
  GO_PID=$!

  wait $FRONTEND_PID
  wait $GO_PID

  echo ""
  echo "=== Build complete ==="
  du -sh web/dist/index.js web/dist/styles.css
  ls -lh wede | awk '{print "Binary: " $5}'
}

build_prod() {
  echo "=== Production build (npm run build:all) ==="
  (cd web && npm run build:all) || { echo "Build failed."; exit 1; }

  echo ""
  echo "=== Build complete ==="
  ls -lh wede | awk '{print "Binary: " $5}'
}

start_wede() {
  echo ""
  echo "=== Starting wede ==="
  ./wede &
  sleep 1.5
  curl -s -o /dev/null -w "HTTP status: %{http_code}\n" http://localhost:9090/api/auth/check 2>/dev/null || true
  echo "wede running on http://0.0.0.0:9090"
}

# --- Commands ---

case "$CMD" in
  dev-build)
    build_dev
    ;;
  dev-restart)
    kill_wede
    build_dev
    start_wede
    ;;
  prod-build)
    build_prod
    ;;
  dev-kill)
    kill_wede
    ;;
  *)
    echo "Usage: ./build.sh {dev-build|dev-restart|prod-build|dev-kill}"
    echo ""
    echo "Commands:"
    echo "  dev-build     Fast build only (~5s), don't start"
    echo "  dev-restart   Kill, build, and start (dev mode)"
    echo "  prod-build    Full production build with embedded frontend"
    echo "  dev-kill      Stop running wede instances"
    echo ""
    echo "Aliases: dev → dev-restart, prod → prod-build"
    exit 1
    ;;
esac
