#!/usr/bin/env bash
set -uo pipefail
LOG="${1:-/var/log/nys-ops/rds-daily-fullscan-20260924T093110Z.log}"
echo "=== FULLSCAN JOB PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "log=$LOG"
pgrep -af 'export_delta_for_rds.py|apply_delta_to_rds.sh' || echo "no export/apply process"
echo "--- log tail 30 ---"
tail -30 "$LOG" 2>/dev/null || echo "missing log"
echo "--- REFUSING/FATAL in first 50 ---"
grep -nE 'REFUSING|FATAL' "$LOG" 2>/dev/null | head -20 || true
echo "=== DONE ==="
