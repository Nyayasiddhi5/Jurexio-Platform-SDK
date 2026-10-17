#!/usr/bin/env bash
# NV-RDS-DAILY-FAIL-001 — clear systemd failed state after successful full-scan (no job start).
set -euo pipefail
sudo systemctl reset-failed case-api-rds-daily.service 2>/dev/null || true
echo "--- case-api-rds-daily.service ---"
systemctl is-failed case-api-rds-daily.service 2>&1 || true
systemctl show case-api-rds-daily.service -p ActiveState,SubState,Result,UnitFileState --no-pager
echo "--- no rds_daily / full-scan process (expect empty) ---"
pgrep -af 'data_rds/rds_daily|export_delta_for_rds' || echo "(none)"
