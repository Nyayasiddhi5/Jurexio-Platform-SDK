#!/usr/bin/env bash
# Read-only: case-api-rds-daily.timer status on caselaw-worker (no start).
set -uo pipefail
echo "=== case-api-rds-daily timer status $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
systemctl is-enabled case-api-rds-daily.timer 2>&1 || true
systemctl is-active case-api-rds-daily.timer 2>&1 || true
systemctl list-timers case-api-rds-daily.timer --no-pager 2>&1 || true
echo "--- last service runs (no start) ---"
systemctl is-active case-api-rds-daily.service 2>&1 || true
journalctl -u case-api-rds-daily.service -n 8 --no-pager 2>&1 | tail -8
