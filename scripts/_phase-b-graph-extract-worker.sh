#!/usr/bin/env bash
# Phase B — run treatment graph edge extraction on worker (writes JSONL → S3)
set -uo pipefail
set -a; source /opt/nyv/api/.env; set +a
API=/opt/nyv/api
SCRIPT="$API/nys-treatment-graph-edges.mjs"
if [ ! -f "$SCRIPT" ]; then
  echo "MISSING $SCRIPT"
  exit 1
fi
echo "=== B4 GRAPH EDGE EXTRACT (batch 100) ==="
TREATMENT_GRAPH_EDGES_BATCH=100 node "$SCRIPT" 2>&1 | tail -30
echo "=== S3 pending check ==="
aws s3 ls "s3://${JRX_DEPLOY_BUCKET:-jurexio-sdk-devapp}/caselaw-worker/graph-edges/" --region ap-south-1 2>&1 | tail -10
