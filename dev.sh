#!/bin/bash
# Fast dev mode — instant hot reload for TSX changes, no production build overhead.
# Usage: ./dev.sh
#
# Starts two processes:
#   1. Go backend on port 9090 (without embedded frontend)
#   2. Vite dev server on port 5173 (proxies /api to backend)
#
# Open http://localhost:5173 in your browser.
# TSX changes reload instantly via HMR (milliseconds, not 12s).

set -e

cd "$(dirname "$0")"

# Stop any running instances
pkill -f './wede' 2>/dev/null || true
pkill -f 'vite' 2>/dev/null || true
# Make sure the ports are actually free (stale processes can linger)
lsof -ti:9090 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti:5173 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

echo "=== Starting Go backend on :9090 ==="
./backend/cmd/wede-dev > /tmp/wede-dev.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
for i in $(seq 1 10); do
  if curl -s -o /dev/null http://localhost:9090/api/auth/check 2>/dev/null; then
    break
  fi
  sleep 0.5
done

echo ""
echo "=== Starting Vite dev server on :5173 ==="
echo "Open http://localhost:5173 in your browser"
echo "TSX changes will reload instantly (HMR)"
echo ""
echo "Press Ctrl+C to stop both"
echo ""

# Start Vite dev server (foreground, so Ctrl+C works)
(cd web && npm run dev)

# Cleanup on exit
wait $BACKEND_PID 2>/dev/null
