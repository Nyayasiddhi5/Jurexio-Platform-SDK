#!/usr/bin/env bash
pgrep -af "backfill-sc-body-fts|nys-treatment-graph" || echo "no pids"
echo "--- sc-body-fts log ---"
tail -5 /opt/nyv/logs/sc-body-fts.log 2>/dev/null || echo "(empty)"
echo "--- extract log ---"
tail -5 /opt/nyv/logs/treatment-graph-extract.log 2>/dev/null || echo "(empty)"
echo "--- edges log ---"
tail -5 /opt/nyv/logs/treatment-graph-edges.log 2>/dev/null || echo "(empty)"
node /opt/nyv/api/apply-sc-body-fts-ddl.mjs 2>/dev/null | tail -1
