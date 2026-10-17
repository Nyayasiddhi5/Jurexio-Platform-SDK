#!/usr/bin/env bash
# Install hyparquet + fix pino symlink chain for bundled CNR ingest
set -euo pipefail
cd /opt/nyv/api
echo "=== install hyparquet ==="
npm install hyparquet --no-save 2>&1 | tail -5
echo "=== pino symlinks ==="
DIST='/Users/vamsit/Desktop/cursor-workspace/nyayavigya-platform-5.0.0-CURSOR-CLOUD/nyayavigya-platform-5.0.0/nyayavigya-platform-312/jrx-search/artifacts/api-server/dist'
mkdir -p "$DIST"
for f in thread-stream-worker.mjs pino-pretty.mjs; do
  if [ -f "/opt/nyv/api/$f" ]; then
    ln -sf "/opt/nyv/api/$f" "$DIST/$f"
    echo "linked $f"
  else
    echo "missing /opt/nyv/api/$f"
  fi
done
echo "=== test bundled CNR 1 partition ==="
export NODE_OPTIONS=--max-old-space-size=8192
node ingest-cnr-case-details.mjs 1 2>&1 | tail -10
