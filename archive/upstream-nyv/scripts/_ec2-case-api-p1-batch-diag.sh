#!/usr/bin/env bash
set -uo pipefail
WORK="/tmp/jrx-p1-etl"
API="/opt/nyv/api"
echo "=== P1 BATCH DIAG $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
test -f "$API/.p1_rds_helper.mjs" && echo "helper=ok" || echo "helper=missing"
payload='[{"cnr":"TSWL000000742024","court_level":"DC","acts_json":"[{\"act\":\"test\"}]"}]'
echo "$payload" > "$WORK/payload-batch-diag.json"
export P1_RDS_MODE=batch
export P1_RDS_PAYLOAD_FILE="$WORK/payload-batch-diag.json"
export RDS_STATEMENT_TIMEOUT_MS=600000
cd "$API"
node --env-file="$API/.env" "$API/.p1_rds_helper.mjs" > /tmp/p1-batch-diag.out 2> /tmp/p1-batch-diag.err
echo "rc=$?"
echo "--- stdout ---"; cat /tmp/p1-batch-diag.out
echo "--- stderr ---"; cat /tmp/p1-batch-diag.err
echo "=== DIAG DONE ==="
