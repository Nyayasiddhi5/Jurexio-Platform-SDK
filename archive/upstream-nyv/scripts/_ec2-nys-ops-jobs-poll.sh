#!/usr/bin/env bash
set -uo pipefail
echo "=== NYS OPS JOBS POLL $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
pgrep -af "nys-cnr-index-sync|ingest-rds|ingest-cnr-case-details|rds_daily" || echo "no matching jobs"
for pat in cnr-index-sync p3-cnr-details rds-daily ops-go-cnr-dc; do
  L=$(ls -t /var/log/nys-ops/${pat}-*.log 2>/dev/null | head -1)
  [[ -n "$L" ]] && echo "--- tail $L ---" && tail -8 "$L" 2>/dev/null
done
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
bash "$SCRIPT_DIR/_ec2-rds-watermark-only-probe.sh" 2>/dev/null || true
echo "=== JOBS POLL DONE ==="
