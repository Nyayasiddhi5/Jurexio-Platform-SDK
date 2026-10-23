#!/usr/bin/env bash
# GO: sc-body-fts-deploy + citation-graph-backfill — kick off independent background jobs.
# Worker (NYS): DDL + body FTS backfill + graph extract + graph edges (all newest-first).
# Nysdev (JRX): graph JSONL ingest loop from S3.
set -euo pipefail
mkdir -p /opt/nyv/logs
set -a
source /opt/nyv/api/.env
set +a
export JRX_ECOSYSTEM_LOCAL_API="${JRX_ECOSYSTEM_LOCAL_API:-http://127.0.0.1:8080}"

echo "=== GO background jobs $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Fresh run from newest-first (reverse chronological)
rm -f /opt/nyv/api/.sc-body-fts-checkpoint.json \
      /opt/nyv/api/.treatment-graph-extract-checkpoint.json \
      /opt/nyv/api/.treatment-graph-edges-checkpoint.json

node /opt/nyv/api/apply-sc-body-fts-ddl.mjs

start_job() {
  local name="$1"
  local script="$2"
  local log="/opt/nyv/logs/${name}.log"
  pkill -f "$script" 2>/dev/null || true
  sleep 1
  nohup node "$script" >>"$log" 2>&1 &
  echo "START ${name} pid=$! log=${log}"
}

start_job "sc-body-fts" "/opt/nyv/api/backfill-sc-body-fts.mjs"
start_job "treatment-graph-extract" "/opt/nyv/api/nys-treatment-graph-extract.mjs"
start_job "treatment-graph-edges" "/opt/nyv/api/nys-treatment-graph-edges.mjs"

echo "=== worker jobs launched ==="
sleep 2
pgrep -af 'backfill-sc-body-fts|nys-treatment-graph' || true
