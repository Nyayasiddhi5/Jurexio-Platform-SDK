#!/usr/bin/env bash
# Fix bundled pino worker path via symlink to deployed worker file
set -euo pipefail
cd /opt/nyv/api
BROKEN='/Users/vamsit/Desktop/cursor-workspace/jurexio-platform-5.0.0-CURSOR-CLOUD/jurexio-platform-5.0.0/Jurexio-Platform-SDK/jrx-search/artifacts/api-server/dist/thread-stream-worker.mjs'
GOOD='/opt/nyv/api/thread-stream-worker.mjs'
if [ ! -f "$GOOD" ]; then echo "MISSING $GOOD"; exit 1; fi
mkdir -p "$(dirname "$BROKEN")"
ln -sf "$GOOD" "$BROKEN"
ls -la "$BROKEN"
echo "=== test CNR 2 partitions foreground ==="
export NODE_OPTIONS=--max-old-space-size=8192
node ingest-cnr-case-details.mjs 2 2>&1 | tail -15
