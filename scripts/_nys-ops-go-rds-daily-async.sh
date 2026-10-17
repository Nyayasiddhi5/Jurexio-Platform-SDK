#!/usr/bin/env bash
# NV-NYS-OPS-GO-004 — case_api_search DuckDB→RDS mirror (rds_daily.sh), async.
set -euo pipefail
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/rds-daily-${STAMP}.log"
# Canonical on caselaw-worker (systemd case-api-rds-daily.service); legacy probe checked case_api/ only.
RDS_DAILY="${NYS_RDS_DAILY_SCRIPT:-/home/ubuntu/scripts/data_rds/rds_daily.sh}"

if pgrep -f "rds_daily.sh" >/dev/null 2>&1; then
  echo "SKIPPED: rds_daily already pid=$(pgrep -f 'rds_daily.sh' | head -1)"
  exit 0
fi
[[ -x "$RDS_DAILY" || -f "$RDS_DAILY" ]] || { echo "BLOCKED: missing $RDS_DAILY"; exit 2; }

nohup bash "$RDS_DAILY" >>"$LOG" 2>&1 &
echo "RDS_DAILY_STARTED pid=$! log=$LOG script=$RDS_DAILY"
