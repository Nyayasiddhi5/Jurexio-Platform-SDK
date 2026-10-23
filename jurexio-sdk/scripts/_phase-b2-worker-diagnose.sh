#!/usr/bin/env bash
# Diagnose CNR + SC FTS failures on worker
set -uo pipefail
echo "=== CNR LOG (full tail 30) ==="
tail -30 /opt/nyv/logs/cnr-case-details-b2.log 2>/dev/null
echo "=== SC FTS LOG (full tail 30) ==="
tail -30 /opt/nyv/logs/sc-body-fts-b2.log 2>/dev/null
echo "=== SCRIPTS ==="
ls -la /opt/nyv/api/ingest-cnr-case-details.mjs /opt/nyv/api/backfill-sc-body-fts.mjs 2>&1
echo "=== CNR dry-run node check ==="
cd /opt/nyv/api && node -e "console.log('node ok')" && head -3 ingest-cnr-case-details.mjs
