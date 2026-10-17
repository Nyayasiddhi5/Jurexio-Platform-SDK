#!/usr/bin/env bash
# C-21 — caselaw-worker build toolchain + dist artifacts (no secrets).
set -uo pipefail
echo "=== NYS WORKER BUILD ENV $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
for t in node pnpm npm python3; do
  p="$(command -v "$t" 2>/dev/null || true)"
  if [ -n "$p" ]; then
    ver=$("$t" --version 2>/dev/null | head -1 || echo "?")
    echo "  $t -> $p ($ver)"
  else
    echo "  $t -> ABSENT"
  fi
done
API="${NYS_API_DIR:-/opt/nyv/api}"
echo "--- /opt/nyv/api artifacts ---"
ls -la "$API"/index.mjs "$API"/ingest-rds.mjs "$API"/nys-cnr-index-sync.mjs 2>/dev/null | awk '{print $5,$9}' || true
if [ -f "$API/manifest.json" ]; then
  echo "manifest_bytes=$(wc -c < "$API/manifest.json")"
  python3 -c 'import json;d=json.load(open("'"$API"'/manifest.json"));print("manifest_keys",sorted(d.keys())[:8], "n=",len(d))' 2>/dev/null || true
fi
SRC="${NYS_SRC_DIR:-/home/ubuntu/jrx-search}"
echo "--- source tree ---"
for d in "$SRC/artifacts/api-server" "$SRC"; do
  if [ -d "$d" ]; then
    echo "found $d"
    ls "$d/build.mjs" 2>/dev/null && echo "  build.mjs present" || echo "  build.mjs MISSING"
    if [ -d "$d/node_modules/.pnpm" ]; then
      echo "  pnpm_store_entries=$(find "$d/node_modules/.pnpm" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
    elif [ -d "$SRC/node_modules/.pnpm" ]; then
      echo "  pnpm_store_entries=$(find "$SRC/node_modules/.pnpm" -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
    else
      echo "  pnpm_store=MISSING"
    fi
    break
  fi
done
if [ -f "$SRC/artifacts/api-server/build.mjs" ]; then
  echo "--- dry-run build (5s cap) ---"
  timeout 15 bash -c "cd '$SRC/artifacts/api-server' && node build.mjs" 2>&1 | tail -8 || echo "build_failed_or_timeout"
fi
echo "=== BUILD ENV DONE ==="
