#!/usr/bin/env bash
# Bump background job concurrency and restart WITHOUT clearing checkpoints.
set -euo pipefail
mkdir -p /opt/nyv/logs
set -a
source /opt/nyv/api/.env
set +a

# 2 → 4 doubles throughput; worker has ~4GB+ headroom on t3.large-class hosts.
export SC_BODY_FTS_CONCURRENCY="${SC_BODY_FTS_CONCURRENCY:-4}"
export SC_BODY_FTS_BATCH="${SC_BODY_FTS_BATCH:-80}"
export TREATMENT_GRAPH_EXTRACT_CONCURRENCY="${TREATMENT_GRAPH_EXTRACT_CONCURRENCY:-4}"
export TREATMENT_GRAPH_EDGES_BATCH="${TREATMENT_GRAPH_EDGES_BATCH:-50}"
export NYS_LOCAL_API="${NYS_LOCAL_API:-http://127.0.0.1:8080}"

echo "=== bump concurrency restart $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "SC_BODY_FTS_CONCURRENCY=$SC_BODY_FTS_CONCURRENCY BATCH=$SC_BODY_FTS_BATCH"
echo "TREATMENT_GRAPH_EXTRACT_CONCURRENCY=$TREATMENT_GRAPH_EXTRACT_CONCURRENCY"
echo "TREATMENT_GRAPH_EDGES_BATCH=$TREATMENT_GRAPH_EDGES_BATCH"
echo "=== memory headroom ==="
free -m | head -2 || true

start_job() {
  local name="$1"
  local script="$2"
  local log="/opt/nyv/logs/${name}.log"
  pkill -f "$script" 2>/dev/null || true
  sleep 1
  nohup env \
    SC_BODY_FTS_CONCURRENCY="$SC_BODY_FTS_CONCURRENCY" \
    SC_BODY_FTS_BATCH="$SC_BODY_FTS_BATCH" \
    TREATMENT_GRAPH_EXTRACT_CONCURRENCY="$TREATMENT_GRAPH_EXTRACT_CONCURRENCY" \
    TREATMENT_GRAPH_EDGES_BATCH="$TREATMENT_GRAPH_EDGES_BATCH" \
    node "$script" >>"$log" 2>&1 &
  echo "START ${name} pid=$! log=${log}"
}

start_job "sc-body-fts" "/opt/nyv/api/backfill-sc-body-fts.mjs"
start_job "treatment-graph-extract" "/opt/nyv/api/nys-treatment-graph-extract.mjs"
start_job "treatment-graph-edges" "/opt/nyv/api/nys-treatment-graph-edges.mjs"

sleep 2
pgrep -af 'backfill-sc-body-fts|nys-treatment-graph' || true
echo "=== checkpoints preserved ==="
for f in /opt/nyv/api/.sc-body-fts-checkpoint.json \
         /opt/nyv/api/.treatment-graph-extract-checkpoint.json \
         /opt/nyv/api/.treatment-graph-edges-checkpoint.json; do
  [ -f "$f" ] && echo "$f: $(head -c 120 "$f")" || echo "$f: (none)"
done
