#!/usr/bin/env bash
# rebuild-and-run.sh — Rebuilds the TypeScript frontend and Go backend, then starts wede.
# Usage:
#   ./rebuild-and-run.sh        # Full rebuild + start (uses npm run build:all)
#   ./rebuild-and-run.sh dev    # Start dev mode: Go backend + Vite dev server (instant HMR)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-build}"

echo "=== Stopping any running processes ==="
pkill -f "./wede" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

if [ "$MODE" = "dev" ]; then
    echo "=== Dev mode: Go backend + Vite dev server (instant HMR) ==="
    echo ""
    
    # Build Go backend without embedded frontend (dev mode)
    echo "Building Go backend (dev)..."
    (cd backend && go build -o cmd/wede-dev ./cmd/wede) || { echo "Go build failed."; exit 1; }
    
    # Start Go backend in background
    echo "Starting Go backend on :9090..."
    ./backend/cmd/wede-dev > /tmp/wede-dev.log 2>&1 &
    BACKEND_PID=$!
    
    # Wait for backend
    for i in $(seq 1 10); do
      if curl -s -o /dev/null http://localhost:9090/api/auth/check 2>/dev/null; then
        break
      fi
      sleep 0.5
    done
    
    echo "Starting Vite dev server on :5173..."
    echo "Open http://localhost:5173 — TSX changes reload instantly!"
    echo "Press Ctrl+C to stop."
    echo ""
    
    # Start Vite dev server (foreground)
    trap "kill $BACKEND_PID 2>/dev/null" EXIT
    (cd web && npm run dev)
else
    echo "=== Full rebuild (npm run build:all) ==="
    (cd web && npm run build:all) || { echo "Build failed."; exit 1; }
    
    echo ""
    echo "=== Starting wede ==="
    ./wede &
    sleep 2
    echo "wede started on http://localhost:9090"
fi
