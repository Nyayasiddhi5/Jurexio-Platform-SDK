#!/bin/bash
# ============================================================
# Nyayavigya Platform 5.0.0 — Frontend Console Startup
# NYV-SVC-CONSOLE | React SDK Dashboard
# ============================================================

set -e

NYV_PORT_CONSOLE=${NYV_PORT_CONSOLE:-3004}

# Kill existing process on console port
PID=$(lsof -t -i:$NYV_PORT_CONSOLE 2>/dev/null || true)
if [ ! -z "$PID" ]; then
  kill -9 $PID 2>/dev/null || true
  echo "  ✓ Killed existing process on port $NYV_PORT_CONSOLE"
fi

echo ""
echo "  Starting NYV-SVC-CONSOLE on port $NYV_PORT_CONSOLE..."
echo "  Dashboard → http://0.0.0.0:$NYV_PORT_CONSOLE"
echo ""

# NYV-CONSOLE-VITE-CONFIG-FIX (2026-05-06 Session 6):
# Earlier this script invoked `npx vite client/` which made Vite chdir into
# ./client and try to load ./client/vite.config.ts (which doesn't exist),
# silently falling back to a blank config with NO `@` alias. That broke every
# `@/...` import in the Console UI. Fix: run from project root and pass the
# real config explicitly. The config has `root: './client'` so the dev server
# still serves from client/.
npx vite --config vite.config.ts --port $NYV_PORT_CONSOLE --host 0.0.0.0
