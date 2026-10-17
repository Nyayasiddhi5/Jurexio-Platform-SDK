#!/usr/bin/env bash
# Bulk RDS reconcile: export_delta_for_rds.py --full-scan + apply_delta_to_rds.sh
# (rds_daily.sh has no --full-scan flag; error message refers to export_delta.)
set -euo pipefail
HERE=/home/ubuntu/scripts/data_rds
BASE=/home/ubuntu/scripts/case_api
PY="${BASE}/.venv/bin/python"
TABLE_ROOT="${CASE_API_LOOKUP_TABLE_URI:-${BASE}/_build/case_lookup_full}"
LOG_DIR=/var/log/nys-ops
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/rds-daily-fullscan-${STAMP}.log"

echo "=== RDS FULL-SCAN RECONCILE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
sudo systemctl reset-failed case-api-rds-daily.service 2>/dev/null || true

for pat in 'export_delta_for_rds.py' 'data_rds/rds_daily.sh' 'apply_delta_to_rds.sh'; do
  if pgrep -f "$pat" >/dev/null 2>&1; then
    echo "SKIPPED: already running ($pat)"
    pgrep -af "$pat" || true
    exit 0
  fi
done

TO=$("$PY" -c "import json; print(json.load(open('$TABLE_ROOT/_CURRENT'))['version'])")
# Oldest on-disk published tree (pinned symlink counts); not the pruned RDS watermark.
FROM=""
for v in "$TABLE_ROOT"/v_*; do
  [ -e "$v" ] || continue
  name=$(basename "$v")
  [[ "$name" == "$TO" ]] && continue
  FROM="$name"
  break
done
# Prefer explicit pin baseline when watermark version was pruned.
if [ -d "$HERE/_pin/v_20260923T014834Z" ]; then
  FROM="v_20260923T014834Z"
fi
[ -n "$FROM" ] || { echo "BLOCKED: no FROM version on disk"; exit 2; }
echo "FROM=$FROM TO=$TO log=$LOG"

nohup bash -c "
  set -uo pipefail
  exec >>\"$LOG\" 2>&1
  cd \"$HERE\"
  echo \"=== export_delta_for_rds.py --full-scan --from $FROM --to $TO start \$(date -u +%FT%TZ) ===\"
  \"$PY\" export_delta_for_rds.py --full-scan --from \"$FROM\" --to \"$TO\" || { echo FATAL export_delta_failed; exit 1; }
  DIR=\$(ls -1dt _delta/${FROM}__${TO}*__fullscan 2>/dev/null | head -1)
  [ -n \"\$DIR\" ] && [ -d \"\$DIR\" ] || DIR=\$(ls -1dt _delta/${FROM}__${TO}* 2>/dev/null | head -1)
  [ -n \"\$DIR\" ] && [ -d \"\$DIR\" ] || { echo FATAL no_delta_dir; exit 2; }
  echo \"=== apply_delta_to_rds.sh \$DIR \$(date -u +%FT%TZ) ===\"
  ./apply_delta_to_rds.sh \"\$DIR\" --force || { echo FATAL apply_failed; exit 3; }
  echo \"=== FULL-SCAN RECONCILE DONE \$(date -u +%FT%TZ) ===\"
" >>"$LOG" 2>&1 &

PID=$!
sleep 3
echo "RDS_FULLSCAN_STARTED pid=$PID log=$LOG"
pgrep -af 'export_delta_for_rds|rds_daily|apply_delta_to_rds' || true
echo "--- log head (50) ---"
head -50 "$LOG" 2>/dev/null || true
echo "=== KICKOFF DONE ==="
