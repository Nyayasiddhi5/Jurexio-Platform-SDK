#!/usr/bin/env bash
# NV-TREATMENT-GRAPH-001 — ingest graph edge batches from S3 (runs on jrx-prod, independent loop).
set -euo pipefail
mkdir -p /opt/nyv/logs
REPO="${JRX_DEPLOY_ROOT:-/opt/nyayavigya/repo/current}"
SCRIPT="${REPO}/scripts/jrx-treatment-graph-ingest.mjs"
LOG="/opt/nyv/logs/graph-ingest.log"

if [[ ! -f "$SCRIPT" ]]; then
  echo "missing $SCRIPT — deploy JRX repo first" >&2
  exit 1
fi

if pgrep -f "./jrx-treatment-graph-ingest.mjs" >/dev/null 2>&1; then
  echo "SKIP graph-ingest — already running pid $(pgrep -f jrx-treatment-graph-ingest.mjs | head -1)"
  exit 0
fi

set -a
# shellcheck disable=SC1091
source /opt/Jurexio/secrets/.env.production 2>/dev/null || true
set +a

nohup node "$SCRIPT" >>"$LOG" 2>&1 &
echo "START graph-ingest pid=$! log=$LOG"
