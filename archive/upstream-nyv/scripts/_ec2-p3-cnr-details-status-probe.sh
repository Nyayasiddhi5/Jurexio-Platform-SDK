#!/usr/bin/env bash
# P3 cnr_case_details / parquet join — log + process poll (read-only).
set -uo pipefail
echo "=== P3 CNR DETAILS STATUS $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
pgrep -af "ingest-cnr-case-details|p3-cnr|cnr-details" || echo "no p3 ingest process"
ls -lt /var/log/nys-ops/p3-cnr-details-*.log 2>/dev/null | head -3
LOG=$(ls -t /var/log/nys-ops/p3-cnr-details-*.log 2>/dev/null | head -1)
if [ -n "$LOG" ]; then tail -20 "$LOG"; fi
echo "=== P3 STATUS DONE ==="
