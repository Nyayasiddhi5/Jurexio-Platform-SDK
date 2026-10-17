#!/usr/bin/env bash
# Apply existing full export (_export/cases_csv) when export already complete.
set -euo pipefail
HERE=/home/ubuntu/scripts/data_rds
LOG_DIR=/var/log/nys-ops
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/rds-full-reconcile-apply-${STAMP}.log"
DIR="$HERE/_export/cases_csv"

echo "=== RDS APPLY-ONLY RECONCILE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
sudo systemctl reset-failed case-api-rds-daily.service 2>/dev/null || true

if pgrep -f 'apply_delta_to_rds.sh' >/dev/null 2>&1; then
  echo "SKIPPED: apply already running"
  pgrep -af 'apply_delta_to_rds' || true
  exit 0
fi
if pgrep -f 'export_cases_for_rds.py' >/dev/null 2>&1; then
  echo "SKIPPED: export still running"
  pgrep -af 'export_cases_for_rds' || true
  exit 0
fi

PARTS=$(find "$DIR" -name '*.csv.gz' 2>/dev/null | wc -l)
echo "cases_csv_partitions=$PARTS"
[[ "$PARTS" -ge 500 ]] || { echo "BLOCKED: export incomplete ($PARTS csv.gz)"; exit 2; }

nohup bash -c "
  set -uo pipefail
  exec >>\"$LOG\" 2>&1
  echo \"=== apply_delta_to_rds.sh $DIR start \$(date -u +%FT%TZ) ===\"
  cd \"$HERE\"
  ./apply_delta_to_rds.sh \"$DIR\" --force || { echo FATAL apply_failed; exit 1; }
  echo \"=== APPLY DONE \$(date -u +%FT%TZ) ===\"
" >>"$LOG" 2>&1 &

PID=$!
sleep 2
echo "RDS_APPLY_STARTED pid=$PID log=$LOG"
pgrep -af 'apply_delta_to_rds' || true
echo "--- log head (50) ---"
head -50 "$LOG" 2>/dev/null || true
echo "=== KICKOFF DONE ==="
